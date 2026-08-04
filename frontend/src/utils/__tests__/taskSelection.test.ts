import { describe, it, expect } from 'vitest';
import type { Task } from '../../types';
import {
  pruneResolved,
  summarizeSelection,
  toggleSelectAll,
  toggleTaskSelection
} from '../taskSelection';

const task = (id: string, status: Task['status'] = 'ACTIVE'): Task => ({
  id,
  name: `Task ${id}`,
  externalId: `\\Cronsole\\${id}`,
  platform: 'WINDOWS_TASK_SCHEDULER',
  status,
  category: 'Backup',
  updatedAt: '2026-07-31T12:00:00Z',
  metadata: {}
});

const list = ['a', 'b', 'c', 'd', 'e'].map(id => task(id));

describe('toggleTaskSelection', () => {
  it('adds and removes a single task', () => {
    const one = toggleTaskSelection(new Set(), list, 'b');
    expect([...one]).toEqual(['b']);
    expect([...toggleTaskSelection(one, list, 'b')]).toEqual([]);
  });

  it('selects an inclusive range on shift-click', () => {
    const from = toggleTaskSelection(new Set(), list, 'b');
    const range = toggleTaskSelection(from, list, 'd', { shiftKey: true, anchorId: 'b' });
    expect([...range].sort()).toEqual(['b', 'c', 'd']);
  });

  it('selects a range clicked backwards', () => {
    const from = toggleTaskSelection(new Set(), list, 'd');
    const range = toggleTaskSelection(from, list, 'b', { shiftKey: true, anchorId: 'd' });
    expect([...range].sort()).toEqual(['b', 'c', 'd']);
  });

  it('clears a range when the clicked task was already selected', () => {
    // Direction follows the clicked row, like every file manager: shift-clicking
    // an already-selected endpoint deselects the range rather than re-adding it.
    const all = new Set(['a', 'b', 'c', 'd', 'e']);
    const cleared = toggleTaskSelection(all, list, 'd', { shiftKey: true, anchorId: 'b' });
    expect([...cleared].sort()).toEqual(['a', 'e']);
  });

  it('uses the order it is given, not a canonical one', () => {
    // The schedule view sorts by next run, so the same two endpoints bracket a
    // different set of tasks. Passing the wrong order selects the wrong rows —
    // silently, which is why the caller must pass the visible order.
    const scheduleOrder = ['e', 'd', 'c', 'b', 'a'].map(id => task(id));
    const from = toggleTaskSelection(new Set(), scheduleOrder, 'e');
    const range = toggleTaskSelection(from, scheduleOrder, 'c', { shiftKey: true, anchorId: 'e' });
    expect([...range].sort()).toEqual(['c', 'd', 'e']);
  });

  it('falls back to a plain toggle when the anchor is no longer in the list', () => {
    // The anchor can be filtered out between clicks (a search, a category
    // change). Guessing at a range from one endpoint would select arbitrary rows.
    const result = toggleTaskSelection(new Set(['z']), list, 'c', {
      shiftKey: true,
      anchorId: 'z'
    });
    expect([...result].sort()).toEqual(['c', 'z']);
  });

  it('treats shift-clicking the anchor itself as a plain toggle', () => {
    const from = toggleTaskSelection(new Set(), list, 'b');
    const result = toggleTaskSelection(from, list, 'b', { shiftKey: true, anchorId: 'b' });
    expect([...result]).toEqual([]);
  });

  it('does not mutate the set it was given', () => {
    const original = new Set(['a']);
    toggleTaskSelection(original, list, 'b');
    expect([...original]).toEqual(['a']);
  });
});

describe('toggleSelectAll', () => {
  it('selects every visible task, preserving off-screen members', () => {
    const result = toggleSelectAll(new Set(['z']), list.slice(0, 3));
    expect([...result].sort()).toEqual(['a', 'b', 'c', 'z']);
  });

  it('clears the visible ones when they are all already selected', () => {
    const result = toggleSelectAll(new Set(['a', 'b', 'c', 'z']), list.slice(0, 3));
    // 'z' is not visible, so select-all-visible must leave it alone.
    expect([...result]).toEqual(['z']);
  });

  it('is a no-op on an empty view rather than clearing the selection', () => {
    const result = toggleSelectAll(new Set(['a']), []);
    expect([...result]).toEqual(['a']);
  });
});

