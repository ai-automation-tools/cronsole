import { PlatformType, HealthState } from '@prisma/client';
import { prisma } from '../db.js';
import { connectorRegistry } from '../connectors/registry.js';
import type { ConnectorHealth, PlatformConnector } from '../connectors/platform.interface.js';
import { deserializeConfig } from '../auth/connectionConfig.js';
import { executionHost, type ExecutionHost } from './runtimeContext.js';

/**
 * What Cronsole can actually do with each platform, and how we know.
 *
 * The Platforms tab used to be three bookmarks. Growing it into a capability
 * matrix raises one question that decides the whole design: **where does a cell's
 * value come from?**
 *
 * The tempting answer — `typeof connector.deleteTask === 'function'` — is wrong
 * twice over, and both ways matter:
 *
 *  1. **It is a claim about the code, not about this install.** A connector that
 *     implements `updateSchedule` says nothing about whether the agent on this
 *     machine has ever accepted one. That is precisely the shape `getHealth` was
 *     fixed for (troubleshooting #40): a verdict derived from something that
 *     cannot change when the subject fails.
 *  2. **For Cronsole-native it is factually false.** The DB row *is* the task, so
 *     `routes/tasks.ts` deletes, reschedules and exports native tasks itself,
 *     inside `if (task.platform === TASKHUB_NATIVE)` branches, without ever
 *     reaching a connector method. `CronsoleNativeConnector` implements none of
 *     those three, and a connector-derived matrix would report the platform as
 *     unable to do things it does every day.
 *
 * So this module splits the answer in two, and neither half can stand in for the
 * other:
 *
 *  - **Reachability** (`verbReachability`) — would the route accept this verb for
 *    this platform, or refuse it with a 400? A property of the *route*, which is
 *    what a user actually reaches. Derived from the connector where the route
 *    defers to the connector, and stated explicitly where the route handles the
 *    platform itself. Pinned by `__tests__/platformCapabilities.test.ts`.
 *  - **Evidence** (`PlatformCapability`) — has this verb ever actually succeeded
 *    here? Written by the routes as they run, read back as `lastSuccessAt`.
 *
 * A verb is `verified` only when both hold. Reachable-but-unproven is
 * `declared`, never `yes`.
 */

// Defined alongside the connector interface so a connector can name the verbs it
// cannot do without a service↔connector import cycle. Re-exported here because
// this module is where the rest of the app reads capability types from.
export type { CapabilityVerb } from '../connectors/platform.interface.js';
import type { CapabilityVerb } from '../connectors/platform.interface.js';

export type CapabilitySupport = 'verified' | 'declared' | 'unsupported';

export interface CapabilityDescriptor {
  verb: CapabilityVerb;
  label: string;
  /** What the verb does, in the user's terms — the matrix has no room to explain. */
  description: string;
}

/**
 * Ordered as the matrix renders them: read verbs first, then the ones that
 * change a task, then the one that destroys it. The order is the blast radius.
 */
export const CAPABILITY_VERBS: readonly CapabilityDescriptor[] = [
  { verb: 'sync', label: 'Sync', description: 'Read the tasks that exist on the platform.' },
  { verb: 'listFolders', label: 'List folders', description: 'Read the platform\'s real folder tree.' },
  { verb: 'run', label: 'Run now', description: 'Trigger a task outside its schedule.' },
  { verb: 'create', label: 'Create', description: 'Register a new task on the platform.' },
  { verb: 'setStatus', label: 'Enable / disable', description: 'Park a task without deleting it.' },
  { verb: 'updateSchedule', label: 'Edit schedule', description: 'Change when an existing task runs.' },
  { verb: 'updateAction', label: 'Edit action', description: 'Change what an existing task runs.' },
  { verb: 'export', label: 'Export', description: 'Write the task out in a portable native format.' },
  { verb: 'restore', label: 'Restore', description: 'Register a task back from an exported file.' },
  { verb: 'delete', label: 'Delete', description: 'Remove the real task from the platform.' }
] as const;

/**
 * Platforms the matrix covers: the ones with a connector, i.e. the ones Cronsole
 * can do anything to. Link-only platforms (ChatGPT, Jules, …) have no connector
 * and belong in the custom-links section, which is their honest home — listing
 * them here would be ten `unsupported` cells saying nothing.
 */
