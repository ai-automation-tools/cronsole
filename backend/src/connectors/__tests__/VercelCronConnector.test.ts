import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HealthState, PlatformType } from '@prisma/client';

vi.mock('../../db.js', () => ({
  prisma: { platformCapability: { findFirst: vi.fn() } }
}));
vi.mock('../../services/vercelApi.js', () => ({
  getProject: vi.fn()
}));

import { VercelCronConnector } from '../VercelCronConnector.js';
import { prisma } from '../../db.js';
import { getProject } from '../../services/vercelApi.js';
import { TaskService } from '../../services/TaskService.js';

const getProjectMock = vi.mocked(getProject);
const findFirst = vi.mocked(prisma.platformCapability.findFirst);

const connector = new VercelCronConnector();

/** The tasks half of the sync — the notes have their own describe block. */
const syncedTasks = async (config: unknown) => (await connector.syncTasks(config)).tasks;

const config = (over: Record<string, unknown> = {}) => ({
  token: 'A1b2C3d4E5f6G7h8I9j0K1l2',
  projects: [{ id: 'prj_abc', name: 'website' }],
  userId: 'user-1',
  ...over
});

const definition = (over: Record<string, unknown> = {}) => ({
  host: 'website.vercel.app',
  path: '/api/cron',
  schedule: '0 9 * * *',
  ...over
});

const okProject = (over: Record<string, unknown> = {}) =>
  getProjectMock.mockResolvedValue({
    ok: true,
    data: {
      id: 'prj_abc',
      name: 'website',
      crons: { enabledAt: 1, disabledAt: null, updatedAt: 2, deploymentId: 'dpl_1', definitions: [definition()] },
      teamId: null,
      ...over
    }
  } as never);

beforeEach(() => {
  vi.clearAllMocks();
  findFirst.mockResolvedValue(null as never);
  okProject();
});

describe('the boundary is declared, not implied', () => {
  it('names the three interface-mandated verbs it cannot perform', () => {
    // A **fixed array**, unlike Claude's getter: no token, scope or team makes
    // Cronsole write a vercel.json, and no scope turns a hand-made HTTP request
    // into a scheduled invocation. A constant is the honest shape when the
    // boundary is a property of the connector's design rather than the install.
    expect([...connector.unsupportedVerbs!].sort()).toEqual(['create', 'run', 'setStatus']);
  });

  it('leaves the optional verbs unsupported by absence, not by listing them twice', () => {
    // `verbReachability` reads `typeof connector.deleteTask === 'function'`, so
    // listing these in `unsupportedVerbs` too would be a second statement of one
    // fact, free to disagree with the first.
    const c = connector as Record<string, unknown>;
    for (const verb of ['deleteTask', 'exportTask', 'importTask', 'updateSchedule', 'updateActions', 'listFolders']) {
      expect(c[verb], `${verb} should be absent, not implemented`).toBeUndefined();
    }
  });

  for (const [verb, call] of [
    ['run', () => connector.runTask()],
    ['setStatus', () => connector.setTaskStatus()],
    ['create', () => connector.createTask()]
  ] as const) {
    it(`${verb} refuses with a reason a user can act on`, async () => {
      const result = await call();
      expect(result.success).toBe(false);
      // Not a bare "unsupported": each message says where the thing *can* be
      // done, because a refusal that names no alternative is a dead end.
      expect(result.message).toMatch(/Vercel/);
      expect(result.message!.length).toBeGreaterThan(40);
    });
  }
});

describe('trackedCategories — declared, not derived from rows', () => {
  it('reads the watched projects out of the config', () => {
    // Troubleshooting #75's lesson, inherited. Deriving the include-set from
    // stored rows makes *adding a project* unable to adopt anything — a fresh
    // one has no rows, so every cron it reports is filtered out and Sync reports
    // success over nothing, with no discovery modal to escape through.
    expect(
      connector.trackedCategories(config({ projects: [{ id: 'a', name: 'website' }, { id: 'b', name: 'blog' }] }))
    ).toEqual(['website', 'blog']);
  });

  it('is the same string TaskService derives as the category', async () => {
    // The two must agree or a refresh filters out exactly the rows it just made.
    const [task] = await syncedTasks(config());
    expect(TaskService.extractCategory(task!.externalId, PlatformType.VERCEL_CRON)).toBe('website');
    expect(connector.trackedCategories(config())).toContain('website');
  });
});

