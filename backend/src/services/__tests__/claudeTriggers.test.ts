import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

vi.mock('axios');

import {
  listTriggers,
  getTrigger,
  createTrigger,
  updateTrigger,
  runTrigger,
  environmentIdFrom,
  parseTimestamp,
  promptOf,
  repositoriesOf,
  type ClaudeTrigger
} from '../claudeTriggers.js';

const request = axios.request as unknown as ReturnType<typeof vi.fn>;
const TOKEN = 'sk-ant-oat01-account';

const rejectWith = (status: number, data: unknown = {}, headers: Record<string, string> = {}) =>
  request.mockRejectedValue({ response: { status, data, headers } });

beforeEach(() => vi.clearAllMocks());

describe('the wire format', () => {
  it('sends the beta gate and the bearer token on every call', async () => {
    // Absent → the API rejects. This is a gate, not decoration.
    request.mockResolvedValue({ data: { data: [] } });
    await listTriggers(TOKEN);
    const sent = request.mock.calls[0][0];
    expect(sent.headers['anthropic-beta']).toBe('ccr-triggers-2026-01-30');
    expect(sent.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(sent.url).toBe('https://api.anthropic.com/v1/code/triggers');
  });

  it('creates with MCP connectors explicitly cleared', async () => {
    // Without this the server attaches EVERY connector on the account — nine on
    // a real one, Gmail and Drive among them. A routine made from one sentence
    // must not silently arrive holding the user's mailbox.
    request.mockResolvedValue({ data: { trigger: { id: 'trig_new' } } });
    await createTrigger(TOKEN, {
      name: 'n',
      prompt: 'do the thing',
      environmentId: 'env_1',
      cronExpression: '0 9 * * *',
      repositoryUrls: ['https://github.com/o/r']
    });
    const body = request.mock.calls[0][0].data;
    expect(body.clear_mcp_connections).toBe(true);
    expect(body.cron_expression).toBe('0 9 * * *');
    expect(body.job_config.ccr.events[0].data.message.content).toBe('do the thing');
    expect(body.job_config.ccr.session_context.sources).toEqual([
      { git_repository: { url: 'https://github.com/o/r' } }
    ]);
  });

  it('omits cron entirely for an unscheduled routine, rather than sending an empty one', async () => {
    request.mockResolvedValue({ data: { trigger: { id: 'trig_new' } } });
    await createTrigger(TOKEN, { name: 'n', prompt: 'p', environmentId: 'env_1' });
    expect(request.mock.calls[0][0].data).not.toHaveProperty('cron_expression');
  });

  it('sends only the fields an update names', async () => {
    // The verified partial-merge semantics are what make setTaskStatus safe:
    // anything extra on the wire could overwrite the routine's prompt.
    request.mockResolvedValue({ data: { trigger: {} } });
    await updateTrigger(TOKEN, 'trig_1', { enabled: false });
    expect(request.mock.calls[0][0].data).toEqual({ enabled: false });
  });

  it('refuses an empty update instead of sending a meaningless request', async () => {
    const result = await updateTrigger(TOKEN, 'trig_1', {});
    expect(result.ok).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it('fires with no text payload', async () => {
    // The optional `text` reaches the routine as an untrusted payload block, so
    // filler there displaces the real context a routine that opts in expects.
    request.mockResolvedValue({ data: { session_id: 'cse_1' } });
    const result = await runTrigger(TOKEN, 'trig_1');
    expect(result).toEqual({ ok: true, data: { sessionId: 'cse_1' } });
    expect(request.mock.calls[0][0].data).toEqual({});
  });

  it('unwraps a single trigger whether or not it is envelope-wrapped', async () => {
    request.mockResolvedValue({ data: { trigger: { id: 'trig_1' } } });
    expect((await getTrigger(TOKEN, 'trig_1') as any).data.id).toBe('trig_1');
    request.mockResolvedValue({ data: { id: 'trig_2' } });
    expect((await getTrigger(TOKEN, 'trig_2') as any).data.id).toBe('trig_2');
  });

  it('reports a create whose id did not come back as a failure', async () => {
    // Silently returning ok would leave Cronsole tracking nothing while a real
    // routine ran on the user's account.
    request.mockResolvedValue({ data: { trigger: {} } });
    const result = await createTrigger(TOKEN, { name: 'n', prompt: 'p', environmentId: 'env_1' });
    expect(result.ok).toBe(false);
  });
});

describe('errors name their cause', () => {
  it('sends an expired session to /login rather than to Cronsole settings', async () => {
    rejectWith(401);
    const result = await listTriggers(TOKEN);
    expect(result.ok).toBe(false);
    expect((result as any).message).toMatch(/login/i);
  });

  const CASES: Array<[number, RegExp]> = [
    [403, /plan|access/i],
    [404, /no longer exists/i],
    [429, /rate limited/i],
    [500, /server error/i],
    [503, /overloaded/i]
  ];
  for (const [status, expected] of CASES) {
    it(`explains a ${status}`, async () => {
      rejectWith(status);
      const result = await getTrigger(TOKEN, 'trig_1');
      expect((result as any).message).toMatch(expected);
    });
  }

  it('flags a withdrawn API as surfaceMoved, so the connector can fall back', async () => {
    // This is the difference between "your routine is gone" and "this
    // undocumented endpoint changed" — and only the second should send the
    // connector back to the per-routine token.
    rejectWith(400, { error: { message: 'unsupported anthropic-beta value' } });
    expect((await listTriggers(TOKEN) as any).surfaceMoved).toBe(true);

    rejectWith(404);
    expect((await listTriggers(TOKEN) as any).surfaceMoved).toBe(true);
  });

  it('does NOT call a missing single routine a surface change', async () => {
    // A 404 on one id is a fact about that routine. Treating it as the API
    // moving would fire the routine again through the other door.
    rejectWith(404);
    expect((await getTrigger(TOKEN, 'trig_1') as any).surfaceMoved).toBeUndefined();
  });

  it('carries Retry-After through on a 429', async () => {
    rejectWith(429, {}, { 'retry-after': '90' });
    expect((await listTriggers(TOKEN) as any).message).toContain('90');
  });

  it('never throws — the connector is written to branch, not to catch', async () => {
    request.mockRejectedValue(new Error('socket hang up'));
    await expect(listTriggers(TOKEN)).resolves.toMatchObject({ ok: false });
  });
});

describe('reading a trigger', () => {
  it('treats the API\'s zero timestamp as absent, not as the year 1', () => {
    // `0001-01-01T00:00:00Z` parses happily and would render as a next-run time
    // roughly two thousand years ago.
    expect(parseTimestamp('0001-01-01T00:00:00Z')).toBeNull();
    expect(parseTimestamp(undefined)).toBeNull();
    expect(parseTimestamp('not a date')).toBeNull();
    expect(parseTimestamp('2026-08-17T04:32:32Z')).toEqual(new Date('2026-08-17T04:32:32Z'));
  });

  it('takes the environment from whichever routine already has one', () => {
    const withEnv = { job_config: { ccr: { environment_id: 'env_ok' } } } as ClaudeTrigger;
    const without = { job_config: {} } as ClaudeTrigger;
    expect(environmentIdFrom([without, withEnv])).toBe('env_ok');
    expect(environmentIdFrom([without])).toBeNull();
    expect(environmentIdFrom([])).toBeNull();
    // Only a real env_ id — a malformed value must not be passed on as if valid.
    expect(environmentIdFrom([{ job_config: { ccr: { environment_id: 'nope' } } } as ClaudeTrigger])).toBeNull();
  });

  it('pulls the prompt and repositories back out for display', () => {
    const trigger = {
      job_config: {
        ccr: {
          session_context: { sources: [{ git_repository: { url: 'https://github.com/o/r' } }, {}] },
          events: [{ data: { message: { content: 'Audit the sidebar.' } } }]
        }
      }
    } as ClaudeTrigger;
    expect(promptOf(trigger)).toBe('Audit the sidebar.');
    expect(repositoriesOf(trigger)).toEqual(['https://github.com/o/r']);
    expect(promptOf({} as ClaudeTrigger)).toBeNull();
    expect(repositoriesOf({} as ClaudeTrigger)).toEqual([]);
  });
});