export const MATRIX_PLATFORMS: readonly PlatformType[] = [
  PlatformType.WINDOWS_TASK_SCHEDULER,
  PlatformType.TASKHUB_NATIVE,
  PlatformType.CLAUDE_CODE,
  PlatformType.GITHUB_ACTIONS
] as const;

export interface PlatformDescriptor {
  platform: PlatformType;
  label: string;
  /** One line on what this platform *is*, since two of the three are non-obvious. */
  summary: string;
  /** `experimental` platforms are scaffolds — say so rather than implying parity. */
  maturity: 'functional' | 'experimental';
  /**
   * Does this connector change things on its platform, or only read them?
   *
   * **Declared, not derived**, and that is the point. It would be easy to
   * compute — "every mutating cell is `unsupported`, so call it an observer" —
   * and the computed answer would be indistinguishable from a connector whose
   * write verbs merely happen to be unimplemented today. This says which of the
   * two it is: `observer` is a **finished shape**, chosen, not a controller
   * somebody stopped halfway through.
   *
   * It is a *judgement*, so it is the server's — like `isSystem`, the health
   * tier and task source. The Sources tab renders it; nothing re-derives it in
   * the browser (troubleshooting #20a).
   *
   * It says nothing about `maturity`, which answers a different question: how
   * stable the API underneath is. GitHub Actions is a `functional` `observer`;
   * Claude Code is an `experimental` `controller`.
   */
  access: 'controller' | 'observer';
}

export const PLATFORM_DESCRIPTORS: Record<string, PlatformDescriptor> = {
  [PlatformType.WINDOWS_TASK_SCHEDULER]: {
    platform: PlatformType.WINDOWS_TASK_SCHEDULER,
    label: 'Windows Task Scheduler',
    access: 'controller',
    summary: 'Your machine\'s own scheduler, reached through the local Cronsole agent.',
    maturity: 'functional'
  },
  [PlatformType.TASKHUB_NATIVE]: {
    platform: PlatformType.TASKHUB_NATIVE,
    label: 'Cronsole-native',
    access: 'controller',
    summary: 'Scheduled and executed by the Cronsole backend itself. No agent involved.',
    maturity: 'functional'
  },
  [PlatformType.CLAUDE_CODE]: {
    platform: PlatformType.CLAUDE_CODE,
    label: 'Claude Code Routines',
    // A controller **in both of its modes**: even the declared-registry install,
    // which can only fire a routine it was handed a token for, changes something
    // on the platform. What varies with the install is *which* verbs, which
    // `unsupportedVerbs` being a getter already reports per cell.
    access: 'controller',
    // **What this platform can do depends on the install**, which is why the
    // summary hedges where the verb cells do not. With a readable Claude Code
    // session Cronsole lists, creates, reschedules, pauses and fires routines;
    // without one it can only fire the ones you declared here with their own
    // token. `unsupportedVerbs` is a getter for exactly this reason, so the
    // per-verb cells are precise even though one sentence cannot be.
    //
    // This comment used to state, as the platform's shape, that Anthropic
    // "exposes exactly one routines endpoint (`/fire`)". That was true of the
    // documented API and false of the product — see troubleshooting #50.
    summary:
      'Fire, and — when Cronsole can read your Claude Code session — list, create, reschedule and pause ' +
      'routines. Deleting one always happens in claude.ai: no API exposes it.',
    // Experimental for a reason that got stronger, not weaker: the documented
    // /fire endpoint is a research preview behind a dated beta header, and the
    // fuller triggers API is undocumented and gated behind another. Both may
    // change shape without notice.
    maturity: 'experimental'
  },
  [PlatformType.GITHUB_ACTIONS]: {
    platform: PlatformType.GITHUB_ACTIONS,
    label: 'GitHub Actions',
    // **The first observer, and the reason this field exists.** Two of its three
    // refusals have working APIs behind them (`POST …/dispatches`,
    // `PUT …/disable`) and are refused anyway: a dispatched run is not the
    // scheduled run, and enabling a workflow is a repository-state change. A
    // reader who cannot tell "chosen" from "unfinished" reads ten struck-through
    // cells as a broken connector.
    access: 'observer',
    // **The one row where the summary leads with what Cronsole will not do**,
    // because that is the surprising half. Every other platform here can be
    // acted on, so a user arriving at a row of `unsupported` cells with no
    // explanation would read them as a broken connection rather than as the
    // shape of the integration. The matrix makes the boundary honest per verb;
    // this sentence makes it intentional.
    summary:
      'Read-only. Cronsole reads the scheduled workflows in the repositories you name, their crons ' +
      'and their real run outcomes, and changes nothing — running, pausing and editing happen on GitHub.',
    // Functional, not experimental, and the distinction is not modesty. Both of
    // GitHub's endpoints here are stable, documented, versioned REST — nothing
    // like Claude's dated beta headers. A connector is judged by whether what it
    // claims is true, not by how much of the interface it fills.
    maturity: 'functional'
  }
};

