import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HealthState } from '@prisma/client';

/**
 * **The diagnostics report is a reporting layer, so its honesty is the thing
 * under test.**
 *
 * Every case here pins a rule that a plausible "tidy-up" would break silently,
 * and each rule was paid for elsewhere in this repo:
 *
 *  - `unknown` outranks `pass` in the summary (troubleshooting #48). Rank it the
 *    other way and the panel prints a clean bill of health over a check that
 *    measured nothing — the one summary worse than an amber one.
 *  - A check that throws degrades to `unknown` and its siblings still run. An
 *    observer may not fail the thing it observes, nor the observations beside it.
 *  - The agent check reports **the connector's** verdict. Re-deriving health here
 *    would give one agent two health readings that can disagree, which is the
 *    drift shape of #20a aimed at the screen that exists to end that confusion.
 *  - A check with nothing to measure is **omitted**, never rendered as a pass.
 *
 * The last one has teeth: an omitted check and a passing check are visually
 * similar and arithmetically very different, and inventing a `pass` for an
 * absent agent is how a report ends up greenest on the install with the least
 * configured.
 */

vi.mock('../../db.js', () => ({
  prisma: {
    task: { count: vi.fn() },
    platformConnection: { findFirst: vi.fn(), findMany: vi.fn() },
    template: { count: vi.fn() },
    apiToken: { findMany: vi.fn() }
  }
}));

vi.mock('../../connectors/registry.js', () => ({
  connectorRegistry: { getConnector: vi.fn() }
}));

vi.mock('../../auth/connectionConfig.js', () => ({
  deserializeConfig: vi.fn(() => ({}))
}));

vi.mock('../../ws/AgentManager.js', () => ({
  agentManager: { getSocket: vi.fn(), getLiveness: vi.fn() }
}));

vi.mock('../../catalog/catalogSync.js', () => ({
  getLastCatalogSync: vi.fn()
}));

vi.mock('../NativeScheduler.js', () => ({
  MISSED_RUN_GRACE_MS: 5 * 60_000,
  nativeScheduler: { status: vi.fn() }
}));

vi.mock('../runtimeContext.js', () => ({
  executionHost: {
    kind: 'container',
    hostname: 'test-host',
    os: 'linux',
    evidence: '/.dockerenv exists',
    summary: 'Cronsole-native tasks run inside the backend container, not on your machine.'
  }
}));

import { prisma } from '../../db.js';
import { connectorRegistry } from '../../connectors/registry.js';
import { agentManager } from '../../ws/AgentManager.js';
import { getLastCatalogSync } from '../../catalog/catalogSync.js';
import { nativeScheduler } from '../NativeScheduler.js';
import { buildDiagnosticsReport, worstOf, type DiagnosticCheck } from '../diagnostics.js';

const mocked = (fn: unknown) => fn as unknown as ReturnType<typeof vi.fn>;

const NOW = new Date('2026-08-17T12:00:00.000Z');
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000);

/** The everything-is-fine baseline. Each case perturbs exactly one thing. */
function healthyWorld() {
  mocked(prisma.task.count).mockResolvedValue(0);
  mocked(prisma.template.count).mockResolvedValue(10);
  mocked(prisma.apiToken.findMany).mockResolvedValue([]);
  mocked(prisma.platformConnection.findFirst).mockResolvedValue(null);
  mocked(prisma.platformConnection.findMany).mockResolvedValue([]);
  mocked(connectorRegistry.getConnector).mockReturnValue(undefined);
  mocked(agentManager.getSocket).mockReturnValue(undefined);
  mocked(agentManager.getLiveness).mockReturnValue(undefined);
  mocked(getLastCatalogSync).mockReturnValue({
    at: minutesAgo(5),
    ok: true,
    count: 10,
    pruned: 0,
    source: 'bundled'
  });
  mocked(nativeScheduler.status).mockReturnValue({
    running: true,
    lastTickAt: minutesAgo(1),
    lastTickError: null,
    tickIntervalMs: 30_000
  });
  process.env.ALLOWED_ORIGINS = 'http://localhost:7373';
}

