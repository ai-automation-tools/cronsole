import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HealthState } from '@prisma/client';

vi.mock('../../db.js', () => ({
  prisma: { platformCapability: { findFirst: vi.fn() } }
}));
vi.mock('../../services/githubActions.js', () => ({
  listWorkflows: vi.fn(),
  listWorkflowRuns: vi.fn(),
  workflowSchedules: vi.fn()
}));

import { GitHubActionsConnector } from '../GitHubActionsConnector.js';
import { prisma } from '../../db.js';
import { listWorkflows, listWorkflowRuns, workflowSchedules } from '../../services/githubActions.js';

const listWorkflowsMock = vi.mocked(listWorkflows);
const listRunsMock = vi.mocked(listWorkflowRuns);
const schedulesMock = vi.mocked(workflowSchedules);
const findFirst = vi.mocked(prisma.platformCapability.findFirst);

const connector = new GitHubActionsConnector();

const config = (over: Record<string, unknown> = {}) => ({
  token: 'ghp_test',
  repositories: [{ owner: 'acme', repo: 'website' }],
  userId: 'user-1',
  ...over
});

const workflow = (over: Record<string, unknown> = {}) => ({
  id: 42,
  name: 'Nightly',
  path: '.github/workflows/nightly.yml',
  state: 'active',
  html_url: 'https://github.com/acme/website/actions/workflows/nightly.yml',
  ...over
});

const okWorkflows = (rows: ReturnType<typeof workflow>[], total = rows.length) =>
  listWorkflowsMock.mockResolvedValue({ ok: true, data: { workflows: rows, total } } as never);

beforeEach(() => {
  vi.clearAllMocks();
  schedulesMock.mockResolvedValue({ ok: true, data: { crons: ['0 9 * * *'] } } as never);
  listRunsMock.mockResolvedValue({ ok: true, data: [] } as never);
  findFirst.mockResolvedValue(null as never);
});

/**
 * **This is Cronsole's first read-only observer, so the assertions are mostly
 * about what it does NOT do.**
 *
 * A partial connector used to lie: before the capability matrix learned
 * `unsupported` (2026-08-12), the UI implied every verb the interface mandated,
 * so a platform Cronsole could only read rendered a Run button that did nothing.
 * The boundary is now a cell — which only stays honest if the connector keeps
 * declaring it, so that is pinned first.
 */
describe('capability boundaries', () => {
  it('declares the three interface-mandated verbs it cannot perform', () => {
    expect([...connector.unsupportedVerbs]).toEqual(['run', 'create', 'setStatus']);
  });

  it('leaves the optional verbs unsupported by absence, not by a second list', () => {
    // `verbReachability` reads `typeof connector.deleteTask === 'function'`, so
    // absence IS the statement. Listing them in `unsupportedVerbs` too would be
    // a second statement of one fact, free to disagree with the first.
    const c = connector as unknown as Record<string, unknown>;
    for (const method of ['deleteTask', 'exportTask', 'importTask', 'updateSchedule', 'updateActions', 'listFolders']) {
      expect(c[method], method).toBeUndefined();
    }
    for (const verb of ['export', 'restore', 'delete', 'updateSchedule', 'updateAction', 'listFolders']) {
      expect(connector.unsupportedVerbs).not.toContain(verb);
    }
  });

  it('refuses run, create and setStatus with a reason rather than a silent false', () => {
    // The route answers 400 for these (`verbDeclaredUnsupported` picks the
    // status) — a verb the connector cannot perform is not the platform having
    // a moment. The message has to say where the verb does live.
    return Promise.all([
      connector.runTask().then(r => {
        expect(r.success).toBe(false);
        expect(r.message).toMatch(/Actions tab/);
      }),
      connector.setTaskStatus().then(r => {
        expect(r.success).toBe(false);
        expect(r.message).toMatch(/Actions tab/);
      }),
      connector.createTask().then(r => {
        expect(r.success).toBe(false);
        expect(r.message).toMatch(/committing a file/);
      })
    ]);
  });
});

