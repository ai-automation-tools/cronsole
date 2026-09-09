import { describe, it, expect } from 'vitest';
import { applySystemLens } from '../systemTasks';
import type { Task } from '../../types';

const task = (id: string, over: Partial<Task> = {}): Task => ({
  id,
  name: id,
  category: 'Work',
  platform: 'WINDOWS_TASK_SCHEDULER',
  status: 'ACTIVE',
  externalId: `\\Work\\${id}`,
  updatedAt: '2026-07-28T00:00:00Z',
  ...over
});

const system = (id: string) =>
  task(id, { isSystem: true, category: 'Microsoft', externalId: `\\Microsoft\\Windows\\${id}` });

describe('applySystemLens', () => {
  it('hides OS-owned tasks by default and reports how many', () => {
    const { visible, hidden } = applySystemLens(
      [task('mine'), system('Defender'), system('UpdateOrchestrator')],
      false
    );

    expect(visible!.map(t => t.id)).toEqual(['mine']);
    // The count is the load-bearing part: a dashboard that withholds rows
    // without saying so is lying by omission.
    expect(hidden).toBe(2);
  });

  it('still reports the count while showing system tasks', () => {
    // Otherwise the "on" state is a label with nothing behind it, and the user
    // cannot tell how much of the list is not theirs.
    const { visible, hidden } = applySystemLens([task('mine'), system('Defender')], true);

    expect(visible!.map(t => t.id)).toEqual(['mine', 'Defender']);
    expect(hidden).toBe(1);
  });

  it('counts hidden tasks over ALL tasks, not the filtered set', () => {
    // Counting the filtered set would always return 0 in the hiding state —
    // the exact failure the count exists to prevent.
    const { hidden } = applySystemLens([system('a'), system('b'), system('c')], false);
    expect(hidden).toBe(3);
  });

  it('treats a task with no isSystem flag as the user\'s own', () => {
    // An older backend omits the field; degrading to "system" would hide the
    // entire dashboard, which is the worst possible direction to fail in.
    const { visible, hidden } = applySystemLens([task('legacy')], false);
    expect(visible!.map(t => t.id)).toEqual(['legacy']);
    expect(hidden).toBe(0);
  });

  it('keeps "not loaded yet" distinguishable from "no tasks"', () => {
    // Collapsing undefined to [] flashes the empty state over a live fetch.
    expect(applySystemLens(undefined, false)).toEqual({ visible: undefined, hidden: 0 });
    expect(applySystemLens([], false)).toEqual({ visible: [], hidden: 0 });
  });

  it('is independent of task status, so it composes with the active filter', () => {
    // "personal AND active" is the real default view; either lens must be able
    // to change without disturbing the other.
    const { visible } = applySystemLens(
      [task('a', { status: 'DISABLED' }), task('b', { status: 'MISSING' }), system('c')],
      false
    );
    expect(visible!.map(t => t.id)).toEqual(['a', 'b']);
  });
});
