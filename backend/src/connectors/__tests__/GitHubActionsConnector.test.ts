import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HealthState } from '@prisma/client';

vi.mock('../../db.js', () => ({
  prisma: { platformCapability: { findFirst: vi.fn() } }
}));
vi.mock('../../services/githubActions.js', () => ({
  listWorkflows: vi.fn(),
  listWorkflowRuns: vi.fn(),
  listRunJobs: vi.fn(),
  workflowSchedules: vi.fn()
}));

import { GitHubActionsConnector } from '../GitHubActionsConnector.js';
import { prisma } from '../../db.js';
import { listWorkflows, listWorkflowRuns, listRunJobs, workflowSchedules } from '../../services/githubActions.js';

const listWorkflowsMock = vi.mocked(listWorkflows);
const listRunsMock = vi.mocked(listWorkflowRuns);
const schedulesMock = vi.mocked(workflowSchedules);
const listJobsMock = vi.mocked(listRunJobs);
const findFirst = vi.mocked(prisma.platformCapability.findFirst);

import { PlatformType } from '@prisma/client';
import { TaskService } from '../../services/TaskService.js';

const connector = new GitHubActionsConnector();

/**
 * The tasks half of the sync, so the assertions below read as they did before
 * `syncTasks` started also reporting what it *looked at*. The notes have their
 * own describe block — every other case here is about what was found.
 */
const syncedTasks = async (config: unknown) => (await connector.syncTasks(config)).tasks;

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

/**
 * **The tracked set here is declared, not observed — and getting that wrong made
 * the whole connector silently import nothing.**
 *
 * A plain Sync (`POST /tasks/sync` with `scope: 'tracked'`) filters the
 * connector's output to categories that are already tracked. On Windows that set
 * is derived from stored rows, because a folder becomes tracked by being picked
 * in the discovery modal and the rows are the only record that happened. GitHub
 * keeps that record in its **config**: the repositories you watch. Deriving it
 * from rows meant a freshly added repository had none, the include-set came back
 * empty, every workflow it reported was filtered out, and Sync said *"Tasks
 * synced."* over nothing — with no second gesture to reach for, because the
 * discovery modal talks to the Windows agent. Found on a live install
 * 2026-08-24, on the first connection to a real repository.
 */
describe('trackedCategories', () => {
  it('names every watched repository, so adding one is what adopts it', () => {
    expect(connector.trackedCategories(config({
      repositories: [{ owner: 'acme', repo: 'website' }, { owner: 'acme', repo: 'api' }]
    }))).toEqual(['acme/website', 'acme/api']);
  });

  it('matches the category the sync route derives from the same task', async () => {
    // **The whole fix rests on these two agreeing**, and they are computed in
    // different places from different inputs: this list comes from the config,
    // while the route compares it against `extractCategory(externalId)`. If
    // either changes shape, an equal-looking pair of strings is the only thing
    // between a working sync and one that filters out everything it just read —
    // silently, and reported as success.
    okWorkflows([workflow()]);
    const [task] = await syncedTasks(config());
    const routeCategory = TaskService.extractCategory(task.externalId, PlatformType.GITHUB_ACTIONS);

    expect(connector.trackedCategories(config())).toContain(routeCategory);
  });

  it('is empty when nothing is watched, and that must not read as "sync everything"', () => {
    expect(connector.trackedCategories(config({ repositories: [] }))).toEqual([]);
  });
});