describe('syncTasks', () => {
  it('returns one task per scheduled workflow, keyed on the workflow id', () => {
    okWorkflows([workflow()]);
    return connector.syncTasks(config()).then(tasks => {
      expect(tasks).toHaveLength(1);
      expect(tasks[0].externalId).toBe('acme/website#42');
      expect(tasks[0].schedule).toBe('0 9 * * *');
      expect(tasks[0].metadata.repository).toBe('acme/website');
    });
  });

  it('drops a workflow that genuinely has no schedule', async () => {
    // Read successfully, no cron: it runs on push or dispatch and is not a
    // scheduled task. A row with no cadence could only ever say "unknown".
    okWorkflows([workflow()]);
    schedulesMock.mockResolvedValue({ ok: true, data: { crons: [] } } as never);
    expect(await connector.syncTasks(config())).toEqual([]);
  });

  it('keeps a workflow whose file could not be read, and says why', async () => {
    // The distinction that matters: "Cronsole could not read this" and "this has
    // no schedule" demand different actions, and render identically unless the
    // reason travels. Troubleshooting #60's shape.
    okWorkflows([workflow()]);
    schedulesMock.mockResolvedValue({
      ok: true,
      data: { crons: [], reason: 'Cronsole could not parse the workflow file: bad indentation' }
    } as never);

    const tasks = await connector.syncTasks(config());
    expect(tasks).toHaveLength(1);
    expect(tasks[0].schedule).toBeNull();
    expect(tasks[0].metadata.scheduleReason).toMatch(/could not parse/);
  });

  it('carries every cron when a workflow declares several', async () => {
    okWorkflows([workflow()]);
    schedulesMock.mockResolvedValue({ ok: true, data: { crons: ['0 6 * * *', '0 18 * * *'] } } as never);

    const [task] = await connector.syncTasks(config());
    // `Task.schedule` is one 5-field string — the storage contract — so the rest
    // ride in metadata rather than being silently dropped.
    expect(task.schedule).toBe('0 6 * * *');
    expect(task.metadata.allSchedules).toEqual(['0 6 * * *', '0 18 * * *']);
  });

  it('never reports a next-run time', async () => {
    // GitHub queues scheduled runs best-effort and delays them under load, so a
    // time derived from the cron would disagree with reality with nothing on
    // screen to say which was right. Same call the Claude connector makes about
    // Anthropic's jitter, reached from the other direction.
    okWorkflows([workflow()]);
    const [task] = await connector.syncTasks(config());
    expect(task.nextRunTime).toBeNull();
  });

  it('reports a workflow GitHub disabled for inactivity as DISABLED, with the reason', async () => {
    // GitHub does this silently after 60 days of repository quiet. A workflow
    // someone believes is nightly having stopped two months ago is exactly what
    // this observer exists to surface.
    okWorkflows([workflow({ state: 'disabled_inactivity' })]);
    const [task] = await connector.syncTasks(config());
    expect(task.status).toBe('DISABLED');
    expect(task.metadata.disabledReason).toMatch(/60 days/);
  });

  it('carries the last run conclusion and a failure streak', async () => {
    okWorkflows([workflow()]);
    listRunsMock.mockResolvedValue({
      ok: true,
      data: [
        { conclusion: 'failure', status: 'completed', run_started_at: '2026-08-23T09:00:00Z', updated_at: null, html_url: 'u', event: 'schedule' },
        { conclusion: 'failure', status: 'completed', run_started_at: '2026-08-22T09:00:00Z', updated_at: null, html_url: 'u', event: 'schedule' },
        { conclusion: 'success', status: 'completed', run_started_at: '2026-08-21T09:00:00Z', updated_at: null, html_url: 'u', event: 'schedule' }
      ]
    } as never);

    const [task] = await connector.syncTasks(config());
    expect(task.metadata.lastConclusion).toBe('failure');
    expect(task.metadata.failureStreak).toBe(2);
    expect(task.metadata.scheduledRunCount).toBe(3);
    expect(task.metadata.reportsRunResult).toBe(true);
  });

  it('ignores a run still in flight rather than reading it as a failure', async () => {
    // `conclusion` is null until a run finishes. Reading that as a failure would
    // flag every workflow mid-run.
    okWorkflows([workflow()]);
    listRunsMock.mockResolvedValue({
      ok: true,
      data: [
        { conclusion: null, status: 'in_progress', run_started_at: '2026-08-23T09:00:00Z', updated_at: null, html_url: 'u', event: 'schedule' },
        { conclusion: 'success', status: 'completed', run_started_at: '2026-08-22T09:00:00Z', updated_at: null, html_url: 'u', event: 'schedule' }
      ]
    } as never);

    const [task] = await connector.syncTasks(config());
    expect(task.metadata.lastConclusion).toBe('success');
    expect(task.metadata.failureStreak).toBeUndefined();
  });

  it('marks run evidence absent when the run query itself failed', async () => {
    // `reportsRunResult: false`, so `taskHealth` scores nothing rather than
    // reading silence as "never ran" — the distinction that stopped an
    // un-republished Windows agent flagging every task on the machine at once.
    okWorkflows([workflow()]);
    listRunsMock.mockResolvedValue({ ok: false, status: 403, message: 'rate limited' } as never);

    const [task] = await connector.syncTasks(config());
    expect(task.metadata.reportsRunResult).toBe(false);
  });

  it('keeps syncing the other repositories when one fails', async () => {
    // One revoked scope must not flip every other workflow to MISSING.
    listWorkflowsMock
      .mockResolvedValueOnce({ ok: false, status: 404, message: 'gone' } as never)
      .mockResolvedValueOnce({ ok: true, data: { workflows: [workflow({ id: 7 })], total: 1 } } as never);

    const tasks = await connector.syncTasks(
      config({ repositories: [{ owner: 'acme', repo: 'dead' }, { owner: 'acme', repo: 'website' }] })
    );
    expect(tasks.map(t => t.externalId)).toEqual(['acme/website#7']);
  });

  it('throws rather than returning an empty list when every repository failed', async () => {
    // An empty list from a connection that HAS repositories is
    // indistinguishable from "every workflow was deleted", and
    // `reconcileMissingTasks` would act on it. Throwing records the failure
    // against the `sync` capability and skips reconciliation entirely.
    listWorkflowsMock.mockResolvedValue({ ok: false, status: 401, message: 'token rejected' } as never);
    await expect(connector.syncTasks(config())).rejects.toThrow(/token rejected/);
  });

  it('names a repository whose workflow list was truncated', async () => {
    // GitHub returns at most 100 per page. Reading the first hundred and
    // reporting success would mark the rest MISSING.
    okWorkflows([workflow()], 140);
    schedulesMock.mockResolvedValue({ ok: true, data: { crons: [] } } as never);
    await expect(connector.syncTasks(config())).rejects.toThrow(/140 workflows/);
  });

  it('reads nothing at all without a token or repositories', async () => {
    expect(await connector.syncTasks({ repositories: [] })).toEqual([]);
    expect(await connector.syncTasks({ token: 'ghp_x', repositories: [] })).toEqual([]);
    expect(listWorkflowsMock).not.toHaveBeenCalled();
  });
});

