import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { HealthState } from '@prisma/client';

vi.mock('axios');
vi.mock('../../db.js', () => ({
  prisma: { platformCapability: { findMany: vi.fn() } }
}));
vi.mock('../../services/claudeOAuth.js', () => ({
  getClaudeCredential: vi.fn()
}));
vi.mock('../../services/claudeTriggers.js', async () => {
  const actual = await vi.importActual<typeof import('../../services/claudeTriggers.js')>(
    '../../services/claudeTriggers.js'
  );
  return {
    // The pure helpers are the real ones — mocking `parseTimestamp` or
    // `environmentIdFrom` would test the mock instead of the mapping.
    ...actual,
    listTriggers: vi.fn(),
    createTrigger: vi.fn(),
    updateTrigger: vi.fn(),
    runTrigger: vi.fn()
  };
});

import { ClaudeConnector } from '../ClaudeConnector.js';
import { prisma } from '../../db.js';
import { getClaudeCredential } from '../../services/claudeOAuth.js';
import {
  listTriggers,
  createTrigger,
  updateTrigger,
  runTrigger,
  type ClaudeTrigger
} from '../../services/claudeTriggers.js';

/**
 * **The connector has two modes, and so does this file.**
 *
 * Claude Code routines have two APIs: the documented per-routine `/fire`
 * endpoint (**declared mode**) and the undocumented account-authenticated
 * `/v1/code/triggers` family Claude Code itself uses (**OAuth mode**).
 *
 * Which one is live depends on whether a Claude Code session can be read off the
 * machine — which means, if nothing forced the question, **these tests would
 * pass or fail depending on whether the developer running them happens to be
 * logged into Claude Code.** That is not a suite, it is a coin flip with an
 * opinion. So `getClaudeCredential` is mocked in every case and each block says
 * plainly which door it is testing.
 */

const findMany = prisma.platformCapability.findMany as unknown as ReturnType<typeof vi.fn>;
const credential = getClaudeCredential as unknown as ReturnType<typeof vi.fn>;
const list = listTriggers as unknown as ReturnType<typeof vi.fn>;
const create = createTrigger as unknown as ReturnType<typeof vi.fn>;
const update = updateTrigger as unknown as ReturnType<typeof vi.fn>;
const run = runTrigger as unknown as ReturnType<typeof vi.fn>;

const CONFIG = { userId: 'u1', routines: [{ id: 'trig_1', token: 'sk-ant-oat01-x', name: 'Nightly review' }] };

/** No Claude Code session on this machine — door 1 only. */
const noCredential = () =>
  credential.mockReturnValue({
    credential: null,
    problem: 'no-file',
    reason: 'No Claude Code credentials at C:\\Users\\x\\.claude\\.credentials.json.'
  });

/** A Claude Code session is readable — door 2 is open. */
const withCredential = () =>
  credential.mockReturnValue({ credential: { token: 'sk-ant-oat01-account', source: 'file' } });

const TRIGGER: ClaudeTrigger = {
  id: 'trig_live',
  name: 'Refresh sidebar links',
  cron_expression: '30 4 * * 1',
  enabled: true,
  next_run_at: '2026-08-17T04:32:32.740155363Z',
  last_fired_at: '2026-08-10T04:32:00Z',
  api_token_hint: 'sk-ant-oat01-Sc4PGZBc...CQAA',
  job_config: {
    ccr: {
      environment_id: 'env_01Tw',
      session_context: { sources: [{ git_repository: { url: 'https://github.com/o/r' } }] },
      events: [{ data: { message: { content: 'Audit the sidebar.', role: 'user' } } }]
    }
  }
};

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([]);
  noCredential();
});

// ───────────────────────── declared mode (door 1) ─────────────────────────