/**
 * The three verbs `routes/tasks.ts` performs for Cronsole-native without going
 * through a connector method, because for that platform the DB row *is* the
 * task. Listed here rather than inferred, so the exception is visible; the test
 * suite pins each one against the route that implements it.
 *
 * `restore` is deliberately absent: there is no native file format to restore
 * *from*, and export produces a JSON bundle no import route accepts yet.
 */
const NATIVE_ROUTE_HANDLED: readonly CapabilityVerb[] = [
  'updateSchedule',
  'export',
  'delete',
  // `PATCH /api/tasks/:id/job` rewrites the stored job spec directly. Native has
  // no `updateActions` connector method and never will — the DB row is the task
  // — so without this line the matrix reports the platform as unable to change
  // what it runs, which it does without an agent and while one is offline.
  'updateAction'
] as const;

/**
 * Would the route accept this verb for this platform?
 *
 * Not "does the connector have the method" — see the module comment. This is the
 * question the user is really asking, which is whether clicking the button does
 * something or produces a 400.
 */
export function verbReachability(platform: PlatformType, verb: CapabilityVerb): boolean {
  const connector = connectorRegistry.getConnector(platform);
  if (!connector) return false;

  // A verb the platform structurally cannot do outranks every rule below,
  // including the "required by the interface, therefore present" one — which is
  // exactly the case it exists to correct. See `unsupportedVerbs`.
  if (connector.unsupportedVerbs?.includes(verb)) return false;

  // Cronsole-native's route-level carve-outs. Checked before the connector
  // lookup below, which would otherwise report false for all three.
  if (platform === PlatformType.TASKHUB_NATIVE && NATIVE_ROUTE_HANDLED.includes(verb)) {
    return true;
  }

  switch (verb) {
    // Required by the interface — every connector has these.
    case 'sync':
    case 'run':
    case 'create':
    case 'setStatus':
      return true;
    // Optional on the interface; the route 400s when they are absent.
    case 'updateSchedule':
      return typeof connector.updateSchedule === 'function';
    case 'updateAction':
      return typeof connector.updateActions === 'function';
    case 'export':
      return typeof connector.exportTask === 'function';
    case 'restore':
      return typeof connector.importTask === 'function';
    case 'delete':
      return typeof connector.deleteTask === 'function';
    case 'listFolders':
      return typeof connector.listFolders === 'function';
    default: {
      // Exhaustiveness: a new verb must be classified here, not defaulted.
      const _never: never = verb;
      return _never;
    }
  }
}

/** Exposed for the test that pins the table against the connector objects. */
export function connectorFor(platform: PlatformType): PlatformConnector | undefined {
  return connectorRegistry.getConnector(platform);
}

/**
 * Did the connector declare this verb structurally impossible?
 *
 * Used by the routes to pick the **status code**, not the message: a verb the
 * platform cannot do is a `400` (the convention every optional verb already
 * follows — "others get an honest 400 from the route"), where a verb that was
 * attempted and refused is a `5xx`. Both used to be `5xx` for the four
 * interface-mandated verbs, so asking to pause a Claude routine — which has no
 * API and never will — returned *"502 Bad Gateway"*, i.e. **retry, the platform
 * is having a moment**. It is not having a moment.
 *
 * The *reason* still comes from the connector, so there is one place that says
 * why and one place that says how loudly.
 */
export function verbDeclaredUnsupported(platform: PlatformType, verb: CapabilityVerb): boolean {
  return connectorRegistry.getConnector(platform)?.unsupportedVerbs?.includes(verb) ?? false;
}

/**
 * Record that a verb succeeded or failed against a platform.
 *
 * **This never throws.** It observes a verb; it must not be able to fail the verb
 * it observes. A capability row that didn't get written costs one cell its
 * evidence — an exception escaping here would cost the user their task run.
 */