/** Pair a Windows agent whose health the connector reports as `state`. */
function withAgent(state: HealthState, reason: string | undefined, liveness: unknown) {
  mocked(prisma.platformConnection.findFirst).mockResolvedValue({ id: 'c1', config: {} });
  mocked(connectorRegistry.getConnector).mockReturnValue({
    getHealth: vi.fn().mockResolvedValue({ state, reason })
  });
  mocked(agentManager.getSocket).mockReturnValue(state === HealthState.OFFLINE ? undefined : ({} as never));
  mocked(agentManager.getLiveness).mockReturnValue(liveness);
}

const byId = (checks: DiagnosticCheck[], id: string) => checks.find(c => c.id === id);

beforeEach(() => {
  vi.clearAllMocks();
  healthyWorld();
});

describe('worstOf — unknown outranks pass', () => {
  const check = (status: DiagnosticCheck['status']): DiagnosticCheck => ({
    id: status, title: status, status, summary: '', facts: []
  });

  it('ranks fail > warn > unknown > pass', () => {
    expect(worstOf([check('pass'), check('unknown')])).toBe('unknown');
    expect(worstOf([check('unknown'), check('warn')])).toBe('warn');
    expect(worstOf([check('warn'), check('fail')])).toBe('fail');
    expect(worstOf([check('pass'), check('pass')])).toBe('pass');
  });

  it('never summarises a report containing an unmeasured check as passing', () => {
    // The #48 rule, stated as the thing it prevents. If this flips, a panel with
    // one unknown check reports "all clear" — and green tells you to stop looking.
    expect(worstOf([check('pass'), check('pass'), check('unknown')])).not.toBe('pass');
  });

  it('is pass for an empty list, because nothing observed is nothing wrong', () => {
    expect(worstOf([])).toBe('pass');
  });
});

describe('buildDiagnosticsReport — the report as a whole', () => {
  it('names the machine every check measured', async () => {
    const report = await buildDiagnosticsReport('u1', NOW);

    // A check running in the container reports the container's clock and disk,
    // not the user's. That qualifies every row, so it lives on the report.
    expect(report.measuredOn.kind).toBe('container');
    expect(report.measuredOn.hostname).toBe('test-host');
    expect(report.measuredOn.summary).toMatch(/container/i);
  });

  it('gives every check at least one fact, so no verdict travels alone', async () => {
    const report = await buildDiagnosticsReport('u1', NOW);

    expect(report.checks.length).toBeGreaterThan(0);
    for (const check of report.checks) {
      expect(check.facts.length, `${check.id} has no facts`).toBeGreaterThan(0);
    }
  });

  it('counts match the checks actually returned', async () => {
    const report = await buildDiagnosticsReport('u1', NOW);
    const total = Object.values(report.counts).reduce((a, b) => a + b, 0);

    expect(total).toBe(report.checks.length);
    expect(report.worst).toBe(worstOf(report.checks));
  });

  it('omits a check with nothing to measure rather than inventing a pass', async () => {
    // No agent paired and no API tokens issued: both checks have no subject.
    const report = await buildDiagnosticsReport('u1', NOW);

    expect(byId(report.checks, 'windows-agent')).toBeUndefined();
    expect(byId(report.checks, 'api-tokens')).toBeUndefined();
  });

  it('keeps reporting when one check throws, and calls that one unknown', async () => {
    // The database check is the one that talks to Prisma first.
    mocked(prisma.task.count).mockRejectedValue(new Error('connection refused'));

    const report = await buildDiagnosticsReport('u1', NOW);
    const db = byId(report.checks, 'database');

    expect(db?.status).toBe('unknown');
    expect(db?.facts.some(f => /connection refused/.test(f.value))).toBe(true);
    // The siblings survived — a report that dies on its third check is useless
    // exactly when it is needed.
    expect(byId(report.checks, 'backend')?.status).toBe('pass');
    expect(byId(report.checks, 'allowed-origins')).toBeDefined();
  });
});