describe('declared mode — syncTasks is a registry, not a read', () => {
  const connector = new ClaudeConnector();

  it('lists the routines the user declared', async () => {
    const tasks = await connector.syncTasks(CONFIG);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].externalId).toBe('trig_1');
    expect(tasks[0].name).toBe('Nightly review');
  });

  it('never carries the token into task metadata', async () => {
    // Was `{ ...r, token: undefined }`, which leaves the key present and relies
    // on JSON.stringify dropping it. The key must not be there at all.
    const [task] = await connector.syncTasks(CONFIG);
    expect(task.metadata).not.toHaveProperty('token');
    expect(Object.keys(task.metadata)).not.toContain('token');
    expect(JSON.stringify(task.metadata)).not.toContain('sk-ant-oat01-x');
  });

  it('marks rows as declared and invents no schedule', async () => {
    // Without a read API a routine's cadence is unknowable. Guessing one would
    // print a confident next-run time for a task Cronsole never schedules.
    const [task] = await connector.syncTasks(CONFIG);
    expect(task.metadata.declared).toBe(true);
    expect(task.schedule).toBeNull();
    expect(task.nextRunTime).toBeNull();
  });

  it('skips entries with no id rather than creating a task that cannot be fired', async () => {
    const tasks = await connector.syncTasks({ routines: [{ name: 'no id here' }, { id: 'trig_2' }] });
    expect(tasks.map(t => t.externalId)).toEqual(['trig_2']);
  });

  it('returns nothing for an absent or malformed routines list', async () => {
    for (const config of [{}, null, undefined, { routines: 'nope' }, { routines: null }]) {
      expect(await connector.syncTasks(config)).toEqual([]);
    }
  });

  it('never reaches for the triggers API without a credential', async () => {
    await connector.syncTasks(CONFIG);
    expect(list).not.toHaveBeenCalled();
  });
});

