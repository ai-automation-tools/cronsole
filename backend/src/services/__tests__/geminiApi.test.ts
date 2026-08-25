import { describe, it, expect, vi, beforeEach } from 'vitest';

const getMock = vi.fn();
vi.mock('axios', () => ({ default: { create: () => ({ get: getMock }) } }));

import { toTrigger, toExecution, isSuccessStatus, isPendingStatus, listExecutions } from '../geminiApi.js';

/**
 * `toTrigger` is exported for exactly this — and until #82 nothing called it.
 *
 * The comment on it already said the module reads both spellings of every field
 * because "reading one spelling and silently getting `null` for the other is the
 * failure that would show up as *every trigger has no schedule*". That happened,
 * one field over: `interaction.input` is written as a string and read back as a
 * structured array, so every synced trigger lost its prompt — including one
 * Cronsole had just created *with* that prompt, which is what made it look like a
 * display bug rather than a parse one.
 */
describe('toTrigger reads the prompt in both shapes the API uses', () => {
  const withInput = (input: unknown) => toTrigger({ id: 'trg_1', interaction: { input } });

  it('reads the string a create sends', () => {
    // `POST /v1beta/triggers` accepts `interaction.input: "…"`, so this spelling
    // is what Cronsole itself writes.
    expect(withInput('Summarise yesterday')?.input).toBe('Summarise yesterday');
  });

  it('reads the structured array a GET returns for that same trigger', () => {
    const raw = [{ type: 'user_input', content: [{ type: 'text', text: 'Summarise yesterday' }] }];
    expect(withInput(raw)?.input).toBe('Summarise yesterday');
  });

  it('joins multiple text parts rather than picking one', () => {
    const raw = [
      { type: 'user_input', content: [{ type: 'text', text: 'first' }] },
      { type: 'user_input', content: [{ type: 'text', text: 'second' }] }
    ];
    expect(withInput(raw)?.input).toBe('first\nsecond');
  });

  it('skips a non-text part instead of stringifying it', () => {
    // This value is displayed as the task's action. A shorter true sentence beats
    // `[object Object]` on screen.
    const raw = [{ content: [{ type: 'image', uri: 'x' }, { type: 'text', text: 'kept' }] }];
    expect(withInput(raw)?.input).toBe('kept');
  });

  it('is null when there is nothing readable, never an empty string', () => {
    // `null` is what `syncTasks` tests to decide whether `metadata.prompt` exists
    // at all — an empty string would put a blank field on the task instead.
    expect(withInput([])?.input).toBeNull();
    expect(withInput(undefined)?.input).toBeNull();
    expect(withInput([{ content: [] }])?.input).toBeNull();
  });
});

describe('run outcomes are read in the platform vocabulary, not the docs one', () => {
  // The docs say `succeeded`; the API returns `completed`. Reading only the
  // documented word scored every healthy trigger as a critical failure — see the
  // Gemini block in taskHealth.test.ts for the consequence.
  it('accepts both success words and nothing else', () => {
    expect(isSuccessStatus('completed')).toBe(true);
    expect(isSuccessStatus('succeeded')).toBe(true);
    expect(isSuccessStatus('failed')).toBe(false);
    expect(isSuccessStatus('cancelled')).toBe(false);
  });

  it('knows an unfinished run is not an outcome', () => {
    // `in_progress` is what the API actually returns while an agent is working;
    // the other three are kept because this vocabulary is preview-era and a new
    // spelling read as "finished" becomes a failure that never happened.
    expect(isPendingStatus('in_progress')).toBe(true);
    expect(isPendingStatus('running')).toBe(true);
    expect(isPendingStatus('completed')).toBe(false);
  });

  it('keeps the platform word verbatim rather than mapping it', () => {
    // Lowercased only. Translating it into Cronsole's own ExecutionStatus would
    // be a second judgement about an outcome the platform already named.
    expect(toExecution({ id: 'e1', status: 'COMPLETED' })?.status).toBe('completed');
    expect(toExecution({ id: 'e1' })?.status).toBe('unknown');
  });

  it('reads both timestamp spellings', () => {
    expect(toExecution({ id: 'e1', start_time: '2026-08-25T15:55:46.904095Z' })?.startTime)
      .toEqual(new Date('2026-08-25T15:55:46.904095Z'));
    expect(toExecution({ id: 'e1', endTime: '2026-08-25T15:56:39.919747Z' })?.endTime)
      .toEqual(new Date('2026-08-25T15:56:39.919747Z'));
  });
});

describe('listExecutions reads the array the API actually returns', () => {
  beforeEach(() => getMock.mockReset());

  const ok = (data: unknown) => getMock.mockResolvedValue({ status: 200, data });

  it('reads `trigger_executions`, which is what the endpoint answers', async () => {
    // The list endpoint names its array after the resource, not after the path —
    // unlike `GET /triggers`, which really does answer `{ triggers: [...] }`.
    // Reading the obvious key gave `[]` for every trigger forever, and `[]` is
    // not an error here: it is the platform saying "this has never run". So a
    // source that reports run outcomes reported none, and every trigger looked
    // brand new (#83).
    ok({ trigger_executions: [{ id: 'e1', status: 'completed', start_time: '2026-08-25T15:55:46Z' }] });
    const result = await listExecutions('key', 'trg_1');
    expect(result.ok && result.data).toHaveLength(1);
    expect(result.ok && result.data[0]!.status).toBe('completed');
  });

  it('still reads the camelCase and bare spellings', async () => {
    ok({ triggerExecutions: [{ id: 'e1', status: 'completed' }] });
    expect((await listExecutions('key', 'trg_1') as { data: unknown[] }).data).toHaveLength(1);
    ok({ executions: [{ id: 'e2', status: 'completed' }] });
    expect((await listExecutions('key', 'trg_1') as { data: unknown[] }).data).toHaveLength(1);
  });

  it('reads an empty answer as empty, not as a failure', async () => {
    // `{}` is what a trigger that has never run returns, and it must stay
    // distinguishable from a read that failed — `runs: null` vs `runs: []` is the
    // whole basis of `reportsRunResult`.
    ok({});
    const result = await listExecutions('key', 'trg_1');
    expect(result.ok).toBe(true);
    expect(result.ok && result.data).toEqual([]);
  });

  it('reports a refusal rather than an empty list', async () => {
    getMock.mockResolvedValue({ status: 403, data: { error: { message: 'nope' } } });
    const result = await listExecutions('key', 'trg_1');
    expect(result.ok).toBe(false);
  });
});
