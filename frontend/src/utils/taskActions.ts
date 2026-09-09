import type { Task } from '../types';

// Shared logic for the per-task action buttons (Run / enable-disable) so every
// surface — grid card, list row, kanban, schedule, and the detail modal — agrees
// on when a task can run and what the grayed-out button should explain.

/**
 * Only an ACTIVE task can be run. A DISABLED task would be refused by the
 * platform (Windows throws "The task is disabled"), and a MISSING one isn't on
 * the platform at all — so the Run button is grayed out in both cases rather
 * than firing a click that can only fail. Uniform across platforms: native and
 * Windows tasks both carry ACTIVE/DISABLED/MISSING.
 */
export const isRunnable = (task: Task): boolean => task.status === 'ACTIVE';

/** Tooltip/aria label for the Run button — names why it's disabled when it is. */
export const runButtonTitle = (task: Task): string =>
  task.status === 'ACTIVE'
    ? 'Run Task'
    : task.status === 'MISSING'
      ? "This task isn't on the platform — nothing to run"
      : 'This task is disabled — enable it first to run it';

/** Whether the enable/disable toggle applies. A MISSING task has nothing to
 *  toggle (re-sync or delete it instead), matching the detail modal. */
export const canToggleStatus = (task: Task): boolean => task.status !== 'MISSING';

/** Tooltip/aria label for the enable/disable toggle. */
export const toggleStatusTitle = (task: Task): string =>
  task.status === 'ACTIVE' ? 'Disable task' : 'Enable task';
