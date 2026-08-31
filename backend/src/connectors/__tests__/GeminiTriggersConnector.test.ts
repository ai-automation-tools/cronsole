import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HealthState, PlatformType } from '@prisma/client';

vi.mock('../../db.js', () => ({
  prisma: { platformCapability: { findFirst: vi.fn() } }
}));
// The six network calls are stubbed; everything else stays **real**. The status
// vocabulary (`isPendingStatus` / `isSuccessStatus`) is a pure predicate about
// what the platform's words mean, and stubbing it would let this suite agree
// with a wrong answer — which is exactly how `succeeded` survived here while the
// API was saying `completed`.
vi.mock('../../services/geminiApi.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/geminiApi.js')>()),
  listTriggers: vi.fn(),
  listExecutions: vi.fn(),
  runTrigger: vi.fn(),
  patchTrigger: vi.fn(),
  createTrigger: vi.fn(),
  deleteTrigger: vi.fn(),
  getTrigger: vi.fn(),
  getInteraction: vi.fn()
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
  deleteTrigger,
  getTrigger,
  getInteraction
} from '../../services/geminiApi.js';
import { TaskService } from '../../services/TaskService.js';

const listTriggersMock = vi.mocked(listTriggers);
const listExecutionsMock = vi.mocked(listExecutions);
const getInteractionMock = vi.mocked(getInteraction);
const runTriggerMock = vi.mocked(runTrigger);
const patchTriggerMock = vi.mocked(patchTrigger);
const createTriggerMock = vi.mocked(createTrigger);
const deleteTriggerMock = vi.mocked(deleteTrigger);
const getTriggerMock = vi.mocked(getTrigger);
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
  // A trigger Cronsole created: no tools, no allowlist. Both are always present
  // on a `GeminiTrigger` — `toTrigger` and `emptyTrigger` each supply them — so
  // the fixture supplies them too rather than the connector defending against an
  // absence the type rules out.
  tools: [] as { type: string; name: string | null; url: string | null; restricted: boolean }[],
  networkAllowlist: [] as string[],
  ...over
});

