import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HealthState, PlatformType } from '@prisma/client';

vi.mock('../../db.js', () => ({
  prisma: { platformCapability: { findFirst: vi.fn() } }
}));
vi.mock('../../services/geminiApi.js', () => ({
  listTriggers: vi.fn(),
  listExecutions: vi.fn(),
  runTrigger: vi.fn(),
  patchTrigger: vi.fn(),
  createTrigger: vi.fn(),
  deleteTrigger: vi.fn()
}));

import { GeminiTriggersConnector } from '../GeminiTriggersConnector.js';
import type { PlatformConnector } from '../platform.interface.js';
import { prisma } from '../../db.js';
import {
  listTriggers,
  listExecutions,
  runTrigger,
  patchTrigger,
  createTrigger,
  deleteTrigger
} from '../../services/geminiApi.js';
import { TaskService } from '../../services/TaskService.js';

const listTriggersMock = vi.mocked(listTriggers);
const listExecutionsMock = vi.mocked(listExecutions);
const runTriggerMock = vi.mocked(runTrigger);
const patchTriggerMock = vi.mocked(patchTrigger);
const createTriggerMock = vi.mocked(createTrigger);
const deleteTriggerMock = vi.mocked(deleteTrigger);
const findFirst = vi.mocked(prisma.platformCapability.findFirst);

const connector = new GeminiTriggersConnector();

/** The tasks half of the sync — the notes and warnings have their own blocks. */
const syncedTasks = async (config: unknown) => (await connector.syncTasks(config)).tasks;

const config = (over: Record<string, unknown> = {}) => ({
  apiKey: 'AIzaSyExampleKeyForTestsOnly0000000000000',
  userId: 'user-1',
  ...over
});

const trigger = (over: Record<string, unknown> = {}) => ({
  id: 'trg_abc',
  displayName: 'issue-solver',
  schedule: '0 9 * * *',
  timeZone: 'UTC',
  status: 'active' as const,
  nextRunTime: new Date('2026-08-25T09:00:00Z'),
  consecutiveFailureCount: 0,
  maxConsecutiveFailures: 5,
  agent: 'antigravity-preview-05-2026',
  input: 'Review open PRs',
  environmentType: 'remote',
  executionTimeoutSeconds: 600,
  ...over
});

const execution = (over: Record<string, unknown> = {}) => ({
  id: 'exe_1',
  status: 'succeeded',
  startTime: new Date('2026-08-24T09:00:00Z'),
  endTime: new Date('2026-08-24T09:04:00Z'),
  ...over
});

beforeEach(() => {
  vi.clearAllMocks();
  findFirst.mockResolvedValue(null as never);
  listTriggersMock.mockResolvedValue({ ok: true, data: [trigger()] } as never);
  listExecutionsMock.mockResolvedValue({ ok: true, data: [execution()] } as never);
});

describe('this connector is a controller, and says so by having no boundaries', () => {
  it('declares no unsupported verbs at all', () => {
    // The only connector in the repo with an empty array, and it is written out
    // rather than omitted so "no boundaries" and "nobody considered boundaries"
    // are visibly different. Every interface-mandated verb reaches a documented
    // endpoint here.
    expect(connector.unsupportedVerbs).toEqual([]);
  });

  it('implements the optional verbs it can honestly do, and only those', () => {
    expect(typeof connector.updateSchedule).toBe('function');
    expect(typeof connector.deleteTask).toBe('function');

    // Read through the interface, which is what `verbReachability` reads — a
    // `typeof connector.exportTask` on the concrete class does not typecheck
    // precisely *because* the method is absent, and an absent method is the
    // whole point: it is what makes the matrix report the verb `unsupported`,
    // so each boundary is stated exactly once. `updateActions` is the one that
    // means "not yet" rather than "cannot": editing a trigger's prompt needs a
    // form Cronsole does not have, and the cell is free to change when it does.
    const asInterface: PlatformConnector = connector;
    for (const verb of ['updateActions', 'exportTask', 'importTask', 'listFolders'] as const) {
      expect(asInterface[verb]).toBeUndefined();
    }
  });
});

