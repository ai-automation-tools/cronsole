import { HealthState, PlatformType, TaskStatus } from '@prisma/client';
import { prisma } from '../db.js';
import { connectorRegistry } from '../connectors/registry.js';
import { deserializeConfig } from '../auth/connectionConfig.js';
import { parseAllowedOrigins } from '../config/origins.js';
import { agentManager } from '../ws/AgentManager.js';
import { getLastCatalogSync } from '../catalog/catalogSync.js';
import { nativeScheduler, MISSED_RUN_GRACE_MS } from './NativeScheduler.js';
import { executionHost, type ExecutionHost } from './runtimeContext.js';

/**
 * **Why is Cronsole not working?** — answered from evidence the process already
 * holds, in the app, at the moment the question is asked.
 *
 * The problem this exists for is narrow and real. When the dashboard says
 * *"Windows offline — agent not connected"* that is a **verdict with its reasons
 * discarded**: a socket that never arrived, a socket that arrived and went, a
 * request that timed out ninety seconds ago, or a request that timed out at 9pm
 * yesterday and has been colouring the strip ever since all render as the same
 * sentence. The reasons exist — `AgentLiveness` has been carrying them since
 * troubleshooting #40 — and until now nothing showed them to anyone.
 *
 * Four rules, and every one of them is a lesson this repo has already paid for:
 *
 * 1. **Every check carries its facts, never a bare verdict.** Same rule as
 *    `taskHealth`'s signals and `PlatformCapability`'s evidence: a claim does not
 *    travel without its source. A panel that said "Agent: unhealthy" would be the
 *    status chip again, one screen further from the fix.
 *
 * 2. **`unknown` is not a severity — it is the absence of a verdict**, and it
 *    must rank *above* `pass` in any summary. This is `HealthState.UNKNOWN`'s rule
 *    (troubleshooting #48) and it is why `worstOf` orders the way it does: a
 *    report that prints "8 checks passed" while one of them measured nothing is
 *    strictly worse than one that admits the gap. Green tells you to stop looking.
 *
 * 3. **Nothing here repairs anything.** Every check is a read. That is not
 *    timidity, it is sequencing: three of the four agent-health entries in the
 *    troubleshooting log (#40, #48, #62) were the *readout* lying, in both
 *    directions — #62 wrote a timeout fifteen seconds after every successful
 *    request. A "restart the agent" button shipped against that would have been
 *    restarting a healthy agent forever, on a schedule, and looking like it
 *    worked. **You cannot automate a repair you cannot yet diagnose**, and the
 *    diagnosis is the half that was missing.
 *
 * 4. **The report names the machine it measured.** A check running inside the
 *    backend container reports on the container's clock, disk and filesystem, not
 *    the user's — the `runtimeContext` trap, and the one that made a probe call
 *    four healthy services DOWN (troubleshooting #23a). `measuredOn` is at the
 *    top of the report rather than buried in one check, because it qualifies all
 *    of them.
 *
 * A note on what this deliberately does *not* do: it never re-derives a verdict
 * another module owns. Agent health comes from `connector.getHealth`, the same
 * call the dashboard's strip renders, so the panel can only ever *explain* the
 * strip — never disagree with it. Re-deriving it here is the shape of
 * troubleshooting #20a, and two health verdicts for one agent is exactly the
 * confusion this screen exists to end.
 *
 * It also cannot help when the backend is down, because it *is* the backend. That
 * limit is stated in the UI rather than papered over; the answer for that case is
 * the `\Cronsole-Stack\` watchdog, which runs outside the stack precisely because
 * everything inside it is a candidate for being what broke.
 */

