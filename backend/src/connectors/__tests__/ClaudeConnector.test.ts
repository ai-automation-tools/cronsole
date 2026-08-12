import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { HealthState } from '@prisma/client';

vi.mock('axios');
vi.mock('../../db.js', () => ({
  prisma: { platformCapability: { findUnique: vi.fn() } }
}));

import { ClaudeConnector } from '../ClaudeConnector.js';
import { prisma } from '../../db.js';

/**
 * Claude Code exposes exactly one routines endpoint — `POST .../fire` — whose
 * token the reference describes as having "no read access". Everything pinned
 * here follows from that, and each case is one the old scaffold got wrong.
 */

const findUnique = prisma.platformCapability.findUnique as unknown as ReturnType<typeof vi.fn>;
const CONFIG = { userId: 'u1', routines: [{ id: 'trig_1', token: 'sk-ant-oat01-x', name: 'Nightly review' }] };

beforeEach(() => {
  vi.clearAllMocks();
  findUnique.mockResolvedValue(null);
});

describe('syncTasks — a declared registry, not a read', () => {
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
    // A routine's cadence lives in claude.ai and cannot be read. Guessing one
    // would print a confident next-run time for a task Cronsole never schedules.
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
});

describe('runTask — the one verb with a platform behind it', () => {
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

  it('names the token as the problem when one is missing', async () => {
    const result = await connector.runTask('trig_1', { routines: [{ id: 'trig_1' }] });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/token/i);
    expect(axios.post).not.toHaveBeenCalled();
  });

  // Each status means something different to the user, and two of them are not
  // really errors: a paused routine is the ONLY signal Cronsole ever gets about
  // a routine's enabled state, and 429 is a quota boundary, not a broken config.
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
    const result = await connector.runTask('trig_1', CONFIG);
    expect(result.message).toContain('90');
  });

  it('falls back to the transport error when there is no response', async () => {
    (axios.post as any).mockRejectedValue(new Error('Network error'));
    const result = await connector.runTask('trig_1', CONFIG);
    expect(result.success).toBe(false);
    expect(result.message).toBe('Network error');
  });
});

describe('getHealth — evidence, never a precondition', () => {
  const connector = new ClaudeConnector();

  it('does NOT report healthy just because a routine is configured', async () => {
    // The bug this replaces (troubleshooting #40's shape): the old connector
    // returned HEALTHY whenever config was non-empty — a verdict derived from
    // something that cannot change when the platform fails.
    findUnique.mockResolvedValue(null);
    const health = await connector.getHealth(CONFIG);
    expect(health.state).not.toBe(HealthState.HEALTHY);
    expect(health.reason).toMatch(/none fired yet|no read API/i);
  });

  it('never probes — the only endpoint has a side effect', async () => {
    // Checking whether a routine works and running the user's routine are the
    // same HTTP request, so a probing health check would fire their nightly job
    // on every poll and burn the daily run cap.
    await connector.getHealth(CONFIG);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('is healthy once a run has actually succeeded', async () => {
    const at = new Date('2026-08-12T10:00:00Z');
    findUnique.mockResolvedValue({ lastSuccessAt: at, lastFailureAt: null, lastFailureReason: null });

    const health = await connector.getHealth(CONFIG);
    expect(health.state).toBe(HealthState.HEALTHY);
    expect(health.lastContactAt).toEqual(at);
  });

  it('reports the newest outcome, not merely any failure on record', async () => {
    const older = new Date('2026-08-11T10:00:00Z');
    const newer = new Date('2026-08-12T10:00:00Z');

    findUnique.mockResolvedValue({ lastSuccessAt: newer, lastFailureAt: older, lastFailureReason: 'old news' });
    expect((await connector.getHealth(CONFIG)).state).toBe(HealthState.HEALTHY);

    findUnique.mockResolvedValue({ lastSuccessAt: older, lastFailureAt: newer, lastFailureReason: 'Token rejected' });
    const degraded = await connector.getHealth(CONFIG);
    expect(degraded.state).toBe(HealthState.DEGRADED);
    expect(degraded.reason).toContain('Token rejected');
    // A rejection is still contact — Anthropic answered us.
    expect(degraded.lastContactAt).toEqual(newer);
  });

  it('degrades with no routines configured', async () => {
    const health = await connector.getHealth({ userId: 'u1' });
    expect(health.state).toBe(HealthState.DEGRADED);
    expect(health.reason).toMatch(/no routines/i);
  });

  it('does not blame the platform when the evidence store is unreadable', async () => {
    findUnique.mockRejectedValue(new Error('db down'));
    const health = await connector.getHealth(CONFIG);
    expect(health.state).toBe(HealthState.DEGRADED);
    expect(health.reason).toMatch(/run history/i);
  });
});

describe('the verbs that cannot exist', () => {
  const connector = new ClaudeConnector();

  it('declares create and setStatus impossible rather than unimplemented', () => {
    expect(connector.unsupportedVerbs).toEqual(['create', 'setStatus']);
  });

  it('refuses setTaskStatus and points at where pausing actually happens', async () => {
    const result = await connector.setTaskStatus('trig_1', false, CONFIG);
    expect(result.success).toBe(false);
    expect(result.message).toContain('claude.ai/code/routines');
  });

  it('refuses createTask and points at where routines are made', async () => {
    const result = await connector.createTask('n', '0 * * * *', 'echo', CONFIG);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/claude\.ai\/code\/routines|\/schedule/);
  });

  it('implements none of the optional verbs', () => {
    // No export format, no import, no folders, no delete — a routine is not a
    // file and claude.ai owns its lifecycle.
    const c = connector as unknown as Record<string, unknown>;
    for (const method of ['deleteTask', 'exportTask', 'importTask', 'listFolders', 'updateSchedule', 'updateActions']) {
      expect(c[method]).toBeUndefined();
    }
  });
});