export async function recordCapability(
  userId: string,
  platform: PlatformType,
  verb: CapabilityVerb,
  ok: boolean,
  reason?: string | null
): Promise<void> {
  try {
    const now = new Date();
    const data = ok
      // Cleared, not left: a reason from March filed under a verb that works
      // today is the same stale-explanation bug `healthReason` already had.
      ? { lastSuccessAt: now, lastFailureAt: null, lastFailureReason: null }
      : { lastFailureAt: now, lastFailureReason: reason?.slice(0, 500) ?? null };

    await prisma.platformCapability.upsert({
      where: { userId_platform_verb: { userId, platform, verb } },
      create: { userId, platform, verb, ...data },
      update: data
    });
  } catch {
    // Swallowed on purpose — see the doc comment above.
  }
}

/**
 * The whole honesty rule, in one place so it can be tested and cannot be
 * re-derived differently at a second call site.
 *
 * `lastSuccessAt` absent means *no evidence*, which is `declared` — not a
 * negative verdict. Same reading the health scorer gives a field an
 * un-republished agent never reported: absence of evidence is `unknown`, never
 * `ok`, and never `broken` either.
 */
export function capabilitySupport(reachable: boolean, lastSuccessAt: Date | null | undefined): CapabilitySupport {
  if (!reachable) return 'unsupported';
  return lastSuccessAt ? 'verified' : 'declared';
}

export interface CapabilityCell {
  verb: CapabilityVerb;
  label: string;
  description: string;
  support: CapabilitySupport;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  lastFailureReason: string | null;
}

export interface PlatformMatrixRow {
  platform: PlatformType;
  label: string;
  summary: string;
  maturity: 'functional' | 'experimental';
  /** Controller or observer — see {@link PlatformDescriptor.access}. */
  access: 'controller' | 'observer';
  /** No PlatformConnection row yet — nothing has ever been asked of it. */
  configured: boolean;
  isActive: boolean;
  healthState: string | null;
  healthReason: string | null;
  /**
   * A real sync timestamp or null. Never stamped by the reader — the same rule
   * `GET /tasks/health` follows, and for the same reason: a timestamp the
   * observer generates can never be stale, which is why it can never be true.
   */
  lastSync: Date | null;
  /** Tracked tasks of this platform, so an empty row reads as empty, not broken. */
  taskCount: number;
  capabilities: CapabilityCell[];
  /** Newest `lastSuccessAt` across the row's verbs — "last verified". */
  lastVerifiedAt: Date | null;
  /**
   * **Where this platform's tasks actually execute** — Cronsole-native only.
   *
   * Native jobs run wherever this backend runs, which is the user's machine on a
   * host-run stack and a container's filesystem in the Dockerized one. Same task,
   * same UI, two different meanings, and the `EXEC` job type makes the difference
   * matter: a path that exists in Explorer is simply absent inside a container.
   * Reported here because the matrix is already the surface that answers "what
   * does this source actually do on *this* install".
   *
   * Absent for every other platform: a Windows task runs on the machine its agent
   * is on, which is not a fact about this process.
   */
  executionHost: ExecutionHost | null;
}

/**
 * Health for one connection, asked of the connector rather than read back from
 * the column.
 *
 * **Why this cannot be `conn.healthState`.** That column is written by exactly
 * one place — the loop in `GET /api/tasks/health`, which is the *dashboard's*
 * 45-second poll. Nothing on the MCP surface writes it (`get_task_health` wraps
 * `GET /tools/task-health`, a different route), so an agent-driven session with
 * no browser tab open reads whatever verdict the last poll happened to leave.
 * Measured on a live install: the matrix reported `OFFLINE / "Agent not
 * connected"` while `get_diagnostics` reported the agent connected **in the same
 * second**, and while this row's own `listFolders` cell carried a success from a
 * minute earlier. One call to the dashboard route flipped it to `HEALTHY` with
 * nothing changing on the agent.
 *
 * That is troubleshooting #40's shape moved down a layer: a verdict derived from
 * something that cannot change when the subject recovers. It is worse on this
 * surface than on the tab, because `list_platforms` is documented as the thing to
 * call *before* planning work — so a stale `OFFLINE` does not just look wrong, it
 * talks an agent out of work that would have succeeded.
 *
 * Asking the connector is still a **pure read**: `getHealth` may not have a side
 * effect and deliberately does not probe (Windows reads the in-memory socket and
 * liveness record; Claude reads run evidence already in `PlatformCapability`),
 * which is the same reason the diagnostics panel can call it on every render.
 *
 * A connector that throws yields `UNKNOWN`, never a healthy-looking gap: this is
 * a readout, and one platform failing to describe itself must not fail the matrix
 * for the rest — `runCheck`'s rule in `services/diagnostics.ts`.
 */