const execution = (over: Record<string, unknown> = {}) => ({
  id: 'exe_1',
  error: null,
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
    // endpoint here. `updateSchedule` is impossible on this API and is stated by
    // absence instead, because it is an *optional* verb — the rule GitHub's
    // connector follows in reverse, naming only the mandated verbs it refuses.
    expect(connector.unsupportedVerbs).toEqual([]);
  });

  it('implements the optional verbs it can honestly do, and only those', () => {
    expect(typeof connector.deleteTask).toBe('function');

    // Read through the interface, which is what `verbReachability` reads — a
    // `typeof connector.exportTask` on the concrete class does not typecheck
    // precisely *because* the method is absent, and an absent method is the
    // whole point: it is what makes the matrix report the verb `unsupported`,
    // so each boundary is stated exactly once. `updateActions` is the one that
    // means "not yet" rather than "cannot": editing a trigger's prompt needs a
    // form Cronsole does not have, and the cell is free to change when it does.
    //
    // `updateSchedule` is the opposite — a hard boundary. `PATCH
    // /v1beta/triggers/{id}` exists and takes `status` and `display_name`, but
    // answers `400 Unknown parameter 'schedule'` to the only field a reschedule
    // is made of, with no `PUT` and no field mask that changes it. Implementing
    // it anyway put a `declared` cell on the matrix that could only ever fail.
    const asInterface: PlatformConnector = connector;
    for (const verb of ['updateSchedule', 'updateActions', 'exportTask', 'importTask', 'listFolders'] as const) {
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
      input: 'Summarise yesterday',
      // Empty when the caller granted nothing, which is still the default. The
      // API layer drops both from the request body rather than sending `[]` —
      // an empty `tools` array could plausibly mean "no tools at all" rather
      // than "use the defaults", and a create must not silently change what a
      // trigger can do.
      tools: [],
      allowlist: []
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

describe('platform run history is read live, and output is fetched per run', () => {
  const config = () => ({ apiKey: 'AIzaKEY', userId: 'u1' });

  it('marks a finished run with an interaction as openable', async () => {
    listExecutionsMock.mockResolvedValue({
      ok: true,
      data: [
        { id: 'r1', status: 'completed', startTime: new Date(), endTime: new Date(), interactionId: 'v1_abc' }
      ]
    } as never);
    const result = await connector.listPlatformRuns('trg_1', config());
    expect(result.runs?.[0]).toMatchObject({ id: 'r1', status: 'completed', outputAvailable: true });
  });

  it('offers nothing to open on a run still in progress', async () => {
    // An execution in flight has no transcript worth reading, and offering the
    // click spends a request to render nothing.
    listExecutionsMock.mockResolvedValue({
      ok: true,
      data: [{ id: 'r1', status: 'in_progress', startTime: new Date(), endTime: null, interactionId: null }]
    } as never);
    const result = await connector.listPlatformRuns('trg_1', config());
    expect(result.runs?.[0]?.outputAvailable).toBe(false);
  });

  it('resolves a run id to its interaction before fetching the output', async () => {
    // There is no GET /triggers/{id}/executions/{runId} — it 404s — so the list
    // is the only place an interaction id is published.
    listExecutionsMock.mockResolvedValue({
      ok: true,
      data: [{ id: 'r1', status: 'completed', startTime: null, endTime: null, interactionId: 'v1_abc' }]
    } as never);
    getInteractionMock.mockResolvedValue({
      ok: true,
      data: { text: 'the digest', steps: ['write_file'], totalTokens: 42 }
    } as never);

    const result = await connector.getRunOutput('trg_1', 'r1', config());
    expect(getInteractionMock).toHaveBeenCalledWith('AIzaKEY', 'v1_abc');
    expect(result).toMatchObject({ success: true, output: { text: 'the digest' } });
  });

  it('explains a run that aged out of the platform list', async () => {
    listExecutionsMock.mockResolvedValue({ ok: true, data: [] } as never);
    const result = await connector.getRunOutput('trg_1', 'gone', config());
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/no longer lists that run/i);
    expect(getInteractionMock).not.toHaveBeenCalled();
  });

  it('says a run is still going rather than reporting no output', async () => {
    // "Not finished yet" and "produced nothing" are different facts, and only
    // one of them is worth coming back for.
    listExecutionsMock.mockResolvedValue({
      ok: true,
      data: [{ id: 'r1', status: 'in_progress', startTime: null, endTime: null, interactionId: null }]
    } as never);
    const result = await connector.getRunOutput('trg_1', 'r1', config());
    expect(result.message).toMatch(/still going/i);
  });

  it('refuses without a key rather than calling the platform', async () => {
    expect(await connector.listPlatformRuns('trg_1', {})).toMatchObject({ success: false });
    expect(listExecutionsMock).not.toHaveBeenCalled();
  });
});

describe('a dispatch timeout is answered with evidence, not with a verdict', () => {
  const config = () => ({ apiKey: 'AIzaKEY', userId: 'u1' });

  it('reports a run that started despite the timeout as accepted', async () => {
    // `POST /executions` holds the connection while the agent works, so a manual
    // run of a perfectly healthy task timed out at 20s and was written to
    // ExecutionLog as a FAILURE — while the platform's own history, in the same
    // modal, said `completed`.
    runTriggerMock.mockResolvedValue({ ok: false, status: null, message: 'timeout of 20000ms exceeded' } as never);
    listExecutionsMock.mockResolvedValue({
      ok: true,
      data: [{ id: 'exec_new', status: 'in_progress', startTime: new Date(), endTime: null, interactionId: null }]
    } as never);

    const result = await connector.runTask('trg_1', config());
    expect(result).toMatchObject({ success: true, ran: false, platformRunId: 'exec_new' });
    expect(result.message).toMatch(/run started on the platform/i);
  });

  it('still fails when nothing started', async () => {
    // The evidence has to be able to say no, or this is just a way of never
    // reporting a failed run.
    runTriggerMock.mockResolvedValue({ ok: false, status: null, message: 'timeout of 20000ms exceeded' } as never);
    listExecutionsMock.mockResolvedValue({ ok: true, data: [] } as never);

    expect(await connector.runTask('trg_1', config())).toMatchObject({ success: false, ran: false });
  });

  it('ignores a run that predates the request', async () => {
    // Yesterday's execution is not evidence that today's dispatch landed.
    runTriggerMock.mockResolvedValue({ ok: false, status: null, message: 'timeout of 20000ms exceeded' } as never);
    listExecutionsMock.mockResolvedValue({
      ok: true,
      data: [{ id: 'old', status: 'completed', startTime: new Date(Date.now() - 86400000), endTime: null, interactionId: 'i' }]
    } as never);

    expect(await connector.runTask('trg_1', config())).toMatchObject({ success: false });
  });

  it('does not go looking when the platform gave a real refusal', async () => {
    // A 403 is an answer. Only a timeout leaves the outcome genuinely unknown,
    // and only that case is worth a second request.
    runTriggerMock.mockResolvedValue({ ok: false, status: 403, message: 'Gemini refused access (403)' } as never);
    const result = await connector.runTask('trg_1', config());
    expect(result.success).toBe(false);
    expect(listExecutionsMock).not.toHaveBeenCalled();
  });
});

describe('creating a trigger with tools grants reach deliberately', () => {
  const config = () => ({ apiKey: 'AIzaKEY', userId: 'u1' });

  beforeEach(() => vi.clearAllMocks());

  it('passes tools and the allowlist through', async () => {
    createTriggerMock.mockResolvedValue({ ok: true, data: trigger({ id: 'trg_new' }) } as never);
    await connector.createTask('nightly', '0 3 * * *', 'Do it', config(), {
      agentTools: [{ type: 'bash' }, { type: 'mcp_server', name: 'weather', url: 'https://e.com/mcp' }],
      agentAllowlist: ['e.com']
    });

    expect(createTriggerMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      tools: [{ type: 'bash' }, { type: 'mcp_server', name: 'weather', url: 'https://e.com/mcp' }],
      allowlist: ['e.com']
    }));
  });

  it('refuses an unknown tool type with the list, instead of dropping it', async () => {
    // Dropping it would create a trigger with LESS reach than the form showed.
    // A security-relevant field that silently does nothing is worse than an error.
    const result = await connector.createTask('x', '0 3 * * *', 'Do it', config(), {
      agentTools: [{ type: 'bash' }, { type: 'quantum_thing' }]
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('quantum_thing');
    expect(result.message).toContain('mcp_server');
    expect(createTriggerMock).not.toHaveBeenCalled();
  });

  it('refuses an MCP server with no URL', async () => {
    const result = await connector.createTask('x', '0 3 * * *', 'Do it', config(), {
      agentTools: [{ type: 'mcp_server', name: 'weather' }]
    });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/needs a URL/i);
    expect(createTriggerMock).not.toHaveBeenCalled();
  });

  it('says what was granted, not only what was withheld', async () => {
    createTriggerMock.mockResolvedValue({ ok: true, data: trigger({ id: 'trg_new' }) } as never);
    const result = await connector.createTask('x', '0 3 * * *', 'Do it', config(), {
      agentTools: [{ type: 'bash' }],
      agentAllowlist: ['api.example.com']
    });
    expect(result.message).toContain('bash');
    expect(result.message).toContain('api.example.com');
  });

  it('says where a supplied credential now lives, because Cronsole no longer has it', async () => {
    // The last thing anyone reads before an autonomous agent starts running on a
    // schedule. A message implying the token stayed local would be false.
    createTriggerMock.mockResolvedValue({ ok: true, data: trigger({ id: 'trg_new' }) } as never);
    const result = await connector.createTask('x', '0 3 * * *', 'Do it', config(), {
      agentTools: [{ type: 'mcp_server', name: 'w', url: 'https://e.com/mcp', headers: { Authorization: 'Bearer x' } }]
    });
    expect(result.message).toMatch(/Cronsole keeps no copy/i);
  });

  it('still describes the plain default when nothing was granted', async () => {
    createTriggerMock.mockResolvedValue({ ok: true, data: trigger({ id: 'trg_new' }) } as never);
    const result = await connector.createTask('x', '0 3 * * *', 'Do it', config());
    expect(result.message).toMatch(/reach nothing outside its sandbox/i);
  });
});

describe('a run that failed before the agent started still says why', () => {
  const config = () => ({ apiKey: 'AIzaKEY', userId: 'u1' });
  beforeEach(() => vi.clearAllMocks());

  const failedEarly = {
    id: 'r1',
    status: 'failed',
    startTime: new Date(),
    endTime: new Date(),
    interactionId: null,
    error: "Tool 'filesystem' is not allowed when interacting with this agent"
  };

  it('reports the platform reason as the output', async () => {
    // The most valuable field on the execution and it was dropped for a day: a
    // run rejected before any agent started has no transcript, so Cronsole said
    // "there is nothing to read" while the exact cause sat one key over in the
    // same response.
    listExecutionsMock.mockResolvedValue({ ok: true, data: [failedEarly] } as never);

    const result = await connector.getRunOutput('trg_1', 'r1', config());
    expect(result.success).toBe(true);
    expect(result.output!.text).toContain("Tool 'filesystem' is not allowed");
    // Said plainly, so nobody hunts for a transcript that cannot exist.
    expect(result.output!.facts[0]!.label).toMatch(/before the agent started/i);
  });

  it('marks such a run openable, though no agent ever ran', async () => {
    listExecutionsMock.mockResolvedValue({ ok: true, data: [failedEarly] } as never);
    const result = await connector.listPlatformRuns('trg_1', config());
    expect(result.runs![0]!.outputAvailable).toBe(true);
  });

  it('still shrugs honestly when the platform gave no reason either', async () => {
    listExecutionsMock.mockResolvedValue({
      ok: true,
      data: [{ ...failedEarly, error: null }]
    } as never);
    const result = await connector.getRunOutput('trg_1', 'r1', config());
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/gave no reason/i);
  });
});

