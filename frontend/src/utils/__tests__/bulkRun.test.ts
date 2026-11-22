import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Task } from '../../types';

const post = vi.fn();
vi.mock('../../api', () => ({ api: { post: (...a: unknown[]) => post(...a) } }));

import { describeSelection, eligibleForSelection, runBulk } from '../bulkRun';

const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id,
  name: `T${id}`,
  externalId: id,
  platform: 'WINDOWS_TASK_SCHEDULER',
  status: 'ACTIVE',
  category: 'C',
  updatedAt: '2026-11-13T00:00:00Z',
  metadata: {},
  ...extra
});

describe('selection helpers', () => {
  it('counts only the tasks a label would change', () => {
    const tasks = [task('1', { isFavorite: true }), task('2'), task('3', { isSystem: true, hiddenByUser: true }), task('4', { isSystem: true })];
    expect(eligibleForSelection(tasks, 'favorite').map(t => t.id)).toEqual(['2', '3', '4']);
    expect(eligibleForSelection(tasks, 'unfavorite').map(t => t.id)).toEqual(['1']);
    // An OS-owned system task can be neither hidden nor moved out.
    expect(eligibleForSelection(tasks, 'hide').map(t => t.id)).toEqual(['1', '2']);
    expect(eligibleForSelection(tasks, 'unhide').map(t => t.id)).toEqual(['3']);
  });

  it('names the selection, not just its size', () => {
    expect(describeSelection([task('1')])).toBe('the 1 task you selected: “T1”');
    expect(describeSelection(['1', '2', '3', '4', '5'].map(i => task(i)))).toBe(
      'the 5 tasks you selected: “T1”, “T2”, “T3” and 2 more'
    );
  });
});

describe('runBulk', () => {
  beforeEach(() => post.mockReset());

  it('chunks at 100 and reports every task a halt left unattempted', async () => {
    const targets = Array.from({ length: 150 }, (_, i) => task(String(i)));
    post.mockResolvedValueOnce({
      data: {
        requested: 100, updated: 1, unchanged: 0, refused: 0, failed: 0, skipped: 99,
        haltedReason: 'Agent offline.',
        items: [{ taskId: '0', name: 'T0', platform: 'WINDOWS_TASK_SCHEDULER', outcome: 'updated' }]
      }
    });
    const report = await runBulk('disable', targets);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/tools/tasks/status', expect.objectContaining({ status: 'DISABLED' }));
    expect(report.items).toHaveLength(150);
    expect(report.items.filter(i => i.outcome === 'skipped')).toHaveLength(149);
  });

  it('routes the label verbs to their bulk routes', async () => {
    post.mockResolvedValue({ data: { requested: 1, updated: 1, unchanged: 0, refused: 0, failed: 0, skipped: 0, items: [] } });
    await runBulk('hide', [task('1')]);
    await runBulk('unfavorite', [task('1')]);
    expect(post).toHaveBeenNthCalledWith(1, '/tools/tasks/hidden', { taskIds: ['1'], on: true });
    expect(post).toHaveBeenNthCalledWith(2, '/tools/tasks/favorite', { taskIds: ['1'], on: false });
  });
});