/**
 * Where each check sends a reader for the full story.
 *
 * Hoisted into one map rather than written inline at each branch, for the reason
 * `frontend/src/data/docs.ts` gives about the links it owns: **these are a mirror
 * surface.** A renamed heading leaves a link that still resolves — to the top of
 * the page, silently, looking like it worked — so the only person who finds out
 * is whoever needed the answer. Collected here so `scripts/check-doc-links.mjs`
 * can resolve every one back to a real file and a real heading, which it does for
 * any repo-doc path written as a literal in tracked source.
 *
 * Repo-relative, with the GitHub slug after `#`. The frontend prepends
 * `DOCS_BASE`; the backend never builds an absolute URL, so the deploy branch and
 * repo name stay defined in exactly one place.
 */
export const DIAGNOSTIC_DOCS = {
  slowDatabase: 'docs/troubleshooting/README.md#23-network-error-after-a-reboot--the-database-system-is-starting-up',
  agentSetup: 'docs/user-guides/guides/Agent_Setup_Guide.md',
  staleSync: 'docs/troubleshooting/README.md#42-the-dashboard-says-synced-7m-ago-over-a-task-list-from-yesterday',
  catalogSync: 'docs/troubleshooting/README.md#21-templates-never-update-catalog-sync-failed--p2002-on-every-boot',
  expiredToken: 'docs/troubleshooting/README.md#8-every-mcp-tool-returns-403-invalid-or-expired-token',
  remoteAccess: 'docs/user-guides/guides/Remote_Access_Guide.md',
  cors: 'docs/troubleshooting/README.md#31-the-dashboard-loads-but-every-api-call-fails-with-a-cors-error'
} as const;

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'unknown';

/** One observed value. The label names *what was measured*, not what it implies. */
export interface DiagnosticFact {
  label: string;
  value: string;
}

export interface DiagnosticCheck {
  id: string;
  title: string;
  status: CheckStatus;
  /** One line: the verdict, in the user's terms. */
  summary: string;
  /** The evidence that produced `summary`. Never empty. */
  facts: DiagnosticFact[];
  /** What to do about it. Present only when there is something to do. */
  remedy?: string;
  /** Where the full explanation lives — a repo doc path with an anchor. */
  doc?: string;
}

export interface DiagnosticsReport {
  generatedAt: Date;
  /** Which machine every check below measured. Qualifies the whole report. */
  measuredOn: {
    kind: ExecutionHost['kind'];
    hostname: string;
    os: string;
    summary: string;
  };
  checks: DiagnosticCheck[];
  counts: Record<CheckStatus, number>;
  /** The worst status present, ranked fail > warn > unknown > pass. */
  worst: CheckStatus;
}

/**
 * Severity order. `unknown` sits **above** `pass` deliberately — see rule 2.
 * Ranking it below would let a report summarise as healthy while a check
 * measured nothing, which is the one summary worse than an amber one.
 */
const SEVERITY: Record<CheckStatus, number> = { pass: 0, unknown: 1, warn: 2, fail: 3 };

export function worstOf(checks: DiagnosticCheck[]): CheckStatus {
  return checks.reduce<CheckStatus>(
    (worst, c) => (SEVERITY[c.status] > SEVERITY[worst] ? c.status : worst),
    'pass'
  );
}