describe('the Windows agent check', () => {
  it('reports the connector\'s verdict rather than deriving its own', async () => {
    withAgent(HealthState.DEGRADED, 'Agent connected but not responding (task:list timed out)', {
      connectedAt: minutesAgo(60),
      lastResponseAt: minutesAgo(30),
      lastFailureAt: minutesAgo(2),
      lastFailureVerb: 'task:list'
    });

    const check = byId((await buildDiagnosticsReport('u1', NOW)).checks, 'windows-agent');

    expect(check?.status).toBe('warn');
    // Verbatim from getHealth. If this panel composed its own sentence, the
    // dashboard strip and this screen could describe one agent two ways.
    expect(check?.summary).toBe('Agent connected but not responding (task:list timed out)');
  });

  it('surfaces the liveness evidence behind the verdict', async () => {
    withAgent(HealthState.DEGRADED, 'not responding', {
      connectedAt: minutesAgo(60),
      lastResponseAt: minutesAgo(30),
      lastFailureAt: minutesAgo(2),
      lastFailureVerb: 'task:folders',
      identity: { machineName: 'MIKE-DESKTOP', osVersion: 'Windows 11', at: minutesAgo(60) }
    });

    const check = byId((await buildDiagnosticsReport('u1', NOW)).checks, 'windows-agent')!;
    const facts = Object.fromEntries(check.facts.map(f => [f.label, f.value]));

    // This is the whole feature: "offline" becomes a diagnosis only once the
    // reasons already in AgentLiveness are on screen.
    expect(facts['Socket']).toBe('connected');
    expect(facts['Machine']).toBe('MIKE-DESKTOP');
    expect(facts['Last request timeout']).toMatch(/task:folders/);
    expect(facts['Last inbound event']).toMatch(/30m ago/);
  });

  it('does not render the agent\'s self-reported version', async () => {
    withAgent(HealthState.HEALTHY, undefined, {
      connectedAt: minutesAgo(10),
      lastResponseAt: minutesAgo(1),
      identity: { machineName: 'MIKE-DESKTOP', agentVersion: '1.0.0', at: minutesAgo(10) }
    });

    const check = byId((await buildDiagnosticsReport('u1', NOW)).checks, 'windows-agent')!;

    // The agent hardcodes "1.0.0", so it is identical on a build from today and
    // one published in June. Shown beside "Agent" it reads as a freshness claim
    // while carrying no information — so `connectedAt` is the staleness fact and
    // the version stays off the screen until the agent stamps a real build id.
    expect(check.facts.some(f => f.value.includes('1.0.0'))).toBe(false);
  });

  it('explains an UNKNOWN verdict in terms of the evidence\'s age', async () => {
    withAgent(HealthState.UNKNOWN, 'task:list timed out, and nothing has been asked of the agent since', {
      connectedAt: minutesAgo(600),
      lastResponseAt: minutesAgo(400),
      lastFailureAt: minutesAgo(300),
      lastFailureVerb: 'task:list'
    });

    const check = byId((await buildDiagnosticsReport('u1', NOW)).checks, 'windows-agent')!;

    expect(check.status).toBe('unknown');
    // The line that would have ended troubleshooting #48 in a minute.
    expect(check.facts.some(f => f.label === 'Why unknown')).toBe(true);
    expect(check.remedy).toMatch(/sync/i);
  });

  it('maps OFFLINE to a failing check with a remedy', async () => {
    withAgent(HealthState.OFFLINE, 'Agent not connected', undefined);

    const check = byId((await buildDiagnosticsReport('u1', NOW)).checks, 'windows-agent')!;

    expect(check.status).toBe('fail');
    expect(check.facts.some(f => f.label === 'Socket' && f.value === 'not connected')).toBe(true);
    expect(check.remedy).toBeTruthy();
  });
});

describe('task list freshness', () => {
  it('calls never-synced unknown, not a warning', async () => {
    mocked(prisma.platformConnection.findMany).mockResolvedValue([
      { platform: 'WINDOWS_TASK_SCHEDULER', lastSync: null }
    ]);

    const check = byId((await buildDiagnosticsReport('u1', NOW)).checks, 'sync-freshness')!;

    // A fresh install has never synced. That is an absence of evidence and the
    // correct state — warning about it greets a new user with a red row for
    // something they have not done yet.
    expect(check.status).toBe('unknown');
  });

  it('warns once the newest sync is over a day old', async () => {
    mocked(prisma.platformConnection.findMany).mockResolvedValue([
      { platform: 'WINDOWS_TASK_SCHEDULER', lastSync: minutesAgo(60 * 30) }
    ]);

    const check = byId((await buildDiagnosticsReport('u1', NOW)).checks, 'sync-freshness')!;

    expect(check.status).toBe('warn');
    expect(check.summary).toMatch(/not reflected here/);
  });
});