describe('the tracked set is declared, and it is a constant', () => {
  it('names the one category every trigger lands in', () => {
    // #75's lesson: a connector whose tracked set is not derivable from stored
    // rows must declare it, or the first sync after connecting filters out
    // everything it just read and reports success over nothing. Here the answer
    // is a constant because the platform is flat.
    expect(connector.trackedCategories()).toEqual(['Gemini']);
  });

  it('agrees with the category the server derives from an id', () => {
    // One definition of "which category is this", checked against the other
    // side of it — the drift that took a whole folder out of every sync (#20a).
    expect(TaskService.extractCategory('trg_abc', PlatformType.GEMINI_TRIGGERS)).toBe('Gemini');
  });
});

describe('syncTasks', () => {
  it('maps a trigger to a task', async () => {
    const [task] = await syncedTasks(config());
    expect(task).toMatchObject({
      externalId: 'trg_abc',
      name: 'issue-solver',
      status: 'ACTIVE',
      schedule: '0 9 * * *'
    });
  });

  it('falls back to the id when a trigger has no display name', async () => {
    // A trigger created by a script often has none, and an empty name renders as
    // a blank row.
    listTriggersMock.mockResolvedValue({ ok: true, data: [trigger({ displayName: null })] } as never);
    const [task] = await syncedTasks(config());
    expect(task!.name).toBe('trg_abc');
  });

  it('reports the platform\'s next run time and never computes one', async () => {
    const [task] = await syncedTasks(config());
    expect(task!.nextRunTime).toEqual(new Date('2026-08-25T09:00:00Z'));

    listTriggersMock.mockResolvedValue({ ok: true, data: [trigger({ nextRunTime: null })] } as never);
    const [none] = await syncedTasks(config());
    // Null, not a value derived from the cron: a computed time would disagree
    // with the platform's own queuing with nothing on screen to say which was
    // right — the call all five connectors make.
    expect(none!.nextRunTime).toBeNull();
  });

  it('throws when the whole listing failed, rather than returning an empty list', async () => {
    // An empty list from a connection that has a key is indistinguishable from
    // "every trigger was deleted", and `reconcileMissingTasks` would act on it.
    listTriggersMock.mockResolvedValue({ ok: false, status: 403, message: 'Gemini refused access (403)' } as never);
    await expect(connector.syncTasks(config())).rejects.toThrow(/403/);
  });

  it('returns nothing without contacting the platform when no key is stored', async () => {
    const result = await connector.syncTasks({ userId: 'user-1' });
    expect(result.tasks).toEqual([]);
    expect(listTriggersMock).not.toHaveBeenCalled();
  });
});

describe('the zone is reconciled on the way in, and a refusal is never silent', () => {
  it('shifts a zoned schedule into UTC and keeps the original beside it', async () => {
    listTriggersMock.mockResolvedValue({
      ok: true,
      data: [trigger({ schedule: '0 9 * * *', timeZone: 'Asia/Tokyo' })]
    } as never);
    const [task] = await syncedTasks(config());

    expect(task!.schedule).toBe('0 0 * * *');
    // A shifted field must print what it was shifted from (#60), so the pair
    // travels with it rather than being discarded once converted.
    expect(task!.metadata).toMatchObject({
      platformSchedule: '0 9 * * *',
      platformTimeZone: 'Asia/Tokyo',
      scheduleShiftedToUtc: true
    });
  });

  it('stores no schedule and states the reason when it cannot convert', async () => {
    listTriggersMock.mockResolvedValue({
      ok: true,
      data: [trigger({ schedule: '0 9-17 * * 1-5', timeZone: 'America/New_York' })]
    } as never);
    const outcome = await connector.syncTasks(config());
    const [task] = outcome.tasks;

    // Null, never a guessed cron — "could not read this" and "has no schedule"
    // are different facts demanding different actions.
    expect(task!.schedule).toBeNull();
    expect((task!.metadata as Record<string, unknown>).scheduleUnavailableReason).toBeTruthy();
    // And it is a **warning**, not a note: a suppressible success line would let
    // an empty schedule column read as "this has no schedule".
    expect(outcome.warnings?.some(w => w.includes('time zone'))).toBe(true);
  });

  it('does not mark an unshifted UTC trigger as shifted', async () => {
    const [task] = await syncedTasks(config());
    expect((task!.metadata as Record<string, unknown>).scheduleShiftedToUtc).toBeUndefined();
    // Still kept, because "stored in UTC" is itself worth being able to see.
    expect((task!.metadata as Record<string, unknown>).platformTimeZone).toBe('UTC');
  });
});

