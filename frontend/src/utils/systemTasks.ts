import type { Task } from '../types';
import { matchesSystem, type SystemFilter } from './taskFilters';

/**
 * The system/personal lens.
 *
 * On a real machine `\Microsoft\…` tasks are the overwhelming majority — 257 of
 * 352 on the box this was built against — so once they are imported, every
 * headline number, category chip and view mode is dominated by rows the user
 * will never act on, and the tasks that matter become a rounding error in their
 * own dashboard. Import excludes them by default, but that guard fires exactly
 * once; afterwards nothing distinguishes an OS-owned task from one the user
 * wrote.
 *
 * Two rules live here because both have to hold together, and each is the kind
 * of thing that quietly stops holding when it is spread across a big component:
 *
 *  1. The filter is the **outermost** lens — everything downstream (facets,
 *     counts, search, every view) reads its output, so a hidden task is hidden
 *     consistently rather than in the places someone remembered.
 *  2. The hidden count is taken over **all** tasks, not the filtered set. It
 *     answers "is anything being kept from me right now?", which is precisely
 *     the question the filtered list cannot answer about itself.
 *
 * `isSystem` is the server's verdict (TaskService.isSystemTask), never a rule
 * re-derived here — a second definition of "is this `\Microsoft\`?" is the shape
 * that let a renamed category silently stop syncing (troubleshooting #20a).
 */
export function applySystemLens(
  tasks: Task[] | undefined,
  /**
   * The boolean form is the original two-state toggle and still works, so every
   * caller and test written against it keeps its meaning. Saved views needed a
   * third state — `'only'`, "what is Windows itself running?" — which the
   * include-everything state answers by burying it among the user's own tasks.
   */
  lens: SystemFilter | boolean
): { visible: Task[] | undefined; hidden: number } {
  const mode: SystemFilter =
    typeof lens === 'boolean' ? (lens ? 'include' : 'personal') : lens;

  // `undefined` means "not loaded yet" and must stay distinguishable from "no
  // tasks" — collapsing the two would flash an empty-state over a live fetch.
  if (!tasks) return { visible: tasks, hidden: 0 };

  const hidden = tasks.filter(t => t.isSystem).length;
  return {
    visible: tasks.filter(t => matchesSystem(t, mode)),
    // Reported even while showing system tasks: the toggle needs a number in
    // both directions, or its "on" state is a label with nothing behind it.
    // It counts system tasks that EXIST, not ones this lens happens to hide —
    // under `'only'` nothing is hidden by the lens, but the number the toggle
    // has to print is still "how many of these are there".
    hidden
  };
}