/** Relative age in words, for a fact value. Absent input is the caller's problem. */
function ago(at: Date, now: Date): string {
  const seconds = Math.max(0, Math.round((now.getTime() - at.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function stamp(at: Date | null | undefined, now: Date): string {
  return at ? `${at.toISOString()} (${ago(at, now)})` : 'never';
}

// --- The checks --------------------------------------------------------------
//
// Each returns exactly one DiagnosticCheck and may not throw: a diagnostics
// report that dies on its own third check is useless precisely when it is
// needed. `runCheck` enforces that, converting a thrown error into an `unknown`
// check that names the failure — an observer may not fail the thing it observes,
// and here it may not fail its siblings either.

interface CheckContext {
  userId: string;
  now: Date;
}

async function checkBackend(ctx: CheckContext): Promise<DiagnosticCheck> {
  const uptimeSeconds = Math.round(process.uptime());
  const started = new Date(ctx.now.getTime() - uptimeSeconds * 1000);

  return {
    id: 'backend',
    title: 'Backend process',
    status: 'pass',
    // If this is being read at all, the backend answered. Saying so is not
    // filler: it is the one component whose failure makes this whole report
    // unreachable, so naming it tells the reader what the report cannot cover.
    summary: 'Running and answering requests — you are reading its response.',
    facts: [
      { label: 'Uptime', value: `${uptimeSeconds < 120 ? `${uptimeSeconds}s` : ago(started, ctx.now).replace(' ago', '')}` },
      { label: 'Started', value: stamp(started, ctx.now) },
      { label: 'Node', value: process.version },
      // The server's own clock, spelled out. Schedules are stored in UTC and
      // converted at the browser's edge, so a backend whose clock has drifted
      // fires everything at the wrong time while every stored cron looks correct
      // — and there is nothing else on any screen that would show it.
      { label: 'Server time (UTC)', value: ctx.now.toISOString() }
    ]
  };
}

async function checkDatabase(ctx: CheckContext): Promise<DiagnosticCheck> {
  const started = Date.now();
  // A real query against a real table, not `SELECT 1`. A connection can be up
  // while migrations have not run — the state that crash-loops the backend on
  // boot (troubleshooting #19) and the one a bare liveness ping cannot see.
  const taskCount = await prisma.task.count({
    where: { userId: ctx.userId, status: { not: TaskStatus.DELETED } }
  });
  const latencyMs = Date.now() - started;

  // 1s for a counting query on a local Postgres is far outside normal and is the
  // signature of a database still starting up (troubleshooting #23) or one being
  // reached over a slower link than the deployment assumes.
  const slow = latencyMs > 1000;

  return {
    id: 'database',
    title: 'Database',
    status: slow ? 'warn' : 'pass',
    summary: slow
      ? `Reachable, but a simple query took ${latencyMs}ms.`
      : 'Reachable, and the schema is queryable.',
    facts: [
      { label: 'Query round trip', value: `${latencyMs}ms` },
      { label: 'Your tracked tasks', value: String(taskCount) }
    ],
    remedy: slow
      ? 'If this persists, check whether Postgres is still starting up or is under load.'
      : undefined,
    doc: slow ? DIAGNOSTIC_DOCS.slowDatabase : undefined
  };
}

const HEALTH_TO_STATUS: Record<HealthState, CheckStatus> = {
  [HealthState.HEALTHY]: 'pass',
  [HealthState.DEGRADED]: 'warn',
  [HealthState.OFFLINE]: 'fail',
  [HealthState.UNKNOWN]: 'unknown'
};

/**
 * The agent check — the reason this report exists.
 *
 * The verdict is **`connector.getHealth`'s**, not one derived here, so this panel
 * explains the dashboard strip instead of arguing with it. Everything below the
 * verdict is the raw liveness record, which is what turns "offline" into a
 * diagnosis: whether a socket exists at all, when it last said anything, and
 * whether the timeout colouring the status happened ninety seconds ago or last
 * night.
 */
async function checkWindowsAgent(ctx: CheckContext): Promise<DiagnosticCheck | null> {
  const connection = await prisma.platformConnection.findFirst({
    where: { userId: ctx.userId, platform: PlatformType.WINDOWS_TASK_SCHEDULER }
  });
  // No connection means no agent was ever paired. There is nothing to report,
  // and a permanent grey "not configured" row would put a standing non-problem
  // on the report — the same reason HealthStrip filters to connected platforms.
  if (!connection) return null;

  const connector = connectorRegistry.getConnector(PlatformType.WINDOWS_TASK_SCHEDULER);
  if (!connector) return null;

  const config = { ...deserializeConfig(connection.config), userId: ctx.userId };
  const health = await connector.getHealth(config);
  const healthStatus: CheckStatus = HEALTH_TO_STATUS[health.state] ?? 'unknown';

  const socket = agentManager.getSocket(ctx.userId);
  const liveness = agentManager.getLiveness(ctx.userId);

  const facts: DiagnosticFact[] = [
    { label: 'Socket', value: socket ? 'connected' : 'not connected' }
  ];

  if (liveness?.identity?.machineName) {
    facts.push({ label: 'Machine', value: liveness.identity.machineName });
  }
  if (liveness?.identity?.osVersion) {
    facts.push({ label: 'Agent OS', value: liveness.identity.osVersion });
  }
  if (liveness?.identity) {
    // Agents published before 2026-09-11 hardcoded "1.0.0" and sent no protocol
    // version at all, which is why this was withheld for so long. The absence is
    // now the informative case: it says the build predates the stamp, so it is
    // older than any number it could have printed.
    const { agentVersion, protocolVersion } = liveness.identity;
    facts.push({
      label: 'Agent version',
      value: agentVersion
        ? `${agentVersion}${protocolVersion ? ` (wire v${protocolVersion})` : ''}`
        : 'not reported — predates version stamping, republish to find out'
    });
  }
  if (liveness) {
    // The staleness fact about the running *process*, which the version does not
    // answer: a republish restarts it, so this is how old the build in memory is
    // rather than which build it is (troubleshooting #7).
    facts.push({ label: 'Connected since', value: stamp(liveness.connectedAt, ctx.now) });
    facts.push({ label: 'Last inbound event', value: stamp(liveness.lastResponseAt, ctx.now) });
    facts.push({
      label: 'Last request timeout',
      value: liveness.lastFailureAt
        ? `${stamp(liveness.lastFailureAt, ctx.now)} — ${liveness.lastFailureVerb ?? 'unknown verb'}`
        : 'none this connection'
    });
  }

  // The single most useful line on the whole panel, and the one that would have
  // ended troubleshooting #48 in a minute: it says *why* a DEGRADED or UNKNOWN
  // verdict is being shown, in terms of the evidence's own age.
  if (health.state === HealthState.UNKNOWN && liveness?.lastFailureAt) {
    facts.push({
      label: 'Why unknown',
      value: 'The timeout above is older than 15 minutes and nothing has been asked since, so it no longer describes the present.'
    });
  }

  const remedy =
    health.state === HealthState.OFFLINE
      ? 'The agent is not connected. Check that it is running on your machine, then use Sync to confirm.'
      : health.state === HealthState.DEGRADED
        ? 'The agent is connected but a request timed out recently. Sync to find out whether it is still wedged.'
        : health.state === HealthState.UNKNOWN
          ? 'Nothing has been asked of the agent since that timeout. Sync — that is the probe.'
          : undefined;

  return {
    id: 'windows-agent',
    title: 'Windows agent',
    status: healthStatus,
    summary: health.reason ?? 'Connected and answering.',
    facts,
    remedy,
    doc:
      health.state === HealthState.OFFLINE || health.state === HealthState.DEGRADED
        ? DIAGNOSTIC_DOCS.agentSetup
        : undefined
  };
}

/** How old a task list may get before it is worth mentioning. */
const STALE_SYNC_MS = 24 * 60 * 60 * 1000;

async function checkSyncFreshness(ctx: CheckContext): Promise<DiagnosticCheck | null> {
  const connections = await prisma.platformConnection.findMany({
    where: {
      userId: ctx.userId,
      isActive: true,
      // Cronsole-native is excluded because it has nothing to be stale against:
      // this database *is* its source of truth, which is why its connector
      // reports no sync time at all. Including it would print a permanent
      // "never synced" for the one platform that cannot be out of date.
      platform: { not: PlatformType.TASKHUB_NATIVE }
    }
  });
  if (connections.length === 0) return null;

  const facts = connections.map(c => ({
    label: c.platform,
    value: stamp(c.lastSync, ctx.now)
  }));

  const newest = connections
    .map(c => c.lastSync)
    .filter((d): d is Date => !!d)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  // Never synced is an absence of evidence, not a failure: it is the correct
  // state of a fresh install, and calling it a problem would greet every new
  // user with a red row for something they have not done yet.
  if (!newest) {
    return {
      id: 'sync-freshness',
      title: 'Task list freshness',
      status: 'unknown',
      summary: 'No platform has ever been synced, so the task list is not known to be current.',
      facts,
      remedy: 'Use Sync to import what is on your machine.'
    };
  }

  const stale = ctx.now.getTime() - newest.getTime() > STALE_SYNC_MS;
  return {
    id: 'sync-freshness',
    title: 'Task list freshness',
    status: stale ? 'warn' : 'pass',
    summary: stale
      ? `The newest sync is ${ago(newest, ctx.now)} — tasks changed on the platform since then are not reflected here.`
      : `Last synced ${ago(newest, ctx.now)}.`,
    facts,
    remedy: stale ? 'Sync to pick up tasks added, renamed or removed on the platform.' : undefined,
    doc: stale ? DIAGNOSTIC_DOCS.staleSync : undefined
  };
}

async function checkNativeScheduler(ctx: CheckContext): Promise<DiagnosticCheck> {
  const status = nativeScheduler.status();

  const activeCount = await prisma.task.count({
    where: {
      userId: ctx.userId,
      platform: PlatformType.TASKHUB_NATIVE,
      status: TaskStatus.ACTIVE
    }
  });

  // Tasks whose due time has passed by more than the grace window. The scheduler
  // skips these deliberately (a missed run is not replayed), so a growing number
  // here is the visible symptom of a loop that stopped — and the only one, since
  // a skipped run writes no ExecutionLog row.
  const overdue = await prisma.task.count({
    where: {
      userId: ctx.userId,
      platform: PlatformType.TASKHUB_NATIVE,
      status: TaskStatus.ACTIVE,
      nextRunTime: { lt: new Date(ctx.now.getTime() - MISSED_RUN_GRACE_MS) }
    }
  });

  const facts: DiagnosticFact[] = [
    { label: 'Loop', value: status.running ? 'running' : 'not running' },
    { label: 'Tick interval', value: `${Math.round(status.tickIntervalMs / 1000)}s` },
    { label: 'Last tick', value: stamp(status.lastTickAt, ctx.now) },
    { label: 'Your active native tasks', value: String(activeCount) },
    { label: 'Overdue past the grace window', value: String(overdue) }
  ];
  if (status.lastTickError) {
    facts.push({ label: 'Last tick error', value: status.lastTickError });
  }

  if (!status.running) {
    return {
      id: 'native-scheduler',
      title: 'Cronsole-native scheduler',
      status: 'fail',
      summary: 'The scheduler loop is not running, so no Cronsole-native task will fire.',
      facts,
      remedy: 'Restart the backend. Windows Task Scheduler tasks are unaffected — they fire from Windows.'
    };
  }

  // A loop that is running but has not completed a tick in three intervals is
  // wedged, and `running: true` alone would report it as fine — the exact
  // "a socket object exists" evidence troubleshooting #40 threw out.
  const tickOverdue =
    status.lastTickAt !== null &&
    ctx.now.getTime() - status.lastTickAt.getTime() > status.tickIntervalMs * 3;

  if (status.lastTickAt === null) {
    return {
      id: 'native-scheduler',
      title: 'Cronsole-native scheduler',
      status: 'unknown',
      summary: 'The loop is running but has not completed a tick yet.',
      facts
    };
  }

  if (tickOverdue || status.lastTickError) {
    return {
      id: 'native-scheduler',
      title: 'Cronsole-native scheduler',
      status: 'warn',
      summary: tickOverdue
        ? `The loop is running but its last completed tick was ${ago(status.lastTickAt, ctx.now)}.`
        : 'The loop is running, but its last tick raised an error.',
      facts,
      remedy: 'Check the backend log. Native tasks may be firing late or not at all.'
    };
  }

  return {
    id: 'native-scheduler',
    title: 'Cronsole-native scheduler',
    status: overdue > 0 ? 'warn' : 'pass',
    summary:
      overdue > 0
        ? `Running, but ${overdue} task(s) are past due by more than the grace window.`
        : 'Running, and no native task is overdue.',
    facts,
    remedy: overdue > 0 ? 'A missed run is skipped rather than replayed. Check whether the backend was down.' : undefined
  };
}

async function checkTemplateCatalog(ctx: CheckContext): Promise<DiagnosticCheck> {
  const attempt = getLastCatalogSync();
  const registryUrl = process.env.TEMPLATE_REGISTRY_URL?.trim();

  const [total, managed] = await Promise.all([
    prisma.template.count(),
    prisma.template.count({ where: { managed: true } })
  ]);

  const facts: DiagnosticFact[] = [
    { label: 'Source', value: registryUrl ? `remote registry — ${registryUrl}` : 'bundled snapshot' },
    { label: 'Templates in database', value: String(total) },
    { label: 'Auto-synced (core)', value: String(managed) },
    { label: 'Last sync attempt', value: attempt ? stamp(attempt.at, ctx.now) : 'none yet' }
  ];

  if (!attempt) {
    return {
      id: 'template-catalog',
      title: 'Template catalog',
      status: 'unknown',
      summary: 'No catalog sync has completed since this backend started.',
      facts
    };
  }

  if (!attempt.ok) {
    facts.push({ label: 'Error', value: attempt.error ?? 'unknown' });
    return {
      id: 'template-catalog',
      title: 'Template catalog',
      status: 'fail',
      summary: 'The last catalog sync failed. Templates still work; they have stopped updating.',
      facts,
      // The whole reason this check exists: the failure is non-fatal by design,
      // so the app looks fine and the only symptom is a catalog frozen at
      // whatever it held when the sync last worked.
      remedy: 'The catalog falls back to the bundled snapshot, so nothing broke — but new and changed templates will not arrive until this succeeds.',
      doc: DIAGNOSTIC_DOCS.catalogSync
    };
  }

  facts.push({ label: 'Synced from', value: attempt.source ?? 'unknown' });
  return {
    id: 'template-catalog',
    title: 'Template catalog',
    status: 'pass',
    summary: `Last sync brought in ${attempt.count ?? 0} core template(s).`,
    facts
  };
}

async function checkApiTokens(ctx: CheckContext): Promise<DiagnosticCheck | null> {
  const tokens = await prisma.apiToken.findMany({
    where: { userId: ctx.userId },
    select: { name: true, expiresAt: true }
  });
  // No API tokens means nothing here can go wrong. A browser session is not
  // covered: it cannot be expired and still be reading this response.
  if (tokens.length === 0) return null;

  const expired = tokens.filter(t => t.expiresAt && t.expiresAt <= ctx.now);
  const soon = tokens.filter(
    t => t.expiresAt && t.expiresAt > ctx.now && t.expiresAt.getTime() - ctx.now.getTime() < 7 * 24 * 60 * 60 * 1000
  );

  const facts = tokens.map(t => ({
    label: t.name,
    value: t.expiresAt ? `expires ${t.expiresAt.toISOString()}` : 'never expires'
  }));

  const lapsing = expired.length > 0 || soon.length > 0;

  return {
    id: 'api-tokens',
    title: 'API tokens',
    status: lapsing ? 'warn' : 'pass',
    summary:
      expired.length > 0
        ? `${expired.length} of ${tokens.length} token(s) have expired.`
        : soon.length > 0
          ? `${soon.length} token(s) expire within a week.`
          : `${tokens.length} token(s), none expiring soon.`,
    facts,
    // Named because an expired token does not fail loudly at the tool that uses
    // it: the MCP server gets a 403 that reads identically to a misconfigured
    // one, and its tools go *missing* rather than erroring (troubleshooting #8).
    remedy: lapsing
      ? 'Issue a replacement in Settings → Account before the old one lapses; an MCP client using an expired token reports its tools as missing rather than failing.'
      : undefined,
    doc: lapsing ? DIAGNOSTIC_DOCS.expiredToken : undefined
  };
}

async function checkAllowedOrigins(_ctx: CheckContext): Promise<DiagnosticCheck> {
  const allowed = parseAllowedOrigins();

  if (allowed.length === 0) {
    return {
      id: 'allowed-origins',
      title: 'Browser origins',
      status: 'warn',
      summary: 'ALLOWED_ORIGINS is unset, so the API accepts requests from any browser origin.',
      facts: [{ label: 'ALLOWED_ORIGINS', value: 'unset' }],
      // Not a failure: an unset value on a local-only install is an ordinary,
      // working setup. It is a warning because "we never set it" stops being
      // harmless the moment the remote-access proxy puts this API behind a
      // public hostname, and nothing else would mention it at that point.
      remedy: 'Harmless on a local-only install. Set it to your dashboard origin before exposing Cronsole through a tunnel.',
      doc: DIAGNOSTIC_DOCS.remoteAccess
    };
  }

  return {
    id: 'allowed-origins',
    title: 'Browser origins',
    status: 'pass',
    summary: `${allowed.length} origin(s) may reach this API from a browser.`,
    facts: allowed.map((o, i) => ({ label: `Origin ${i + 1}`, value: o })),
    doc: DIAGNOSTIC_DOCS.cors
  };
}

// --- The runner --------------------------------------------------------------

/**
 * Run one check, converting a thrown error into an `unknown` result.
 *
 * A check is an observer, and the report is a set of independent observations —
 * so one failing may not take the other seven with it. This is the same rule
 * `recordCapability` follows and the opposite of `archiveTaskBeforeDelete`'s: an
 * observer must not fail the thing it observes, whereas a *precondition* that
 * cannot fail is not one. Nothing here is a precondition for anything.
 */
async function runCheck(
  fn: (ctx: CheckContext) => Promise<DiagnosticCheck | null>,
  ctx: CheckContext,
  id: string,
  title: string
): Promise<DiagnosticCheck | null> {
  try {
    return await fn(ctx);
  } catch (error) {
    return {
      id,
      title,
      status: 'unknown',
      summary: 'This check could not run, so nothing is known about it either way.',
      facts: [{ label: 'Error', value: error instanceof Error ? error.message : String(error) }]
    };
  }
}

export async function buildDiagnosticsReport(
  userId: string,
  now: Date = new Date()
): Promise<DiagnosticsReport> {
  const ctx: CheckContext = { userId, now };

  // Ordered as a person reads them: the foundation first, then the thing most
  // likely to be what they came here about, then the quieter configuration.
  const results = await Promise.all([
    runCheck(checkBackend, ctx, 'backend', 'Backend process'),
    runCheck(checkDatabase, ctx, 'database', 'Database'),
    runCheck(checkWindowsAgent, ctx, 'windows-agent', 'Windows agent'),
    runCheck(checkSyncFreshness, ctx, 'sync-freshness', 'Task list freshness'),
    runCheck(checkNativeScheduler, ctx, 'native-scheduler', 'Cronsole-native scheduler'),
    runCheck(checkTemplateCatalog, ctx, 'template-catalog', 'Template catalog'),
    runCheck(checkApiTokens, ctx, 'api-tokens', 'API tokens'),
    runCheck(checkAllowedOrigins, ctx, 'allowed-origins', 'Browser origins')
  ]);

  // A null is a check that had nothing to measure — no agent paired, no API
  // tokens issued. Omitted rather than rendered as a grey "not configured" row,
  // which would put a permanent non-problem on a report whose entire job is
  // telling you where to look.
  const checks = results.filter((c): c is DiagnosticCheck => c !== null);

  const counts: Record<CheckStatus, number> = { pass: 0, warn: 0, fail: 0, unknown: 0 };
  for (const c of checks) counts[c.status] += 1;

  return {
    generatedAt: now,
    measuredOn: {
      kind: executionHost.kind,
      hostname: executionHost.hostname,
      os: executionHost.os,
      summary: executionHost.summary
    },
    checks,
    counts,
    worst: worstOf(checks)
  };
}