describe('paused by a person and paused by the platform are different facts', () => {
  it('reports a user-paused trigger as DISABLED with no auto-pause reason', async () => {
    listTriggersMock.mockResolvedValue({ ok: true, data: [trigger({ status: 'paused' })] } as never);
    const outcome = await connector.syncTasks(config());
    const meta = outcome.tasks[0]!.metadata as Record<string, unknown>;

    expect(outcome.tasks[0]!.status).toBe('DISABLED');
    expect(meta.platformStatus).toBe('paused');
    expect(meta.disabledReason).toBeUndefined();
    expect(outcome.warnings ?? []).toEqual([]);
  });

  it('reports a platform-disabled trigger with its reason and a warning', async () => {
    // The signal this source exists to surface: an agent dead for a week looks
    // exactly like one somebody parked, unless the difference is said out loud.
    listTriggersMock.mockResolvedValue({
      ok: true,
      data: [trigger({ status: 'disabled', consecutiveFailureCount: 5 })]
    } as never);
    const outcome = await connector.syncTasks(config());
    const meta = outcome.tasks[0]!.metadata as Record<string, unknown>;

    expect(outcome.tasks[0]!.status).toBe('DISABLED');
    expect(meta.platformStatus).toBe('disabled');
    expect(meta.disabledReason).toMatch(/paused this trigger itself/);
    expect(outcome.warnings?.some(w => w.includes('paused this trigger itself'))).toBe(true);
  });

  it('treats a status it does not recognise as active rather than guessing', async () => {
    // A new fourth state read as paused would show a running trigger as parked.
    // `unknown` is wrong in neither direction, and it is recorded in metadata.
    listTriggersMock.mockResolvedValue({ ok: true, data: [trigger({ status: 'unknown' })] } as never);
    const [task] = await syncedTasks(config());
    expect(task!.status).toBe('ACTIVE');
    expect((task!.metadata as Record<string, unknown>).platformStatus).toBe('unknown');
  });
});

describe('run evidence: absent and empty are different answers', () => {
  it('reports run results when the execution list was read', async () => {
    const [task] = await syncedTasks(config());
    expect(task!.metadata).toMatchObject({
      reportsRunResult: true,
      executionCount: 1,
      lastStatus: 'succeeded'
    });
  });

  it('reports reportsRunResult false when the execution read failed, and keeps the task', async () => {
    // One rate-limited request must not flag every trigger in the account. False
    // scores nothing at all rather than reading as "never ran".
    listExecutionsMock.mockResolvedValue({ ok: false, status: 429, message: 'rate limit' } as never);
    const outcome = await connector.syncTasks(config());

    expect(outcome.tasks).toHaveLength(1);
    expect((outcome.tasks[0]!.metadata as Record<string, unknown>).reportsRunResult).toBe(false);
    expect((outcome.tasks[0]!.metadata as Record<string, unknown>).executionCount).toBeUndefined();
    expect(outcome.warnings?.some(w => w.includes('run history'))).toBe(true);
  });

  it('marks the pass partial when history was missed, so nothing is retired', async () => {
    // The #74 rule generalized: a narrowed view is not an emptier platform.
    listExecutionsMock.mockResolvedValue({ ok: false, status: 429, message: 'rate limit' } as never);
    expect((await connector.syncTasks(config())).partial).toBe(true);
  });

  it('is not partial when every trigger\'s history was read', async () => {
    expect((await connector.syncTasks(config())).partial).toBe(false);
  });

  it('counts only finished executions, so a run in progress is not evidence', async () => {
    listExecutionsMock.mockResolvedValue({
      ok: true,
      data: [execution({ id: 'exe_2', status: 'running' })]
    } as never);
    const [task] = await syncedTasks(config());
    expect((task!.metadata as Record<string, unknown>).executionCount).toBe(0);
  });
});