describe('declared mode — runTask fires with the per-routine token', () => {
  const connector = new ClaudeConnector();

  it('fires with the beta header and no body', async () => {
    (axios.post as any).mockResolvedValue({
      data: { claude_code_session_id: 'session_1', claude_code_session_url: 'https://claude.ai/code/session_1' }
    });

    const result = await connector.runTask('trig_1', CONFIG);

    expect(result.success).toBe(true);
    expect(result.platformRunId).toBe('session_1');
    expect(result.message).toContain('https://claude.ai/code/session_1');

    const [url, body, options] = (axios.post as any).mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/claude_code/routines/trig_1/fire');
    // The body is optional, and sending filler text is worse than sending none:
    // it arrives as the routine's `<routine-fire-payload>`, so for a routine
    // whose prompt reads that block it *displaces* the real context.
    expect(body).toBeUndefined();
    // Absent → 400, so this is not decoration.
    expect(options.headers['anthropic-beta']).toBe('experimental-cc-routine-2026-04-01');
    expect(options.headers['anthropic-version']).toBe('2023-06-01');
    expect(options.headers.Authorization).toBe('Bearer sk-ant-oat01-x');
  });

  it('refuses a routine that is not in the config, without calling out', async () => {
    const result = await connector.runTask('trig_missing', CONFIG);
    expect(result.success).toBe(false);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('names both recovery paths when there is no token', async () => {
    // The advice changed when door 2 landed: signing into the CLI is now a
    // genuine alternative to minting a per-routine token, and it is the cheaper
    // one — claude.ai shows a routine token exactly once.
    const result = await connector.runTask('trig_1', { routines: [{ id: 'trig_1' }] });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/token/i);
    expect(result.message).toMatch(/login/i);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('does not talk over a specific 400 from Anthropic', async () => {
    // Found on a live run: the API answered "invalid routine ID: Refresh
    // sidebar links" (someone had pasted the routine's NAME as its id) and the
    // handler appended "most often the routine is paused", which buries the real
    // cause and sends the user to unpause a routine that is fine.
    (axios.post as any).mockRejectedValue({
      response: {
        status: 400,
        headers: {},
        data: { error: { message: 'invalid routine ID: Refresh sidebar links' } }
      }
    });
    const result = await connector.runTask('trig_1', CONFIG);
    expect(result.message).toContain('invalid routine ID: Refresh sidebar links');
    expect(result.message).not.toMatch(/paused/i);
  });

  it('still offers the paused hint when the 400 says nothing useful', async () => {
    // The heuristic is for filling a silence, not for talking over one.
    (axios.post as any).mockRejectedValue({
      response: { status: 400, headers: {}, data: { error: { message: 'invalid request' } } }
    });
    expect((await connector.runTask('trig_1', CONFIG)).message).toMatch(/paused/i);

    (axios.post as any).mockRejectedValue({ response: { status: 400, headers: {}, data: {} } });
    expect((await connector.runTask('trig_1', CONFIG)).message).toMatch(/paused/i);
  });

  const CASES: Array<[number, RegExp, Record<string, string>?]> = [
    [400, /paused/i],
    [401, /token/i],
    [403, /plan|access/i],
    [404, /not found|deleted/i],
    [429, /limit/i, { 'retry-after': '90' }],
    [500, /server error/i],
    [503, /overloaded/i]
  ];

  for (const [status, expected, headers] of CASES) {
    it(`explains a ${status} in the user's terms`, async () => {
      (axios.post as any).mockRejectedValue({ response: { status, headers: headers ?? {}, data: {} } });
      const result = await connector.runTask('trig_1', CONFIG);
      expect(result.success).toBe(false);
      expect(result.message).toMatch(expected);
    });
  }

  it('carries Retry-After through on a 429', async () => {
    (axios.post as any).mockRejectedValue({
      response: { status: 429, headers: { 'retry-after': '90' }, data: {} }
    });
    expect((await connector.runTask('trig_1', CONFIG)).message).toContain('90');
  });

  it('falls back to the transport error when there is no response', async () => {
    (axios.post as any).mockRejectedValue(new Error('Network error'));
    const result = await connector.runTask('trig_1', CONFIG);
    expect(result.success).toBe(false);
    expect(result.message).toBe('Network error');
  });
});

describe('declared mode — the verbs that cannot exist', () => {
  const connector = new ClaudeConnector();

  it('declares create, setStatus and updateSchedule impossible rather than unimplemented', () => {
    // `unsupported` is a boundary; `declared` is a promise. Reporting these as
    // declared invites the user to wait for evidence that cannot arrive.
    expect([...connector.unsupportedVerbs]).toEqual(['create', 'setStatus', 'updateSchedule']);
  });

  it('refuses setTaskStatus and points at where pausing actually happens', async () => {
    const result = await connector.setTaskStatus('trig_1', false, CONFIG);
    expect(result.success).toBe(false);
    expect(result.message).toContain('claude.ai/code/routines');
    expect(update).not.toHaveBeenCalled();
  });

  it('refuses createTask and points at where routines are made', async () => {
    const result = await connector.createTask('n', '0 * * * *', 'a prompt', CONFIG);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/claude\.ai\/code\/routines|\/schedule/);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses a reschedule as a client error, not a platform failure', async () => {
    // A 502 would tell the user to retry something that will refuse identically
    // every time; the missing piece is a credential, and only they can supply it.
    const result = await connector.updateSchedule!('trig_1', '0 4 * * *', CONFIG);
    expect(result.success).toBe(false);
    expect(result.clientError).toBe(true);
    expect(update).not.toHaveBeenCalled();
  });

  it('implements none of the verbs whose platform support does not exist', () => {
    // No export format, no import, no folders — and above all **no delete**:
    // neither API exposes one, verified by enumerating the surface. A routine is
    // not a file, and claude.ai owns its lifecycle.
    const c = connector as unknown as Record<string, unknown>;
    for (const method of ['deleteTask', 'exportTask', 'importTask', 'listFolders', 'updateActions']) {
      expect(c[method]).toBeUndefined();
    }
  });
});

// ─────────────────────────── OAuth mode (door 2) ───────────────────────────

describe('OAuth mode — syncTasks is a real read', () => {
  const connector = new ClaudeConnector();

  beforeEach(() => {
    withCredential();
    list.mockResolvedValue({ ok: true, data: [TRIGGER] });
  });

  it('opens every verb, because none of them is a boundary any more', () => {
    expect([...connector.unsupportedVerbs]).toEqual([]);
  });

  it('reports the platform\'s own name, cron, status and next run', async () => {
    const [task] = await connector.syncTasks(CONFIG);
    expect(task.externalId).toBe('trig_live');
    expect(task.name).toBe('Refresh sidebar links');
    expect(task.status).toBe('ACTIVE');
    // Claude's cron is already 5-field UTC — Cronsole's storage contract — so
    // nothing converts it anywhere in this path.
    expect(task.schedule).toBe('30 4 * * 1');
    expect(task.metadata.declared).toBe(false);
  });

  it('takes next-run from the platform rather than recomputing it', async () => {
    // Anthropic applies up to ~3 minutes of scheduling jitter (04:32 for a
    // `30 4` cron). A locally derived time would disagree with claude.ai
    // forever, with nothing on screen to say which was right.
    const [task] = await connector.syncTasks(CONFIG);
    expect(task.nextRunTime).toEqual(new Date('2026-08-17T04:32:32.740155363Z'));
  });

  it('treats a routine with no cron as unscheduled, not as a broken one', async () => {
    // An API- or webhook-triggered routine reports `cron_expression: ""`.
    list.mockResolvedValue({ ok: true, data: [{ ...TRIGGER, cron_expression: '' }] });
    const [task] = await connector.syncTasks(CONFIG);
    expect(task.schedule).toBeNull();
  });

  it('reads a disabled routine as DISABLED', async () => {
    list.mockResolvedValue({ ok: true, data: [{ ...TRIGGER, enabled: false }] });
    expect((await connector.syncTasks(CONFIG))[0].status).toBe('DISABLED');
  });

  it('falls back to the declaration rather than reporting an empty account', async () => {
    // An empty sync would untrack every Claude task the user has, over what may
    // be a transient 500. **Absence of an answer is not an answer.**
    list.mockResolvedValue({ ok: false, status: 500, message: 'Anthropic server error (500).' });
    const tasks = await connector.syncTasks(CONFIG);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].externalId).toBe('trig_1');
  });
});

