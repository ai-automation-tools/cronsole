import { describe, it, expect } from 'vitest';
import { describeUntracked, describeCoverage } from '../syncSummary';

const win = (count: number, folders: string[], systemCount = 0) => ({
  platform: 'WINDOWS_TASK_SCHEDULER',
  untracked: { count, folders, systemCount }
});

describe('describeUntracked', () => {
  it('names the tasks and folders a sync left behind', () => {
    // The #20 scenario: real tasks the connector reported on every sync while
    // the dashboard said only "Tasks synced."
    expect(describeUntracked({ results: [win(26, ['IAM', 'Edge-Radar-MikesAILab'])] })).toBe(
      "Synced. 26 tasks in 2 folders aren't imported — add them from Sync › Add tasks from this machine."
    );
  });

  it('returns null when everything reported is already tracked', () => {
    // Null is the signal to fall back to the plain success toast — the message
    // must not appear as "0 tasks in 0 folders".
    expect(describeUntracked({ results: [win(0, [])] })).toBeNull();
  });

  it('reads correctly for a single task in a single folder', () => {
    expect(describeUntracked({ results: [win(1, ['IAM'])] })).toBe(
      "Synced. 1 task in 1 folder isn't imported — add it from Sync › Add tasks from this machine."
    );
  });

  it('counts a folder once even when two platforms report it', () => {
    // Inflating the folder count would be its own small dishonesty in a message
    // whose whole job is to be accurate.
    const message = describeUntracked({
      results: [win(2, ['Shared']), { platform: 'TASKHUB_NATIVE', untracked: { count: 1, folders: ['Shared'], systemCount: 0 } }]
    });
    expect(message).toBe("Synced. 3 tasks in 1 folder aren't imported — add them from Sync › Add tasks from this machine.");
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
    expect(message).toBe("Synced. 4 tasks in 1 folder aren't imported — add them from Sync › Add tasks from this machine.");
  });

  it('returns null for a malformed or empty response rather than throwing', () => {
    expect(describeUntracked(undefined)).toBeNull();
    expect(describeUntracked({})).toBeNull();
    expect(describeUntracked({ results: [] })).toBeNull();
  });

  describe('re-imported exclusions', () => {
    it('says when an import brought back tasks the user had removed', () => {
      // Importing a folder forgets the untracks inside it — correct, since
      // importing IS the request for that folder, but a row reappearing with no
      // explanation is indistinguishable from untrack being broken.
      expect(describeUntracked({
        results: [{ platform: 'WINDOWS_TASK_SCHEDULER', exclusionsCleared: 3, untracked: { count: 0, folders: [], systemCount: 0 } }]
      })).toBe('Re-imported 3 tasks you had removed from Cronsole.');
    });

    it('reads correctly for a single restored task', () => {
      expect(describeUntracked({
        results: [{ platform: 'WINDOWS_TASK_SCHEDULER', exclusionsCleared: 1 }]
      })).toBe('Re-imported 1 task you had removed from Cronsole.');
    });

    it('leads with the restore note and still reports what was left out', () => {
      expect(describeUntracked({
        results: [{ ...win(4, ['IAM']), exclusionsCleared: 2 }]
      })).toBe(
        'Re-imported 2 tasks you had removed from Cronsole. ' +
        "Synced. 4 tasks in 1 folder aren't imported — add them from Sync › Add tasks from this machine."
      );
    });

    it('stays silent when a plain Sync restored nothing', () => {
      // A plain Sync must never clear exclusions, so this is the common case and it
      // must not gain a sentence about something that didn't happen.
      expect(describeUntracked({
        results: [{ ...win(0, []), exclusionsCleared: 0 }]
      })).toBeNull();
    });
  });
});

describe('describeCoverage', () => {
  it('says what the sync looked at, not only what it kept', () => {
    // The line that separates "correctly imported nothing" from "broken", which
    // are the same empty dashboard otherwise (troubleshooting #75).
    expect(describeCoverage({
      results: [{
        platform: 'GITHUB_ACTIONS',
        notes: ['GitHub Actions: read 9 workflows across 3 repositories, 3 scheduled.']
      }]
    })).toBe('GitHub Actions: read 9 workflows across 3 repositories, 3 scheduled.');
  });

  it('is null when no connector had anything to add', () => {
    // Three of the four connectors send nothing, and a platform with nothing to
    // say must not be made to pad the toast.
    expect(describeCoverage({ results: [{ platform: 'WINDOWS_TASK_SCHEDULER', count: 4 } as never] })).toBeNull();
    expect(describeCoverage(undefined)).toBeNull();
  });

  it('keeps coverage out of the untracked sentence', () => {
    // They are shown together but decided apart: coverage is success info and
    // obeys `toastOnSuccess`, the untracked sentence never can.
    const data = {
      results: [{
        platform: 'GITHUB_ACTIONS',
        notes: ['GitHub Actions: read 2 workflows across 1 repository, 0 scheduled.'],
        untracked: { count: 0, folders: [], systemCount: 0 }
      }]
    };
    expect(describeUntracked(data)).toBeNull();
    expect(describeCoverage(data)).toContain('0 scheduled');
  });
});

describe('warnings, which a preference may not suppress', () => {
  it('reports a partial read even when everything else succeeded', () => {
    // This used to be pushed onto the connector's `failures` list, which is only
    // read when EVERY repository failed — so the one warning about a partial
    // read was discarded in exactly the case it described.
    expect(describeUntracked({
      results: [{
        platform: 'GITHUB_ACTIONS',
        warnings: ['acme/big: 137 workflows, of which Cronsole read 100.']
      }]
    })).toBe('acme/big: 137 workflows, of which Cronsole read 100.');
  });

  it('puts the warning ahead of the untracked sentence', () => {
    const said = describeUntracked({
      results: [{
        platform: 'GITHUB_ACTIONS',
        warnings: ['Could not read acme/private: 404.'],
        untracked: { count: 2, folders: ['acme/web'], systemCount: 0 }
      }]
    });
    expect(said).toMatch(/^Could not read acme\/private: 404\. Synced\. 2 tasks/);
  });
});