describe('the native scheduler check', () => {
  it('fails when the loop is not running', async () => {
    mocked(nativeScheduler.status).mockReturnValue({
      running: false, lastTickAt: null, lastTickError: null, tickIntervalMs: 30_000
    });

    const check = byId((await buildDiagnosticsReport('u1', NOW)).checks, 'native-scheduler')!;

    expect(check.status).toBe('fail');
    // Says what is NOT affected, so the reader does not conclude everything is down.
    expect(check.remedy).toMatch(/Windows Task Scheduler tasks are unaffected/);
  });

  it('is unknown while running but yet to complete a tick', async () => {
    mocked(nativeScheduler.status).mockReturnValue({
      running: true, lastTickAt: null, lastTickError: null, tickIntervalMs: 30_000
    });

    expect(byId((await buildDiagnosticsReport('u1', NOW)).checks, 'native-scheduler')!.status)
      .toBe('unknown');
  });

  it('warns when the loop is alive but its last tick is three intervals old', async () => {
    // `running: true` alone is the "a socket object exists" evidence #40 threw
    // out: the timer exists, and nothing has completed.
    mocked(nativeScheduler.status).mockReturnValue({
      running: true, lastTickAt: minutesAgo(10), lastTickError: null, tickIntervalMs: 30_000
    });

    const check = byId((await buildDiagnosticsReport('u1', NOW)).checks, 'native-scheduler')!;
    expect(check.status).toBe('warn');
  });

  it('warns on overdue native tasks even while ticking normally', async () => {
    mocked(prisma.task.count).mockResolvedValue(3);

    const check = byId((await buildDiagnosticsReport('u1', NOW)).checks, 'native-scheduler')!;
    expect(check.status).toBe('warn');
    expect(check.summary).toMatch(/past due/);
  });
});

describe('the template catalog check', () => {
  it('fails a broken sync while saying the app still works', async () => {
    mocked(getLastCatalogSync).mockReturnValue({
      at: minutesAgo(3), ok: false, error: 'Unique constraint failed on the fields: (`name`)'
    });

    const check = byId((await buildDiagnosticsReport('u1', NOW)).checks, 'template-catalog')!;

    expect(check.status).toBe('fail');
    expect(check.facts.some(f => f.label === 'Error')).toBe(true);
    // The failure is non-fatal by design, which is exactly why it is invisible:
    // the remedy has to say both halves or it reads as an outage.
    expect(check.remedy).toMatch(/nothing broke/i);
    expect(check.remedy).toMatch(/will not arrive/i);
  });

  it('is unknown before any sync has completed', async () => {
    mocked(getLastCatalogSync).mockReturnValue(null);

    expect(byId((await buildDiagnosticsReport('u1', NOW)).checks, 'template-catalog')!.status)
      .toBe('unknown');
  });
});

describe('the browser origins check', () => {
  it('warns on an unset list without calling it a failure', async () => {
    delete process.env.ALLOWED_ORIGINS;

    const check = byId((await buildDiagnosticsReport('u1', NOW)).checks, 'allowed-origins')!;

    // An unset value on a local-only install is an ordinary working setup, so
    // this is amber and the remedy says when it starts to matter.
    expect(check.status).toBe('warn');
    expect(check.remedy).toMatch(/Harmless on a local-only install/);
  });
});

describe('the API token check', () => {
  it('warns on an expired token and names the failure it causes', async () => {
    mocked(prisma.apiToken.findMany).mockResolvedValue([
      { name: 'Claude Code', expiresAt: minutesAgo(60) }
    ]);

    const check = byId((await buildDiagnosticsReport('u1', NOW)).checks, 'api-tokens')!;

    expect(check.status).toBe('warn');
    // An expired token does not fail loudly at the tool using it: the MCP
    // server's tools go *missing* rather than erroring (troubleshooting #8).
    expect(check.remedy).toMatch(/missing/);
  });

  it('passes a token with no expiry', async () => {
    mocked(prisma.apiToken.findMany).mockResolvedValue([{ name: 'Forever', expiresAt: null }]);

    expect(byId((await buildDiagnosticsReport('u1', NOW)).checks, 'api-tokens')!.status).toBe('pass');
  });
});
