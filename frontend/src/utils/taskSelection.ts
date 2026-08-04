import type { Task } from '../types';

/**
 * Bulk-selection logic, kept out of the view.
 *
 * The dashboard renders four views from one `filteredTasks` array, so selection
 * needs no per-view concept — but the rules about what happens when the array
 * *changes underneath a selection* are not obvious, and they are exactly the
 * kind of thing that is easy to get subtly wrong and impossible to notice.
 * They live here as pure functions so they can be tested without rendering the
 * dashboard, its query client, and its four view modes.
 */

/**
 * Add or remove one task, with shift-click extending from an anchor.
 *
 * `ordered` must be the list **in the order the user is looking at** — the
 * schedule view sorts by next run, so a range selected there is a different set
 * of tasks than the same two endpoints in grid order. Passing the wrong list
 * silently selects the wrong rows, which is why this takes it explicitly rather
 * than reaching for a canonical order.
 *
 * A shift-range takes its direction from the *clicked* task: if that task is
 * about to be selected, the whole range is selected; if it is about to be
 * cleared, the whole range is cleared. That matches every file manager.
 */
export function toggleTaskSelection(
  current: ReadonlySet<string>,
  ordered: readonly Task[],
  taskId: string,
  options: { shiftKey?: boolean; anchorId?: string | null } = {}
): Set<string> {
  const next = new Set(current);
  const { shiftKey, anchorId } = options;

  if (shiftKey && anchorId && anchorId !== taskId) {
    const from = ordered.findIndex(t => t.id === anchorId);
    const to = ordered.findIndex(t => t.id === taskId);
    // A missing endpoint means the anchor scrolled out of the filtered set;
    // fall through to a plain toggle rather than guessing at a range.
    if (from !== -1 && to !== -1) {
      const [lo, hi] = from < to ? [from, to] : [to, from];
      const selecting = !next.has(taskId);
      for (let i = lo; i <= hi; i++) {
        if (selecting) next.add(ordered[i].id);
        else next.delete(ordered[i].id);
      }
      return next;
    }
  }

  if (next.has(taskId)) next.delete(taskId);
  else next.add(taskId);
  return next;
}

/** Select every visible task, or clear them all if they are already selected. */
export function toggleSelectAll(
  current: ReadonlySet<string>,
  visible: readonly Task[]
): Set<string> {
  const next = new Set(current);
  const allSelected = visible.length > 0 && visible.every(t => next.has(t.id));
  for (const task of visible) {
    if (allSelected) next.delete(task.id);
    else next.add(task.id);
  }
  return next;
}

export interface SelectionSummary {
  /** Everything selected, drawn from the full task list rather than the view. */
  tasks: Task[];
  /** How many selected tasks the current view is not showing. */
  offscreenCount: number;
  enabledCount: number;
  disabledCount: number;
  /**
   * How many can be untracked — i.e. exist on a platform outside Cronsole. A
   * Cronsole-native task's row *is* the task, so "remove it from Cronsole but
   * keep it running" is not a thing that can be true, and the server refuses it
   * per item. Counted here so the button can say what it will really do rather
   * than promising 12 and delivering 9.
   */
  untrackableCount: number;
  /**
   * How many can be exported as Task Scheduler XML. Only Windows tasks have
   * any; a native task exports as JSON, one at a time.
   */
  exportableCount: number;
}

/**
 * Describe a selection against both the full task list and what is on screen.
 *
 * The `offscreenCount` is the whole reason this is a function rather than a
 * `.size`. `filteredTasks` branches on view mode — kanban deliberately shows the
 * disabled tasks the other three hide — so switching views can leave part of a
 * selection invisible. **The selection is not pruned**: it is the user's, it is
 * keyed by id so it survives, and silently dropping members would be the same
 * omission as a filter that hides rows without saying so. The count is surfaced
 * so the UI can state the gap instead.
 */
export function summarizeSelection(
  selectedIds: ReadonlySet<string>,
  allTasks: readonly Task[],
  visibleTasks: readonly Task[]
): SelectionSummary {
  const tasks = allTasks.filter(t => selectedIds.has(t.id));
  const visibleSelected = visibleTasks.filter(t => selectedIds.has(t.id)).length;
  return {
    tasks,
    // Counted against the selection, not against `tasks` — an id that no longer
    // matches any task at all (deleted elsewhere, or pruned by the system lens)
    // is genuinely not visible, and rounding it away would understate the gap.
    offscreenCount: selectedIds.size - visibleSelected,
    enabledCount: tasks.filter(t => t.status === 'ACTIVE').length,
    disabledCount: tasks.filter(t => t.status === 'DISABLED').length,
    // Both counted from `tasks` — what is actually selected — not from the
    // visible list. The action runs on the whole selection, so a button labelled
    // from what happens to be on screen would promise the wrong number in
    // exactly the case the bar already warns about.
    untrackableCount: tasks.filter(t => t.platform !== 'TASKHUB_NATIVE').length,
    exportableCount: tasks.filter(t => t.platform === 'WINDOWS_TASK_SCHEDULER').length
  };
}

/**
 * Remove the ids a bulk action resolved, keeping the rest selected.
 *
 * Only successes and no-ops are dropped. A task that failed or was refused stays
 * selected on purpose: the user's next move is a retry, and making them re-find
 * the three rows that didn't work among two hundred is the same scaling problem
 * bulk actions exist to solve.
 */
export function pruneResolved(
  current: ReadonlySet<string>,
  resolvedIds: readonly string[]
): Set<string> {
  const next = new Set(current);
  for (const id of resolvedIds) next.delete(id);
  return next;
}
