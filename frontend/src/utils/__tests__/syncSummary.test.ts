import { describe, it, expect } from 'vitest';
import { describeUntracked } from '../syncSummary';

const win = (count: number, folders: string[], systemCount = 0) => ({
  platform: 'WINDOWS_TASK_SCHEDULER',
  untracked: { count, folders, systemCount }
});

describe('describeUntracked', () => {
  it('names the tasks and folders a sync left behind', () => {
    // The #20 scenario: real tasks the connector reported on every sync while
    // the dashboard said only "Tasks synced."
    expect(describeUntracked({ results: [win(26, ['IAM', 'Edge-Radar-MikesAILab'])] })).toBe(
      "Synced. 26 tasks in 2 folders aren't imported — use Import to add them."
    );
  });

  it('returns null when everything reported is already tracked', () => {
    // Null is the signal to fall back to the plain success toast — the message
    // must not appear as "0 tasks in 0 folders".
    expect(describeUntracked({ results: [win(0, [])] })).toBeNull();
  });

  it('reads correctly for a single task in a single folder', () => {
    expect(describeUntracked({ results: [win(1, ['IAM'])] })).toBe(
      "Synced. 1 task in 1 folder isn't imported — use Import to add it."
    );
  });

  it('counts a folder once even when two platforms report it', () => {
    // Inflating the folder count would be its own small dishonesty in a message
    // whose whole job is to be accurate.
    const message = describeUntracked({
      results: [win(2, ['Shared']), { platform: 'TASKHUB_NATIVE', untracked: { count: 1, folders: ['Shared'], systemCount: 0 } }]
    });
    expect(message).toBe("Synced. 3 tasks in 1 folder aren't imported — use Import to add them.");
  });

  it('ignores OS-owned tasks, which the backend counts separately', () => {
    // 257 \Microsoft\ tasks must not reach this sentence, or it becomes a
    // constant — and a warning that never changes is one you stop reading.
    expect(describeUntracked({ results: [win(0, [], 257)] })).toBeNull();
  });

  it('survives a platform that errored instead of reporting', () => {
    // One platform failing must not abort the others' sync, so a result can
    // carry `error` and no `untracked` at all.
    const message = describeUntracked({
      results: [{ platform: 'WINDOWS_TASK_SCHEDULER', error: 'Agent offline' }, win(4, ['IAM'])]
    });
    expect(message).toBe("Synced. 4 tasks in 1 folder aren't imported — use Import to add them.");
  });

  it('returns null for a malformed or empty response rather than throwing', () => {
    expect(describeUntracked(undefined)).toBeNull();
    expect(describeUntracked({})).toBeNull();
    expect(describeUntracked({ results: [] })).toBeNull();
  });
});