describe('the sync says what it looked at', () => {
  it('states the coverage even on a completely healthy run', async () => {
    const outcome = await connector.syncTasks(config());
    // "found nothing" and "looked at nothing" render identically otherwise —
    // the ambiguity that hid a real defect on GitHub until the DB was read by
    // hand (#75).
    expect(outcome.notes?.[0]).toMatch(/read 1 trigger, with run history for each/);
  });

  it('says so plainly when the account has no triggers', async () => {
    listTriggersMock.mockResolvedValue({ ok: true, data: [] } as never);
    const outcome = await connector.syncTasks(config());
    expect(outcome.tasks).toEqual([]);
    expect(outcome.notes?.[0]).toMatch(/read 0 triggers/);
  });
});

describe('runTask is a dispatch, not an outcome', () => {
  it('reports success with ran false', async () => {
    runTriggerMock.mockResolvedValue({ ok: true, data: { executionId: 'exe_9' } } as never);
    const result = await connector.runTask('trg_abc', config());

    expect(result.success).toBe(true);
    // Only Cronsole-native may set `ran: true` — there dispatch and execution are
    // the same act. Here an agent will work for minutes after this returns.
    expect(result.ran).toBe(false);
    expect(result.platformRunId).toBe('exe_9');
  });

  it('reports a platform refusal without claiming the job ran', async () => {
    runTriggerMock.mockResolvedValue({ ok: false, status: 404, message: 'gone' } as never);
    const result = await connector.runTask('trg_abc', config());
    expect(result).toMatchObject({ success: false, ran: false });
  });
});

describe('setTaskStatus is a real per-resource switch', () => {
  it('pauses with the platform\'s own vocabulary', async () => {
    patchTriggerMock.mockResolvedValue({ ok: true, data: trigger({ status: 'paused' }) } as never);
    await connector.setTaskStatus('trg_abc', false, config());
    expect(patchTriggerMock).toHaveBeenCalledWith(expect.any(String), 'trg_abc', { status: 'paused' });
  });

  it('says plainly that resuming clears the pause and not the cause', async () => {
    patchTriggerMock.mockResolvedValue({ ok: true, data: trigger() } as never);
    const result = await connector.setTaskStatus('trg_abc', true, config());
    expect(result.message).toMatch(/not the cause/);
  });
});

describe('updateSchedule takes the cron, and always writes UTC', () => {
  it('sends the normalized cron', async () => {
    patchTriggerMock.mockResolvedValue({ ok: true, data: trigger() } as never);
    await connector.updateSchedule('trg_abc', '0   7  * * *', config());
    // `patchTrigger` attaches `time_zone: UTC` to any schedule change — without
    // it, a trigger created in Buenos Aires would read Cronsole's UTC cron as
    // local time behind a 200.
    expect(patchTriggerMock).toHaveBeenCalledWith(expect.any(String), 'trg_abc', { schedule: '0 7 * * *' });
  });

  it('refuses a malformed cron as a client error, not a gateway failure', async () => {
    const result = await connector.updateSchedule('trg_abc', '0 7 * *', config());
    expect(result).toMatchObject({ success: false, clientError: true });
    expect(patchTriggerMock).not.toHaveBeenCalled();
  });

  it('passes a platform 400 through as a client error too', async () => {
    patchTriggerMock.mockResolvedValue({ ok: false, status: 400, message: 'bad schedule' } as never);
    const result = await connector.updateSchedule('trg_abc', '0 7 * * *', config());
    expect(result).toMatchObject({ success: false, clientError: true });
  });
});