/**
 * **Preset resolution — a reference in, a credential out, and nothing stored.**
 *
 * These are the tests for the change that made Cronsole start holding a token it
 * hands to another platform. The interesting assertions are about the *seam*:
 * what a caller may name, what reaches Google, and what happens when the name
 * matches nothing.
 */
describe('a saved MCP server is referenced by name, never retyped', () => {
  const withPresets = (over: Record<string, unknown> = {}) =>
    config({
      toolPresets: [
        { name: 'resend', url: 'https://mcp.resend.com/mcp', headers: { Authorization: 'Bearer re_live_x' } },
        { name: 'weather', url: 'https://weather.example/mcp' }
      ],
      ...over
    });

  beforeEach(() => vi.clearAllMocks());

  it('resolves a preset into the URL and credential the platform needs', async () => {
    createTriggerMock.mockResolvedValue({ ok: true, data: trigger({ id: 'trg_new' }) } as never);

    await connector.createTask('nightly', '0 3 * * *', 'Mail it', withPresets(), {
      agentTools: [{ type: 'mcp_server', preset: 'resend' }]
    });

    expect(createTriggerMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      tools: [{
        type: 'mcp_server',
        name: 'resend',
        url: 'https://mcp.resend.com/mcp',
        headers: { Authorization: 'Bearer re_live_x' }
      }]
    }));
  });

  it('does not send the reference itself — `preset` is Cronsole\'s word, not Google\'s', async () => {
    createTriggerMock.mockResolvedValue({ ok: true, data: trigger({ id: 'trg_new' }) } as never);

    await connector.createTask('nightly', '0 3 * * *', 'Mail it', withPresets(), {
      agentTools: [{ type: 'mcp_server', preset: 'resend' }]
    });

    const sent = createTriggerMock.mock.calls[0]![1] as unknown as { tools: Record<string, unknown>[] };
    expect(sent.tools[0]).not.toHaveProperty('preset');
  });

  it('matches the name case-insensitively', async () => {
    createTriggerMock.mockResolvedValue({ ok: true, data: trigger({ id: 'trg_new' }) } as never);

    const result = await connector.createTask('n', '0 3 * * *', 'p', withPresets(), {
      agentTools: [{ type: 'mcp_server', preset: 'ReSeNd' }]
    });
    expect(result.success).toBe(true);
  });

  it('refuses an unknown preset WITH the list, and creates nothing', async () => {
    // The same rule as an unknown tool type, and it matters more here: passing a
    // credential-less server through would produce a trigger that authenticates
    // with nothing and fails later, on a schedule, as somebody else's 401.
    const result = await connector.createTask('n', '0 3 * * *', 'p', withPresets(), {
      agentTools: [{ type: 'mcp_server', preset: 'sendgrid' }]
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('sendgrid');
    expect(result.message).toContain('resend');
    expect(createTriggerMock).not.toHaveBeenCalled();
  });

  it('says where to add one when the connection has no presets at all', async () => {
    const result = await connector.createTask('n', '0 3 * * *', 'p', config(), {
      agentTools: [{ type: 'mcp_server', preset: 'resend' }]
    });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/no saved servers/i);
  });

  it('carries a preset with no credential through as a plain server', async () => {
    createTriggerMock.mockResolvedValue({ ok: true, data: trigger({ id: 'trg_new' }) } as never);

    await connector.createTask('n', '0 3 * * *', 'p', withPresets(), {
      agentTools: [{ type: 'mcp_server', preset: 'weather' }]
    });

    const sent = createTriggerMock.mock.calls[0]![1] as unknown as { tools: Record<string, unknown>[] };
    expect(sent.tools[0]).toEqual({
      type: 'mcp_server',
      name: 'weather',
      url: 'https://weather.example/mcp'
    });
    // Absent, not `{}` — an empty header map is a thing to send, and this server
    // needs no credential at all.
    expect(sent.tools[0]).not.toHaveProperty('headers');
  });

  it('lets an explicit value win over the preset it would have filled in', async () => {
    // A preset FILLS IN url and headers; it does not override a caller who
    // supplied them. Otherwise there is no way to point one create at a staging
    // endpoint without editing the saved server every other trigger uses.
    createTriggerMock.mockResolvedValue({ ok: true, data: trigger({ id: 'trg_new' }) } as never);

    await connector.createTask('n', '0 3 * * *', 'p', withPresets(), {
      agentTools: [{ type: 'mcp_server', preset: 'resend', url: 'https://staging.resend/mcp' }]
    });

    expect(createTriggerMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      tools: [expect.objectContaining({ url: 'https://staging.resend/mcp' })]
    }));
  });

  it('still refuses a literal MCP server with no URL and no preset', async () => {
    // The URL check must judge what will actually be SENT, which is why presets
    // resolve before it rather than after.
    const result = await connector.createTask('n', '0 3 * * *', 'p', withPresets(), {
      agentTools: [{ type: 'mcp_server', name: 'half-typed' }]
    });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/needs a URL/i);
  });

  it('resolves presets on a rotation too, from the one definition', async () => {
    // A second copy of this resolution is how a rotation sends a tool list the
    // create path would have refused — and this one carries credentials.
    getTriggerMock.mockResolvedValue({
      ok: true,
      data: trigger({ id: 'trg_old', schedule: '0 3 * * *', agent: 'a', input: 'p', status: 'active' })
    } as never);
    createTriggerMock.mockResolvedValue({ ok: true, data: trigger({ id: 'trg_new' }) } as never);
    deleteTriggerMock.mockResolvedValue({ ok: true } as never);

    await connector.rotateCredentials!('trg_old', [{ type: 'mcp_server', preset: 'resend' }], [], withPresets());

    expect(createTriggerMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      tools: [expect.objectContaining({ headers: { Authorization: 'Bearer re_live_x' } })]
    }));
  });

  it('refuses a bad preset on a rotation BEFORE touching the platform', async () => {
    // The original trigger is the only one that exists at this point, and it has
    // to stay that way: create-first is what makes a failed rotation safe, and a
    // refusal that costs nothing is better still.
    const result = await connector.rotateCredentials!(
      'trg_old',
      [{ type: 'mcp_server', preset: 'nope' }],
      [],
      withPresets()
    );

    expect(result.success).toBe(false);
    expect(getTriggerMock).not.toHaveBeenCalled();
    expect(createTriggerMock).not.toHaveBeenCalled();
    expect(deleteTriggerMock).not.toHaveBeenCalled();
  });
});

