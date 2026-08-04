import { describe, it, expect } from 'vitest';
import { PlatformType } from '@prisma/client';
import { planBulkUntrack, summarizeBulkUntrack, type BulkUntrackTask } from '../bulkUntrack.js';

const task = (over: Partial<BulkUntrackTask> = {}): BulkUntrackTask => ({
  id: 'task-1',
  name: 'Nightly backup',
  platform: PlatformType.WINDOWS_TASK_SCHEDULER,
  externalId: '\\Work\\Nightly backup',
  ...over
});

describe('planBulkUntrack', () => {
  it('reports each task individually rather than one batch verdict', () => {
    const { report } = planBulkUntrack([task({ id: 'a', name: 'A' }), task({ id: 'b', name: 'B' })]);

    expect(report.requested).toBe(2);
    expect(report.updated).toBe(2);
    expect(report.items.map(i => i.taskId)).toEqual(['a', 'b']);
  });

  it('plans an exclusion for every task it removes', () => {
    // Without the exclusion the next sync re-imports what the user just removed
    // — correct by the sync's logic, and indistinguishable from "untrack is
    // broken" from the outside.
    const { plan } = planBulkUntrack([
      task({ id: 'a', externalId: '\\Work\\A' }),
      task({ id: 'b', externalId: '\\Work\\B' })
    ]);

    expect(plan).toEqual([
      { taskId: 'a', platform: PlatformType.WINDOWS_TASK_SCHEDULER, externalId: '\\Work\\A' },
      { taskId: 'b', platform: PlatformType.WINDOWS_TASK_SCHEDULER, externalId: '\\Work\\B' }
    ]);
  });

  it('refuses a Cronsole-native task instead of deleting it under a gentler name', () => {
    // The load-bearing rule. A native task's DB row IS the task, so "untrack but
    // keep it" cannot be true — and doing a delete here would be a destructive
    // action wearing a reversible label.
    const { report, plan } = planBulkUntrack([task({ platform: PlatformType.TASKHUB_NATIVE })]);

    expect(report.refused).toBe(1);
    expect(report.updated).toBe(0);
    expect(plan).toEqual([]);
    expect(report.items[0].message).toContain('exist only inside Cronsole');
  });

  it('does not let one refusal halt the rest of the batch', () => {
    // A per-task refusal says nothing about the next task — the same
    // discrimination bulkStatus makes for an ACL denial. Getting this wrong in
    // either direction is a bug.
    const { report, plan } = planBulkUntrack([
      task({ id: 'a' }),
      task({ id: 'native', platform: PlatformType.TASKHUB_NATIVE }),
      task({ id: 'b' })
    ]);

    expect(report.updated).toBe(2);
    expect(report.refused).toBe(1);
    expect(report.skipped).toBe(0);
    expect(report.haltedReason).toBeUndefined();
    expect(plan.map(p => p.taskId)).toEqual(['a', 'b']);
  });

  it('has no failure path, because it never asks a platform', () => {
    const { report } = planBulkUntrack([task(), task({ id: 'b' })]);
    expect(report.failed).toBe(0);
    expect(report.skipped).toBe(0);
  });
});

describe('summarizeBulkUntrack', () => {
  it('says "removed from Cronsole", never "removed"', () => {
    // The scheduled tasks are still on the machine and still running. A toast
    // reading "40 removed" is precisely the wrong thing to believe.
    const { report } = planBulkUntrack([task({ id: 'a' }), task({ id: 'b' })]);
    expect(summarizeBulkUntrack(report)).toBe('2 removed from Cronsole');
  });

  it('names the refusals alongside the successes', () => {
    const { report } = planBulkUntrack([
      task({ id: 'a' }),
      task({ id: 'native', platform: PlatformType.TASKHUB_NATIVE })
    ]);
    expect(summarizeBulkUntrack(report)).toBe('1 removed from Cronsole · 1 refused');
  });
});