async function liveHealth(
  userId: string,
  conn: { platform: PlatformType; config: unknown }
): Promise<ConnectorHealth | null> {
  const connector = connectorRegistry.getConnector(conn.platform);
  if (!connector) return null;

  try {
    return await connector.getHealth({
      ...deserializeConfig(conn.config as Parameters<typeof deserializeConfig>[0]),
      userId
    });
  } catch {
    return { state: HealthState.UNKNOWN, reason: 'Health could not be determined' };
  }
}

/**
 * Assemble the matrix for one user. Pure read: it asks no platform anything, so
 * opening the tab cannot itself change what the tab reports. Health is derived
 * live per connection (see {@link liveHealth}) rather than read from the stored
 * column, which only the dashboard's poll refreshes.
 */
export async function buildPlatformMatrix(userId: string): Promise<PlatformMatrixRow[]> {
  const [connections, evidence, taskCounts] = await Promise.all([
    prisma.platformConnection.findMany({ where: { userId } }),
    prisma.platformCapability.findMany({ where: { userId } }),
    prisma.task.groupBy({ by: ['platform'], where: { userId }, _count: { _all: true } })
  ]);

  // Concurrent: these are in-memory/DB reads, and a connector that is slow to
  // describe itself must not add its latency to every other platform's row.
  const healthByPlatform = new Map<PlatformType, ConnectorHealth>();
  await Promise.all(
    connections.map(async conn => {
      const health = await liveHealth(userId, conn);
      if (health) healthByPlatform.set(conn.platform, health);
    })
  );

  const connByPlatform = new Map(connections.map(c => [c.platform, c]));
  const countByPlatform = new Map(taskCounts.map(t => [t.platform, t._count._all]));
  const evidenceKey = (p: PlatformType, v: string) => `${p}::${v}`;
  const evidenceByKey = new Map(evidence.map(e => [evidenceKey(e.platform, e.verb), e]));

  return MATRIX_PLATFORMS.map(platform => {
    const descriptor = PLATFORM_DESCRIPTORS[platform]!;
    const conn = connByPlatform.get(platform);

    const capabilities: CapabilityCell[] = CAPABILITY_VERBS.map(({ verb, label, description }) => {
      const reachable = verbReachability(platform, verb);
      const seen = evidenceByKey.get(evidenceKey(platform, verb));
      const support = capabilitySupport(reachable, seen?.lastSuccessAt);
      return {
        verb,
        label,
        description,
        support,
        lastSuccessAt: seen?.lastSuccessAt ?? null,
        lastFailureAt: seen?.lastFailureAt ?? null,
        lastFailureReason: seen?.lastFailureReason ?? null
      };
    });

    const lastVerifiedAt = capabilities.reduce<Date | null>((newest, cell) => {
      if (!cell.lastSuccessAt) return newest;
      return !newest || cell.lastSuccessAt > newest ? cell.lastSuccessAt : newest;
    }, null);

    // State and reason are taken from ONE source together, never mixed: a live
    // verdict carrying the stored explanation is the "stale reason under a fresh
    // state" bug `GET /api/tasks/health` already guards against one layer up. The
    // stored pair survives only where there is no connector to ask.
    const live = healthByPlatform.get(platform);
    const healthState = live ? live.state : (conn?.healthState ?? null);
    const healthReason = live ? (live.reason ?? null) : (conn?.healthReason ?? null);

    return {
      platform,
      label: descriptor.label,
      summary: descriptor.summary,
      maturity: descriptor.maturity,
      access: descriptor.access,
      configured: Boolean(conn),
      isActive: conn?.isActive ?? false,
      healthState,
      healthReason,
      lastSync: conn?.lastSync ?? null,
      taskCount: countByPlatform.get(platform) ?? 0,
      capabilities,
      lastVerifiedAt,
      executionHost: platform === PlatformType.TASKHUB_NATIVE ? executionHost : null
    };
  });
}