describe('getHealth', () => {
  it('never probes GitHub', async () => {
    // It runs on the dashboard's 45-second poll per open tab, against a
    // 5,000/hour rate limit, to answer a question sync answers for free. Same
    // conclusion the Windows and Claude connectors reached: sync is the probe.
    findFirst.mockResolvedValue({ lastSuccessAt: new Date(), lastFailureAt: null, lastFailureReason: null } as never);
    await connector.getHealth(config());
    expect(listWorkflowsMock).not.toHaveBeenCalled();
    expect(listRunsMock).not.toHaveBeenCalled();
  });

  it('is UNKNOWN, not DEGRADED, with no token', async () => {
    const health = await connector.getHealth({ repositories: [] });
    expect(health.state).toBe(HealthState.UNKNOWN);
  });

  it('is UNKNOWN with a token but nothing to read', async () => {
    const health = await connector.getHealth({ token: 'ghp_x', repositories: [], userId: 'u' });
    expect(health.state).toBe(HealthState.UNKNOWN);
    expect(health.reason).toMatch(/no repositories/i);
  });

  it('is UNKNOWN when nothing has been synced yet', async () => {
    // Never having synced is not a degradation. Amber over something nobody can
    // act on gets read at the same weight as amber over something they should.
    findFirst.mockResolvedValue(null as never);
    const health = await connector.getHealth(config());
    expect(health.state).toBe(HealthState.UNKNOWN);
    expect(health.reason).toMatch(/none read yet/);
  });

  it('is DEGRADED when the newest evidence is a failure, and names it', async () => {
    findFirst.mockResolvedValue({
      lastSuccessAt: new Date('2026-08-20T00:00:00Z'),
      lastFailureAt: new Date('2026-08-23T00:00:00Z'),
      lastFailureReason: 'GitHub rate limit reached (403)'
    } as never);

    const health = await connector.getHealth(config());
    expect(health.state).toBe(HealthState.DEGRADED);
    expect(health.reason).toMatch(/rate limit/);
    // A rejection is contact: GitHub answered, and the answer was no.
    expect(health.lastContactAt).toEqual(new Date('2026-08-23T00:00:00Z'));
  });

  it('is HEALTHY when the newest evidence is a success', async () => {
    const at = new Date('2026-08-23T10:00:00Z');
    findFirst.mockResolvedValue({ lastSuccessAt: at, lastFailureAt: null, lastFailureReason: null } as never);

    const health = await connector.getHealth(config());
    expect(health.state).toBe(HealthState.HEALTHY);
    expect(health.lastContactAt).toEqual(at);
  });

  it('reports UNKNOWN, never unhealthy, when the evidence itself cannot be read', async () => {
    // Reading the evidence is not the subject of the check — a DB hiccup here
    // must not be reported as GitHub being unhealthy.
    findFirst.mockRejectedValue(new Error('db down') as never);
    const health = await connector.getHealth(config());
    expect(health.state).toBe(HealthState.UNKNOWN);
  });

  it('never fabricates a timestamp', async () => {
    // A timestamp the observer generates can never be stale, which is why it can
    // never be true — troubleshooting #40/#42.
    findFirst.mockResolvedValue(null as never);
    const health = await connector.getHealth(config());
    expect(health.lastContactAt).toBeUndefined();
  });
});