/**
 * **A refusal reached without calling out is the caller's mistake, not the platform's.**
 *
 * `runTask` learned this once already: `ran` exists beside `success` because
 * "the job failed" and "the job could not start" need different answers.
 * `refusedBeforeCalling` is the same split on the create path, and it decides
 * whether the route says 400 (fix your request) or 500 (retry).
 */
describe('a create refused before the platform is contacted says so', () => {
  const withPresets = () =>
    config({ toolPresets: [{ name: 'resend', url: 'https://mcp.resend.com/mcp' }] });

  beforeEach(() => vi.clearAllMocks());

  it.each([
    ['an empty prompt', '   ', {}],
    ['an unknown tool type', 'p', { agentTools: [{ type: 'quantum_thing' }] }],
    ['an MCP server with no URL', 'p', { agentTools: [{ type: 'mcp_server', name: 'half' }] }],
    ['an unknown preset', 'p', { agentTools: [{ type: 'mcp_server', preset: 'sendgrid' }] }]
  ])('flags %s', async (_label, prompt, options) => {
    const result = await connector.createTask('n', '0 3 * * *', prompt, withPresets(), options);
    expect(result.success).toBe(false);
    expect(result.refusedBeforeCalling).toBe(true);
    // The point of the flag: nothing was sent, so retrying the identical request
    // cannot help and the message names what to change instead.
    expect(createTriggerMock).not.toHaveBeenCalled();
  });

  it('does NOT flag a failure the platform itself returned', async () => {
    // Here Cronsole did call out and Google declined. Retrying is exactly the
    // right move, so this must stay a 500 rather than becoming a 400.
    createTriggerMock.mockResolvedValue({ ok: false, message: 'Service unavailable' } as never);
    const result = await connector.createTask('n', '0 3 * * *', 'p', withPresets());
    expect(result.success).toBe(false);
    expect(result.refusedBeforeCalling).toBeUndefined();
    expect(createTriggerMock).toHaveBeenCalled();
  });
});

