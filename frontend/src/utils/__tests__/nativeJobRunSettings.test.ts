import { describe, it, expect } from 'vitest';
import {
  nativeJobPayload,
  nativeJobIncomplete,
  runsEdit,
  emptyNativeJobValues,
  type NativeJobValues
} from '../taskEditing';
import type { Task } from '../../types';

// ADR 0004: the time limit and run policy round-trip through the form.

const values = (over: Partial<NativeJobValues> = {}): NativeJobValues => ({
  ...emptyNativeJobValues(),
  jobType: 'EXEC',
  command: 'node digest.js',
  ...over
});

const nativeTask = (job: Record<string, unknown>) =>
  ({ id: 't', name: 't', platform: 'TASKHUB_NATIVE', metadata: { job } }) as unknown as Task;

describe('native run settings', () => {
  it('sends nothing extra when every setting is its default', () => {
    expect(nativeJobPayload(values())).toEqual({ jobType: 'EXEC', command: 'node digest.js' });
  });

  it('sends the time limit in ms and only the non-default policy fields', () => {
    expect(nativeJobPayload(values({
      timeoutMinutes: '120', retries: '2', retryDelayMinutes: '5', overlap: 'queue', catchUp: true
    }))).toEqual({
      jobType: 'EXEC',
      command: 'node digest.js',
      timeoutMs: 7_200_000,
      policy: { overlap: 'queue', catchUp: true, retries: 2, retryDelayMinutes: 5 }
    });
  });

  it('never sends retries or a time limit for a check', () => {
    const check = values({
      jobType: 'CHECK', checkKind: 'tcp', checkHost: 'h', checkPort: '1',
      retries: '3', timeoutMinutes: '30', catchUp: true
    });
    expect(nativeJobPayload(check)).toEqual({
      jobType: 'CHECK', probe: { kind: 'tcp', host: 'h', port: 1 }, policy: { catchUp: true }
    });
    expect(nativeJobIncomplete(check)).toBeNull();
  });

  it('reads a stored limit and policy back, so an edit does not reset them', () => {
    const edit = runsEdit(nativeTask({
      jobType: 'SCRIPT', interpreter: 'node', body: 'x', timeoutMs: 7_200_000,
      policy: { retries: 2, overlap: 'queue', catchUp: true }
    }));
    expect(edit.kind).toBe('native');
    const v = (edit as { initial: NativeJobValues }).initial;
    expect(v).toMatchObject({ timeoutMinutes: '120', retries: '2', retryDelayMinutes: '1', overlap: 'queue', catchUp: true });
    expect(nativeJobPayload(v)).toMatchObject({ timeoutMs: 7_200_000, policy: { retries: 2, overlap: 'queue', catchUp: true } });
  });

  it('blocks out-of-range values with a sentence', () => {
    expect(nativeJobIncomplete(values({ timeoutMinutes: '1441' }))).toMatch(/24 hours/);
    expect(nativeJobIncomplete(values({ retries: '6' }))).toMatch(/0 to 5/);
    expect(nativeJobIncomplete(values({ retries: '1', retryDelayMinutes: '0' }))).toMatch(/1 to 60/);
  });
});