describe('syncTasks', () => {
  it('does nothing without a token or a project', async () => {
    expect(await syncedTasks({ projects: [] })).toEqual([]);
    expect(await syncedTasks({ token: 'x', projects: [] })).toEqual([]);
    expect(getProjectMock).not.toHaveBeenCalled();
  });

  it('reads a cron with its schedule from the one project request', async () => {
    // The contrast with GitHub that shapes this connector: no second fetch, no
    // YAML, no unreadable-file branch — the schedule is on the project object.
    const [task] = await syncedTasks(config());
    expect(getProjectMock).toHaveBeenCalledTimes(1);
    expect(task).toMatchObject({
      externalId: 'website#/api/cron',
      name: '/api/cron',
      status: 'ACTIVE',
      schedule: '0 9 * * *',
      nextRunTime: null
    });
  });

  it('never invents a next run time', async () => {
    // Vercel queues invocations best-effort (on Hobby, documented as within the
    // hour), so a locally computed next run would disagree with what happens and
    // nothing on screen would say which was right.
    const [task] = await syncedTasks(config());
    expect(task!.nextRunTime).toBeNull();
  });

  it('prefers a definition description over the raw path as the name', async () => {
    okProject({
      crons: {
        enabledAt: 1,
        disabledAt: null,
        updatedAt: 2,
        deploymentId: null,
        definitions: [definition({ description: 'Nightly digest' })]
      }
    });
    const [task] = await syncedTasks(config());
    expect(task!.name).toBe('Nightly digest');
  });

  it('collapses two schedules on one path into one row', async () => {
    // Vercel's own docs show the same path declared twice. `Task.schedule` is
    // one 5-field string, so the rest travel in metadata — the same shape a
    // GitHub workflow with several `on: schedule` entries gets. Two rows sharing
    // an id is not representable, and two fighting over one is worse.
    okProject({
      crons: {
        enabledAt: 1,
        disabledAt: null,
        updatedAt: 2,
        deploymentId: null,
        definitions: [definition({ schedule: '*/5 * * * *' }), definition({ schedule: '0 0 * * *' })]
      }
    });
    const tasks = await syncedTasks(config());
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.schedule).toBe('*/5 * * * *');
    expect(tasks[0]!.metadata.allSchedules).toEqual(['*/5 * * * *', '0 0 * * *']);
  });

  it('reports every cron as DISABLED when the project has crons turned off', async () => {
    // Vercel enables and disables crons for the whole project — there is no
    // per-cron switch — so this is one fact shared by every row rather than ten
    // independent ones, and the reason says so.
    okProject({
      crons: {
        enabledAt: 1,
        disabledAt: 99,
        updatedAt: 2,
        deploymentId: null,
        definitions: [definition(), definition({ path: '/api/other' })]
      }
    });
    const tasks = await syncedTasks(config());
    expect(tasks.map(t => t.status)).toEqual(['DISABLED', 'DISABLED']);
    expect(tasks[0]!.metadata.disabledReason).toMatch(/whole project/);
  });

  it('reports reportsRunResult: false present-and-false, never absent', async () => {
    // `taskHealth` reads this key to tell "the platform reported no runs" from
    // "Cronsole never asked". Vercel publishes no cron run history at all, so a
    // task here is `unknown` forever — and reading an absent key as "never ran"
    // is what flagged every Windows task on a real machine at once.
    const [task] = await syncedTasks(config());
    expect(task!.metadata).toHaveProperty('reportsRunResult', false);
  });
});

describe('a narrowed sync adds and refreshes, but retires nothing', () => {
  it('marks the pass partial when a project could not be read', async () => {
    // The #74 rule generalized off the agent: a task absent from a *narrowed*
    // enumeration is not evidence the task is gone. The 50%-retention guard does
    // not cover this — one unreadable project out of three looks plausible.
    getProjectMock
      .mockResolvedValueOnce({ ok: false, status: 404, message: 'Vercel returned 404 for the project prj_b.' } as never)
      .mockResolvedValueOnce({
        ok: true,
        data: { id: 'prj_c', name: 'blog', crons: { enabledAt: 1, disabledAt: null, updatedAt: 2, deploymentId: null, definitions: [definition()] } }
      } as never);

    const outcome = await connector.syncTasks(
      config({ projects: [{ id: 'prj_b', name: 'broken' }, { id: 'prj_c', name: 'blog' }] })
    );
    expect(outcome.partial).toBe(true);
    expect(outcome.tasks).toHaveLength(1);
  });

  it('names the project it could not read in warnings, not in notes', async () => {
    // `warnings` survive the "hide success toasts" preference and `notes` do
    // not. A partial read reported only as success noise is how a truncated sync
    // gets mistaken for a complete one.
    getProjectMock
      .mockResolvedValueOnce({ ok: false, status: 403, message: 'Vercel refused access (403).' } as never)
      .mockResolvedValueOnce({
        ok: true,
        data: { id: 'prj_c', name: 'blog', crons: { enabledAt: 1, disabledAt: null, updatedAt: 2, deploymentId: null, definitions: [definition()] } }
      } as never);

    const outcome = await connector.syncTasks(
      config({ projects: [{ id: 'prj_b', name: 'broken' }, { id: 'prj_c', name: 'blog' }] })
    );
    expect(outcome.warnings!.join(' ')).toContain('broken');
    expect(outcome.notes!.join(' ')).not.toContain('403');
  });

  it('throws when every project failed, rather than returning an empty list', async () => {
    // An empty list from a connection that *has* projects is indistinguishable
    // from "every cron was removed", and `reconcileMissingTasks` would act on
    // it. Throwing records the failure against the `sync` capability and skips
    // the reconcile step entirely.
    getProjectMock.mockResolvedValue({ ok: false, status: 401, message: 'Vercel rejected the token (401).' } as never);
    await expect(connector.syncTasks(config())).rejects.toThrow(/401/);
  });
});