/**
 * **A recreate carries changes, and everything it is not changing comes from the
 * platform.**
 *
 * The verb was `rotateCredentials` and only ever swapped a tool list, which left
 * the ordinary case — iterating on a prompt — as a full retype in the Duplicate
 * form plus a manual delete. The machinery was already the whole answer; these
 * tests pin the two properties that make widening it safe: an omitted field is
 * read back off the platform rather than resent from Cronsole's row, and a
 * schedule inherited from a trigger in a real zone is **converted**, because
 * `createTrigger` always writes `time_zone: UTC`.
 */
describe('recreating a trigger with changes', () => {
  beforeEach(() => vi.clearAllMocks());

  const ready = (over: Record<string, unknown> = {}) => {
    getTriggerMock.mockResolvedValue({ ok: true, data: trigger(over) } as never);
    createTriggerMock.mockResolvedValue({ ok: true, data: trigger({ id: 'trg_new', ...over }) } as never);
    deleteTriggerMock.mockResolvedValue({ ok: true } as never);
  };

  const sent = () => createTriggerMock.mock.calls[0]![1] as unknown as Record<string, unknown>;

  it('sends a new prompt and keeps the platform’s schedule', async () => {
    ready();

    const result = await connector.rotateCredentials!('trg_abc', [], [], config(), {
      prompt: 'Review open PRs and mail me the summary'
    });

    expect(result.success).toBe(true);
    expect(sent()).toMatchObject({
      input: 'Review open PRs and mail me the summary',
      schedule: '0 9 * * *'
    });
  });

  it('sends a new schedule and keeps the platform’s prompt', async () => {
    ready();

    await connector.rotateCredentials!('trg_abc', [], [], config(), { schedule: '30 6 * * 1' });

    expect(sent()).toMatchObject({ schedule: '30 6 * * 1', input: 'Review open PRs' });
  });

  it('changes nothing when asked for nothing — the rotation case, unchanged', async () => {
    ready();

    await connector.rotateCredentials!('trg_abc', [], [], config());

    expect(sent()).toMatchObject({ schedule: '0 9 * * *', input: 'Review open PRs' });
  });

  it('converts an inherited schedule out of the platform’s own zone', async () => {
    // The latent half of this change. `createTrigger` writes `time_zone: UTC`
    // unconditionally, so echoing a New York expression back would move the
    // trigger by the offset with nothing on screen saying so — and a rotation is
    // the last moment anyone would look for a schedule change.
    ready({ schedule: '0 9 * * *', timeZone: 'America/New_York' });

    await connector.rotateCredentials!('trg_abc', [], [], config());

    expect(sent().schedule).not.toBe('0 9 * * *');
    // 09:00 New York is 13:00 or 14:00 UTC depending on the date the test runs;
    // the assertion is that it was shifted and stayed a legal 5-field cron, not
    // which side of a DST boundary today happens to fall on.
    expect(String(sent().schedule)).toMatch(/^0 1[34] \* \* \*$/);
  });

  it('refuses a zone it cannot resolve, with the reason and the way past it', async () => {
    ready({ schedule: '0 9 * * *', timeZone: 'Mars/Olympus_Mons' });

    const result = await connector.rotateCredentials!('trg_abc', [], [], config());

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/Set one explicitly/);
    expect(createTriggerMock).not.toHaveBeenCalled();
  });

  it('rebuilds a trigger whose prompt the platform never reported, when one is supplied', async () => {
    // The old guard refused on any missing field. A field the caller is
    // *replacing* does not need to have been readable — refusing there would
    // make an unreadable trigger permanently unfixable, which is the opposite of
    // what this verb is for.
    ready({ input: null });

    const result = await connector.rotateCredentials!('trg_abc', [], [], config(), { prompt: 'Do the thing' });

    expect(result.success).toBe(true);
    expect(sent()).toMatchObject({ input: 'Do the thing' });
  });

  it('still refuses when the prompt is missing and nothing replaces it', async () => {
    ready({ input: null });

    const result = await connector.rotateCredentials!('trg_abc', [], [], config());

    expect(result.success).toBe(false);
    expect(createTriggerMock).not.toHaveBeenCalled();
  });

  it('reports the replacement as the platform describes it, not as it was asked for', async () => {
    // What the caller writes to its row. Echoing the request would put
    // Cronsole's intention on the dashboard under the platform's name — the
    // shape of #82, where a prompt is written as a string and read back
    // differently.
    getTriggerMock.mockResolvedValue({ ok: true, data: trigger() } as never);
    createTriggerMock.mockResolvedValue({
      ok: true,
      data: trigger({
        id: 'trg_new',
        schedule: '30 6 * * 1',
        input: 'Normalized by Gemini',
        nextRunTime: new Date('2026-09-01T06:30:00Z')
      })
    } as never);
    deleteTriggerMock.mockResolvedValue({ ok: true } as never);

    const result = await connector.rotateCredentials!('trg_abc', [], [], config(), { schedule: '30 6 * * 1' });

    expect(result).toMatchObject({
      newExternalId: 'trg_new',
      newSchedule: '30 6 * * 1',
      newPrompt: 'Normalized by Gemini',
      newNextRunTime: new Date('2026-09-01T06:30:00Z')
    });
  });

  it('names what changed in the message, because "recreated" alone does not', async () => {
    ready();

    const result = await connector.rotateCredentials!('trg_abc', [], [], config(), {
      prompt: 'New prompt',
      schedule: '30 6 * * 1'
    });

    expect(result.message).toMatch(/a new prompt and a new schedule/);
  });
});