describe('summarizeSelection', () => {
  const all = [task('a'), task('b', 'DISABLED'), task('c', 'DISABLED'), task('d', 'MISSING')];

  it('counts enabled and disabled members', () => {
    const summary = summarizeSelection(new Set(['a', 'b', 'c']), all, all);
    expect(summary.enabledCount).toBe(1);
    expect(summary.disabledCount).toBe(2);
    expect(summary.tasks.map(t => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('counts a MISSING task in neither bucket', () => {
    // It can be selected, but neither Enable nor Disable will act on it — the
    // server refuses it. Counting it either way would overstate both buttons.
    const summary = summarizeSelection(new Set(['d']), all, all);
    expect(summary.enabledCount).toBe(0);
    expect(summary.disabledCount).toBe(0);
    expect(summary.tasks).toHaveLength(1);
  });

  it('reports how many selected tasks the current view is not showing', () => {
    // The case this exists for: kanban shows disabled tasks the other views
    // hide, so switching views can strand part of a selection off screen.
    const visible = [all[0]];
    const summary = summarizeSelection(new Set(['a', 'b', 'c']), all, visible);
    expect(summary.offscreenCount).toBe(2);
  });

  it('does not prune the selection to what is visible', () => {
    const summary = summarizeSelection(new Set(['a', 'b']), all, [all[0]]);
    // Both are still acted on — the bar states the gap instead of dropping them.
    expect(summary.tasks.map(t => t.id)).toEqual(['a', 'b']);
  });

  it('counts an id that matches no task at all as off screen', () => {
    const summary = summarizeSelection(new Set(['a', 'ghost']), all, [all[0]]);
    expect(summary.offscreenCount).toBe(1);
    expect(summary.tasks).toHaveLength(1);
  });

  it('excludes Cronsole-native tasks from the untrackable count', () => {
    // A native task's row IS the task, so "remove it from Cronsole but keep it
    // running" cannot be true and the server refuses it per item. The button
    // has to say 1, not 2, or it promises something that will be declined.
    const mixed = [task('win'), { ...task('native'), platform: 'TASKHUB_NATIVE' as const }];
    const summary = summarizeSelection(new Set(['win', 'native']), mixed, mixed);
    expect(summary.untrackableCount).toBe(1);
  });

  it('counts only Windows tasks as exportable', () => {
    const mixed = [task('win'), { ...task('native'), platform: 'TASKHUB_NATIVE' as const }];
    const summary = summarizeSelection(new Set(['win', 'native']), mixed, mixed);
    expect(summary.exportableCount).toBe(1);
  });

  it('counts eligibility against the whole selection, not what is on screen', () => {
    // The action runs on the whole selection — the bar already warns when part
    // of it is off screen — so a button labelled from the visible list would
    // promise the wrong number in exactly that case.
    const summary = summarizeSelection(new Set(['a', 'b', 'c']), all, [all[0]]);
    expect(summary.untrackableCount).toBe(3);
    expect(summary.exportableCount).toBe(3);
  });

  it('counts a MISSING task as untrackable — untrack is how you clear one', () => {
    // It is gone from the platform, so there is nothing to keep running, but
    // removing Cronsole's row is exactly the right move and needs no agent.
    const summary = summarizeSelection(new Set(['d']), all, all);
    expect(summary.untrackableCount).toBe(1);
  });
});

describe('pruneResolved', () => {
  it('drops the resolved ids and keeps the rest selected', () => {
    // Failures stay selected on purpose: the next move is a retry, and making
    // the user re-find three rows among two hundred is the problem bulk actions
    // exist to solve.
    const result = pruneResolved(new Set(['a', 'b', 'c']), ['a', 'c']);
    expect([...result]).toEqual(['b']);
  });

  it('ignores ids that were not selected', () => {
    const result = pruneResolved(new Set(['a']), ['zzz']);
    expect([...result]).toEqual(['a']);
  });
});