describe('the sync reports what it looked at, not only what it kept', () => {
  it('always says how many projects it read and how many crons it found', async () => {
    // Troubleshooting #75: "found nothing" and "looked at nothing" render
    // identically, and that ambiguity hid a real defect until the DB was read by
    // hand.
    const outcome = await connector.syncTasks(config());
    expect(outcome.notes!.join(' ')).toMatch(/read 1 of 1 project, 1 cron job/);
  });

  it('names a project that has no crons rather than counting it', async () => {
    // A project with no `crons` block in its vercel.json is working exactly as
    // intended. Said plainly, not as a warning — an alarmed voice here trains
    // people to ignore the line that matters.
    okProject({ crons: null });
    const outcome = await connector.syncTasks(config());
    expect(outcome.notes!.join(' ')).toContain('website has no cron jobs');
    expect(outcome.warnings ?? []).toHaveLength(0);
  });

  it('warns when a project was renamed on Vercel', async () => {
    // The stored name is the category and rides inside every externalId, so a
    // rename re-keys the project's rows. Said out loud, because a category
    // silently changing and a sync silently breaking look identical from the
    // dashboard.
    okProject({ name: 'website-v2' });
    const outcome = await connector.syncTasks(config());
    expect(outcome.warnings!.join(' ')).toContain('website → website-v2');
  });
});

describe('getHealth reads stored evidence and never probes', () => {
  it('makes no request to Vercel', async () => {
    await connector.getHealth(config());
    expect(getProjectMock).not.toHaveBeenCalled();
  });

  it('is UNKNOWN with no token', async () => {
    const health = await connector.getHealth({ projects: [] });
    expect(health.state).toBe(HealthState.UNKNOWN);
  });

  it('is UNKNOWN when connected with nothing watched yet', async () => {
    // Never having synced is not a degradation, and amber over something nobody
    // can act on gets read at the same weight as amber over something they should.
    const health = await connector.getHealth(config({ projects: [] }));
    expect(health.state).toBe(HealthState.UNKNOWN);
    expect(health.reason).toMatch(/no projects/i);
  });

  it('is UNKNOWN when nothing has been read yet', async () => {
    const health = await connector.getHealth(config());
    expect(health.state).toBe(HealthState.UNKNOWN);
    expect(health.reason).toMatch(/none read yet/);
  });

  it('is DEGRADED when the last sync failed, and counts that as contact', async () => {
    const failed = new Date('2026-08-24T10:00:00Z');
    findFirst.mockResolvedValue({ lastSuccessAt: null, lastFailureAt: failed, lastFailureReason: 'boom' } as never);
    const health = await connector.getHealth(config());
    expect(health.state).toBe(HealthState.DEGRADED);
    // A rejection is contact: Vercel answered, and the answer was no.
    expect(health.lastContactAt).toEqual(failed);
  });

  it('is HEALTHY when the newest evidence is a success', async () => {
    const ok = new Date('2026-08-24T11:00:00Z');
    findFirst.mockResolvedValue({
      lastSuccessAt: ok,
      lastFailureAt: new Date('2026-08-24T09:00:00Z'),
      lastFailureReason: 'old'
    } as never);
    const health = await connector.getHealth(config());
    expect(health.state).toBe(HealthState.HEALTHY);
    expect(health.lastContactAt).toEqual(ok);
  });

  it('is UNKNOWN, not unhealthy, when the evidence cannot be read', async () => {
    // A DB hiccup is not the subject of the check, and must not be reported as
    // Vercel being unhealthy.
    findFirst.mockRejectedValue(new Error('db down') as never);
    const health = await connector.getHealth(config());
    expect(health.state).toBe(HealthState.UNKNOWN);
  });
});
