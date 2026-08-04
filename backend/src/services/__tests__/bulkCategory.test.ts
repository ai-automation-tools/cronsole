import { describe, it, expect } from 'vitest';
import { PlatformType } from '@prisma/client';
import {
  idsToUpdate,
  planBulkCategory,
  summarizeBulkCategory,
  type BulkCategoryTask
} from '../bulkCategory.js';

const task = (over: Partial<BulkCategoryTask> = {}): BulkCategoryTask => ({
  id: 'task-1',
  name: 'Nightly backup',
  platform: PlatformType.WINDOWS_TASK_SCHEDULER,
  category: 'Work',
  folderCategory: 'Work',
  ...over
});

describe('planBulkCategory', () => {
  it('reports each task individually rather than one batch verdict', () => {
    const report = planBulkCategory(
      [task({ id: 'a', name: 'A' }), task({ id: 'b', name: 'B' })],
      'Backups'
    );

    expect(report.requested).toBe(2);
    expect(report.updated).toBe(2);
    expect(report.items.map(i => i.taskId)).toEqual(['a', 'b']);
    expect(report.category).toBe('Backups');
  });

  it('counts a task already in the target category as unchanged, not updated', () => {
    // Same rule as bulk status: the number people read is `updated`. Counting a
    // no-op there inflates it; counting it as failed invents an error.
    const report = planBulkCategory([task({ category: 'Backups' })], 'Backups');

    expect(report.updated).toBe(0);
    expect(report.unchanged).toBe(1);
    expect(report.items[0].message).toContain('Already in "Backups"');
  });

  it('never writes the tasks it reported as unchanged', () => {
    const report = planBulkCategory(
      [task({ id: 'a', category: 'Backups' }), task({ id: 'b', category: 'Work' })],
      'Backups'
    );
    expect(idsToUpdate(report)).toEqual(['b']);
  });

  it('has no failure or halt path at all, because it never asks a platform', () => {
    // Structural, not incidental: nothing in this verb can discover the agent is
    // gone. The zeros stay in the response so one report shape covers every bulk
    // verb — a caller reading four zeros learns something, a caller reading four
    // different shapes learns nothing.
    const report = planBulkCategory([task(), task({ id: 'b' })], 'Backups');
    expect(report.failed).toBe(0);
    expect(report.refused).toBe(0);
    expect(report.skipped).toBe(0);
    expect(report.haltedReason).toBeUndefined();
  });

  it('counts a Windows label that no longer matches its real folder', () => {
    // The honesty case this verb exists to get right. A Windows task's category
    // is derived from its Task Scheduler folder, so relabelling it makes the
    // dashboard group tasks differently from the machine — legitimate, but never
    // silent.
    const report = planBulkCategory(
      [task({ id: 'a', category: 'Work', folderCategory: 'Work' })],
      'Backups'
    );
    expect(report.detachedFromFolder).toBe(1);
    expect(summarizeBulkCategory(report)).toContain('differently from its Windows folder');
  });

  it('does not count a move that puts the label back on its real folder', () => {
    const report = planBulkCategory(
      [task({ category: 'Renamed', folderCategory: 'Backups' })],
      'Backups'
    );
    expect(report.updated).toBe(1);
    expect(report.detachedFromFolder).toBe(0);
  });

  it('never counts a Cronsole-native task as detached — it has no folder to detach from', () => {
    const report = planBulkCategory(
      [
        task({
          platform: PlatformType.TASKHUB_NATIVE,
          category: 'Cronsole',
          folderCategory: 'Uncategorized'
        })
      ],
      'Backups'
    );
    expect(report.updated).toBe(1);
    expect(report.detachedFromFolder).toBe(0);
  });
});

describe('summarizeBulkCategory', () => {
  it('names every non-zero outcome, not just the successes', () => {
    const report = planBulkCategory(
      [
        task({ id: 'a' }),
        task({ id: 'b', category: 'Backups' }),
        task({ id: 'c', platform: PlatformType.TASKHUB_NATIVE })
      ],
      'Backups'
    );
    const summary = summarizeBulkCategory(report);

    expect(summary).toContain('2 moved to "Backups"');
    expect(summary).toContain('1 already there');
  });
});