describe('createTask writes a trigger, and never guesses its reach', () => {
  it('sends the prompt as the interaction input, with the configured agent', async () => {
    createTriggerMock.mockResolvedValue({ ok: true, data: trigger({ id: 'trg_new' }) } as never);
    const result = await connector.createTask('nightly', '0 3 * * *', 'Summarise yesterday', config());

    expect(result).toMatchObject({ success: true, externalId: 'trg_new', foldersCreated: [] });
    expect(createTriggerMock).toHaveBeenCalledWith(expect.any(String), {
      schedule: '0 3 * * *',
      displayName: 'nightly',
      // The default, because the config named none. It is a preview id with a
      // date in it, so it is configuration rather than a constant.
      agent: 'antigravity-preview-05-2026',
      input: 'Summarise yesterday'
    });
  });

  it('uses the agent the connection declares when there is one', async () => {
    createTriggerMock.mockResolvedValue({ ok: true, data: trigger() } as never);
    await connector.createTask('n', '0 3 * * *', 'p', config({ agent: 'antigravity-preview-11-2026' }));
    expect(createTriggerMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ agent: 'antigravity-preview-11-2026' })
    );
  });

  it('refuses a create with no prompt rather than sending an empty instruction', async () => {
    const result = await connector.createTask('nightly', '0 3 * * *', '   ', config());
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/needs a prompt/);
    expect(createTriggerMock).not.toHaveBeenCalled();
  });

  it('says the created trigger has no network allowlist', async () => {
    // Widening what an autonomous agent may reach is not a default a task
    // manager picks on someone's behalf — the `repositoryUrls` rule, and it is
    // stated rather than left to be discovered.
    createTriggerMock.mockResolvedValue({ ok: true, data: trigger() } as never);
    const result = await connector.createTask('n', '0 3 * * *', 'p', config());
    expect(result.message).toMatch(/no network allowlist/);
  });
});

describe('deleteTask', () => {
  it('reports success when the platform removed it', async () => {
    deleteTriggerMock.mockResolvedValue({ ok: true, data: null } as never);
    expect(await connector.deleteTask('trg_abc', config())).toEqual({ success: true });
  });

  it('refuses without a key rather than reporting a delete that never happened', async () => {
    const result = await connector.deleteTask('trg_abc', { userId: 'u' });
    expect(result.success).toBe(false);
    expect(deleteTriggerMock).not.toHaveBeenCalled();
  });
});

describe('getHealth reads stored evidence and never probes', () => {
  it('does not contact the platform', async () => {
    findFirst.mockResolvedValue({ lastSuccessAt: new Date(), lastFailureAt: null, lastFailureReason: null } as never);
    await connector.getHealth(config());
    // Sync is the user's probe — the fifth connector to reach that conclusion.
    expect(listTriggersMock).not.toHaveBeenCalled();
  });

  it('is UNKNOWN with no key', async () => {
    const health = await connector.getHealth({ userId: 'user-1' });
    expect(health.state).toBe(HealthState.UNKNOWN);
  });

  it('is UNKNOWN, not DEGRADED, before anything has been read', async () => {
    // Never having synced is not a degradation, and amber over something nobody
    // can act on gets read at the same weight as amber over something they should.
    const health = await connector.getHealth(config());
    expect(health.state).toBe(HealthState.UNKNOWN);
    expect(health.reason).toMatch(/nothing has been read yet/);
  });

  it('is HEALTHY after a successful sync', async () => {
    const at = new Date('2026-08-24T10:00:00Z');
    findFirst.mockResolvedValue({ lastSuccessAt: at, lastFailureAt: null, lastFailureReason: null } as never);
    const health = await connector.getHealth(config());
    expect(health).toMatchObject({ state: HealthState.HEALTHY, lastContactAt: at });
  });

  it('is DEGRADED when the newest evidence is a failure, and carries its reason', async () => {
    findFirst.mockResolvedValue({
      lastSuccessAt: new Date('2026-08-23T10:00:00Z'),
      lastFailureAt: new Date('2026-08-24T10:00:00Z'),
      lastFailureReason: 'Gemini rate limit reached (429)'
    } as never);
    const health = await connector.getHealth(config());
    expect(health.state).toBe(HealthState.DEGRADED);
    expect(health.reason).toMatch(/429/);
  });

  it('is UNKNOWN when the evidence itself could not be read', async () => {
    // A DB hiccup must not be reported as Gemini being unhealthy — reading the
    // evidence is not the subject of the check.
    findFirst.mockRejectedValue(new Error('db down') as never);
    expect((await connector.getHealth(config())).state).toBe(HealthState.UNKNOWN);
  });
});