describe('syncTasks', () => {
  it('returns one task per scheduled workflow, keyed on the workflow id', () => {
    okWorkflows([workflow()]);
    return syncedTasks(config()).then(tasks => {
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
    expect(await syncedTasks(config())).toEqual([]);
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

    const tasks = await syncedTasks(config());
    expect(tasks).toHaveLength(1);
    expect(tasks[0].schedule).toBeNull();
    expect(tasks[0].metadata.scheduleReason).toMatch(/could not parse/);
  });

  it('carries every cron when a workflow declares several', async () => {
    okWorkflows([workflow()]);
    schedulesMock.mockResolvedValue({ ok: true, data: { crons: ['0 6 * * *', '0 18 * * *'] } } as never);

    const [task] = await syncedTasks(config());
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
    const [task] = await syncedTasks(config());
    expect(task.nextRunTime).toBeNull();
  });

  it('reports a workflow GitHub disabled for inactivity as DISABLED, with the reason', async () => {
    // GitHub does this silently after 60 days of repository quiet. A workflow
    // someone believes is nightly having stopped two months ago is exactly what
    // this observer exists to surface.
    okWorkflows([workflow({ state: 'disabled_inactivity' })]);
    const [task] = await syncedTasks(config());
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

    const [task] = await syncedTasks(config());
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

    const [task] = await syncedTasks(config());
    expect(task.metadata.lastConclusion).toBe('success');
    expect(task.metadata.failureStreak).toBeUndefined();
  });

  it('marks run evidence absent when the run query itself failed', async () => {
    // `reportsRunResult: false`, so `taskHealth` scores nothing rather than
    // reading silence as "never ran" — the distinction that stopped an
    // un-republished Windows agent flagging every task on the machine at once.
    okWorkflows([workflow()]);
    listRunsMock.mockResolvedValue({ ok: false, status: 403, message: 'rate limited' } as never);

    const [task] = await syncedTasks(config());
    expect(task.metadata.reportsRunResult).toBe(false);
  });

  it('keeps syncing the other repositories when one fails', async () => {
    // One revoked scope must not flip every other workflow to MISSING.
    listWorkflowsMock
      .mockResolvedValueOnce({ ok: false, status: 404, message: 'gone' } as never)
      .mockResolvedValueOnce({ ok: true, data: { workflows: [workflow({ id: 7 })], total: 1 } } as never);

    const tasks = await syncedTasks(
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
    await expect(syncedTasks(config())).rejects.toThrow(/token rejected/);
  });

  it('marks a truncated workflow list partial, so nothing is retired from it', async () => {
    // GitHub returns at most 100 per page, and a task absent from a narrowed
    // enumeration is not evidence the task is gone — reading the first hundred
    // and reconciling would mark the rest MISSING (#74's shape).
    //
    // This used to *throw*, which stopped reconciliation only as a side effect
    // and only when the truncated read also happened to find no scheduled
    // workflow. With one found, the same truncation was discarded silently.
    // `partial` states the fact directly, so the protection no longer depends on
    // the count coming out at zero.
    okWorkflows([workflow()], 140);
    schedulesMock.mockResolvedValue({ ok: true, data: { crons: [] } } as never);

    const outcome = await connector.syncTasks(config());
    expect(outcome.partial).toBe(true);
    expect(outcome.warnings?.join(' ')).toMatch(/140 workflows/);
  });

  it('marks a sync partial when one repository could not be read', async () => {
    listWorkflowsMock
      .mockResolvedValueOnce({ ok: true, data: { workflows: [workflow()], total: 1 } } as never)
      .mockResolvedValueOnce({ ok: false, status: 404, message: 'GitHub returned 404.' } as never);

    const outcome = await connector.syncTasks(config({
      repositories: [{ owner: 'acme', repo: 'website' }, { owner: 'acme', repo: 'private' }]
    }));

    // A revoked scope on one repository must not retire the workflows in it.
    expect(outcome.partial).toBe(true);
    expect(outcome.tasks).toHaveLength(1);
  });

  it('is not partial when every repository was read whole', async () => {
    okWorkflows([workflow()]);
    expect((await connector.syncTasks(config())).partial).toBe(false);
  });

  it('reads nothing at all without a token or repositories', async () => {
    expect(await syncedTasks({ repositories: [] })).toEqual([]);
    expect(await syncedTasks({ token: 'ghp_x', repositories: [] })).toEqual([]);
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

/**
 * **"Found nothing" and "looked at nothing" render the same**, and that
 * ambiguity is not theoretical: it hid a real defect until the database was read
 * by hand (#75), while the ordinary case it imitates — a repository whose
 * workflows all run on `push` — is working perfectly. So the sync reports what
 * it *looked at*, not only what it kept.
 */
describe('what the sync says it covered', () => {
  it('counts what it read and what was scheduled, even when it found nothing', async () => {
    schedulesMock.mockResolvedValue({ ok: true, data: { crons: [] } } as never);
    okWorkflows([workflow(), workflow({ id: 43, path: '.github/workflows/deploy.yml' })]);

    const { tasks, notes } = await connector.syncTasks(config());
    expect(tasks).toHaveLength(0);
    expect(notes?.[0]).toBe('GitHub Actions: read 2 workflows across 1 repository, 0 scheduled.');
  });

  it('names a repository whose workflows are all push-triggered', async () => {
    // Named rather than counted: with several watched repositories, "0
    // scheduled" does not say WHICH one you were expecting something from.
    schedulesMock.mockResolvedValue({ ok: true, data: { crons: [] } } as never);
    okWorkflows([workflow()]);

    const { notes } = await connector.syncTasks(config());
    expect(notes).toContain('acme/website has no scheduled workflows — nothing there runs on a clock.');
  });

  it('says nothing about a repository that has no workflows at all', async () => {
    // There is no expectation to correct: an empty `.github/workflows` is not a
    // surprise anyone needs a sentence about.
    okWorkflows([]);
    const { notes } = await connector.syncTasks(config());
    expect(notes?.some(n => n.includes('no scheduled workflows'))).toBe(false);
  });

  it('reports a truncated listing as a warning, not as coverage', async () => {
    // It used to be pushed onto `failures`, which is read ONLY when every
    // repository failed — so the one warning about a partial read was discarded
    // in exactly the case it described. A warning survives the "hide success
    // toasts" preference; coverage does not, and this must be seen.
    okWorkflows([workflow()], 137);
    const { notes, warnings } = await connector.syncTasks(config());

    expect(warnings?.[0]).toMatch(/137 workflows, of which Cronsole read 1/);
    expect(notes?.join(' ')).not.toMatch(/137/);
  });

  it('reports a repository it could not read while returning the ones it could', async () => {
    listWorkflowsMock
      .mockResolvedValueOnce({ ok: true, data: { workflows: [workflow()], total: 1 } } as never)
      .mockResolvedValueOnce({ ok: false, status: 404, message: 'GitHub returned 404.' } as never);

    const { tasks, warnings } = await connector.syncTasks(config({
      repositories: [{ owner: 'acme', repo: 'website' }, { owner: 'acme', repo: 'private' }]
    }));

    // A partial failure returns what it has — and now says what it lost, instead
    // of dropping that on the floor whenever one other repository worked.
    expect(tasks).toHaveLength(1);
    expect(warnings?.some(w => w.includes('acme/private'))).toBe(true);
  });

  it('still throws when every repository failed, rather than reporting it as a note', async () => {
    // A caller must not have to read prose to find out the sync failed: an empty
    // list from a connection that HAS repositories would be read as "every
    // workflow was deleted" by `reconcileMissingTasks`.
    listWorkflowsMock.mockResolvedValue({ ok: false, status: 500, message: 'GitHub server error.' } as never);
    await expect(connector.syncTasks(config())).rejects.toThrow(/GitHub server error/);
  });
});

describe('an observer reads its own run history without softening its boundary', () => {
  const config = { token: 'ghp_x', repositories: [{ owner: 'acme', repo: 'site' }] };
  const connector = new GitHubActionsConnector();
  const id = 'acme/site#42';

  beforeEach(() => vi.clearAllMocks());

  it('still refuses every write verb', () => {
    // Implementing a READ verb must not read as the observer growing writes.
    expect(connector.unsupportedVerbs).toEqual(['run', 'create', 'setStatus']);
  });

  it('lists scheduled runs and marks the settled ones openable', async () => {
    listRunsMock.mockResolvedValue({
      ok: true,
      data: [
        { id: 7, runAttempt: 1, conclusion: 'failure', status: 'completed', run_started_at: '2026-08-25T03:00:00Z', updated_at: '2026-08-25T03:04:00Z', html_url: 'u', event: 'schedule' },
        // Still running: no conclusion yet, so there are no step outcomes to open.
        { id: 8, runAttempt: 1, conclusion: null, status: 'in_progress', run_started_at: '2026-08-25T04:00:00Z', updated_at: null, html_url: 'u', event: 'schedule' }
      ]
    } as never);

    const result = await connector.listPlatformRuns!(id, config);
    expect(result.runs![0]).toMatchObject({ id: '7', status: 'failure', outputAvailable: true });
    expect(result.runs![1]).toMatchObject({ id: '8', status: 'in_progress', outputAvailable: false });
  });

  it('names the failing step, which is the whole reason to open a run', async () => {
    listRunsMock.mockResolvedValue({
      ok: true,
      data: [{ id: 7, runAttempt: 1, conclusion: 'failure', status: 'completed', run_started_at: null, updated_at: null, html_url: 'u', event: 'schedule' }]
    } as never);
    listJobsMock.mockResolvedValue({
      ok: true,
      data: [{
        name: 'build',
        conclusion: 'failure',
        steps: [
          { name: 'Checkout', conclusion: 'success' },
          { name: 'Run tests', conclusion: 'failure' }
        ]
      }]
    } as never);

    const result = await connector.getRunOutput!(id, '7', config);
    expect(result.output!.text).toContain('Run tests');
    expect(result.output!.steps).toEqual(['Checkout', 'Run tests']);
    // The full console log is a zip behind a redirect on github.com. Cronsole
    // links to it rather than pretending to own a copy it cannot redact.
    expect(result.output!.url).toBe('https://github.com/acme/site/actions/runs/7');
  });

  it('qualifies step names with their job when a run has more than one', async () => {
    // Two matrix jobs routinely share step names, and an unqualified "Run tests"
    // appearing twice reads as a repeat rather than as two machines.
    listRunsMock.mockResolvedValue({
      ok: true,
      data: [{ id: 7, runAttempt: 1, conclusion: 'failure', status: 'completed', run_started_at: null, updated_at: null, html_url: 'u', event: 'schedule' }]
    } as never);
    listJobsMock.mockResolvedValue({
      ok: true,
      data: [
        { name: 'linux', conclusion: 'success', steps: [{ name: 'Run tests', conclusion: 'success' }] },
        { name: 'windows', conclusion: 'failure', steps: [{ name: 'Run tests', conclusion: 'failure' }] }
      ]
    } as never);

    const result = await connector.getRunOutput!(id, '7', config);
    expect(result.output!.steps).toEqual(['linux › Run tests', 'windows › Run tests']);
    expect(result.output!.text).toContain('windows › Run tests');
  });

  it('explains a run that never started a job instead of showing nothing', async () => {
    listRunsMock.mockResolvedValue({
      ok: true,
      data: [{ id: 7, runAttempt: 1, conclusion: 'cancelled', status: 'completed', run_started_at: null, updated_at: null, html_url: 'u', event: 'schedule' }]
    } as never);
    listJobsMock.mockResolvedValue({ ok: true, data: [] } as never);

    const result = await connector.getRunOutput!(id, '7', config);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/no jobs/i);
  });

  it('refuses an externalId it cannot parse rather than calling GitHub', async () => {
    expect(await connector.listPlatformRuns!('not-an-id', config)).toMatchObject({ success: false });
    expect(listRunsMock).not.toHaveBeenCalled();
  });
});