describe('OAuth mode — the verbs door 1 could never do', () => {
  const connector = new ClaudeConnector();

  beforeEach(() => {
    withCredential();
    list.mockResolvedValue({ ok: true, data: [TRIGGER] });
    update.mockResolvedValue({ ok: true, data: TRIGGER });
    create.mockResolvedValue({ ok: true, data: { ...TRIGGER, id: 'trig_new' } });
    run.mockResolvedValue({ ok: true, data: { sessionId: 'cse_1' } });
  });

  it('pauses a routine by sending enabled alone', async () => {
    // The update endpoint is a verified **partial** merge. Sending anything more
    // than `enabled` risks overwriting the routine's prompt on a Disable click.
    const result = await connector.setTaskStatus('trig_live', false, CONFIG);
    expect(result.success).toBe(true);
    expect(update).toHaveBeenCalledWith('sk-ant-oat01-account', 'trig_live', { enabled: false });
  });

  it('reschedules with the cron itself, ignoring any Windows trigger', async () => {
    const result = await connector.updateSchedule!('trig_live', '15 6 * * 3', CONFIG, {
      trigger: { type: 'Daily', startBoundary: '06:15', daysInterval: 1 } as any
    });
    expect(result.success).toBe(true);
    expect(update).toHaveBeenCalledWith('sk-ant-oat01-account', 'trig_live', { cronExpression: '15 6 * * 3' });
  });

  it('creates a routine, taking the environment from one that already exists', async () => {
    const result = await connector.createTask('Nightly digest', '0 9 * * *', 'Summarise the repo.', CONFIG, {
      repositoryUrls: ['https://github.com/o/r']
    });
    expect(result.success).toBe(true);
    expect(result.externalId).toBe('trig_new');
    expect(create).toHaveBeenCalledWith(
      'sk-ant-oat01-account',
      expect.objectContaining({
        name: 'Nightly digest',
        cronExpression: '0 9 * * *',
        prompt: 'Summarise the repo.',
        environmentId: 'env_01Tw',
        repositoryUrls: ['https://github.com/o/r']
      })
    );
  });

  it('refuses to invent an environment id when the account has no routines', async () => {
    // Guessing one would produce a routine that fails at its first run, long
    // after the click that created it.
    list.mockResolvedValue({ ok: true, data: [] });
    const result = await connector.createTask('n', '0 9 * * *', 'p', CONFIG);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/environment/i);
    expect(create).not.toHaveBeenCalled();
  });

  it('fires without any per-routine token', async () => {
    // The practical payoff of door 2: a routine with no API trigger of its own
    // is still runnable from Cronsole.
    const result = await connector.runTask('trig_live', { userId: 'u1', routines: [] });
    expect(result.success).toBe(true);
    expect(result.platformRunId).toBe('cse_1');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('lets a routine-specific failure stand instead of retrying door 1', async () => {
    // A 404 is the platform's answer about this routine. Falling back would fire
    // it a second time through the other door and report the wrong cause.
    run.mockResolvedValue({ ok: false, status: 404, message: 'That routine no longer exists (404).' });
    const result = await connector.runTask('trig_1', CONFIG);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/404/);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('falls back to the per-routine token only when the API surface moved', async () => {
    // The undocumented endpoint being withdrawn is exactly the scenario door 1
    // is kept alive for.
    run.mockResolvedValue({ ok: false, status: 404, surfaceMoved: true, message: 'API changed' });
    (axios.post as any).mockResolvedValue({ data: { claude_code_session_id: 'session_1' } });

    const result = await connector.runTask('trig_1', CONFIG);
    expect(result.success).toBe(true);
    expect(axios.post).toHaveBeenCalled();
  });
});

describe('getHealth — evidence, never a precondition, never a probe', () => {
  const connector = new ClaudeConnector();

  it('does NOT report healthy just because a routine is configured', async () => {
    // The bug this replaces (troubleshooting #40's shape): the old connector
    // returned HEALTHY whenever config was non-empty — a verdict derived from
    // something that cannot change when the platform fails.
    const health = await connector.getHealth(CONFIG);
    expect(health.state).not.toBe(HealthState.HEALTHY);
    // Specifically UNKNOWN, not DEGRADED. A routine that has never fired has not
    // failed — there is simply no evidence either way.
    expect(health.state).toBe(HealthState.UNKNOWN);
    expect(health.reason).toMatch(/none fired yet|Claude Code session/i);
  });

  it('never probes, in either mode', async () => {
    // Door 1's only endpoint FIRES the routine, so probing would burn the user's
    // daily run cap. Door 2's list is a clean read but getHealth runs on a 45s
    // poll per open tab — so sync stays the user's probe.
    withCredential();
    await connector.getHealth(CONFIG);
    expect(axios.post).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('is healthy once something has actually succeeded', async () => {
    const at = new Date('2026-08-12T10:00:00Z');
    findMany.mockResolvedValue([{ verb: 'run', lastSuccessAt: at, lastFailureAt: null, lastFailureReason: null }]);
    const health = await connector.getHealth(CONFIG);
    expect(health.state).toBe(HealthState.HEALTHY);
    expect(health.lastContactAt).toEqual(at);
  });

  it('reports the newest outcome, not merely any failure on record', async () => {
    const older = new Date('2026-08-11T10:00:00Z');
    const newer = new Date('2026-08-12T10:00:00Z');

    findMany.mockResolvedValue([
      { verb: 'run', lastSuccessAt: newer, lastFailureAt: older, lastFailureReason: 'old news' }
    ]);
    expect((await connector.getHealth(CONFIG)).state).toBe(HealthState.HEALTHY);

    findMany.mockResolvedValue([
      { verb: 'run', lastSuccessAt: older, lastFailureAt: newer, lastFailureReason: 'Token rejected' }
    ]);
    const degraded = await connector.getHealth(CONFIG);
    expect(degraded.state).toBe(HealthState.DEGRADED);
    expect(degraded.reason).toContain('Token rejected');
    // A rejection is still contact — Anthropic answered us.
    expect(degraded.lastContactAt).toEqual(newer);
  });

  it('weighs sync as evidence only in OAuth mode', async () => {
    // In declared mode `syncTasks` never leaves the process, so its success says
    // nothing whatsoever about Anthropic. Counting it would manufacture a green
    // verdict out of reading our own database.
    const at = new Date('2026-08-12T10:00:00Z');
    findMany.mockResolvedValue([{ verb: 'sync', lastSuccessAt: at, lastFailureAt: null, lastFailureReason: null }]);

    await connector.getHealth(CONFIG);
    expect(findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ verb: { in: ['run'] } }) })
    );

    withCredential();
    await connector.getHealth(CONFIG);
    expect(findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ verb: { in: ['sync', 'run'] } }) })
    );
  });

  it('reports no verdict, not a bad one, with nothing configured', async () => {
    // Was DEGRADED until 2026-08-13, for want of a state meaning "nothing to
    // report". Nothing is wrong with an unconfigured platform, and an amber row
    // the user cannot act on trains them to ignore the amber rows that matter.
    const health = await connector.getHealth({ userId: 'u1' });
    expect(health.state).toBe(HealthState.UNKNOWN);
    expect(health.reason).toMatch(/no routines|credentials/i);
  });

  it('does not blame the platform when the evidence store is unreadable', async () => {
    // This test's NAME was already right and its assertion was not: returning
    // DEGRADED because our own database hiccuped is precisely blaming the
    // platform for it. UNKNOWN is what "we could not find out" looks like.
    findMany.mockRejectedValue(new Error('db down'));
    const health = await connector.getHealth(CONFIG);
    expect(health.state).toBe(HealthState.UNKNOWN);
    expect(health.reason).toMatch(/run history/i);
  });
});
