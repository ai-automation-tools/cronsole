import type { Task } from '../types';

/**
 * The per-row selection checkbox for bulk actions.
 *
 * Every view renders task rows inside a container whose `onClick` opens the
 * detail modal, so this stops propagation itself rather than relying on five
 * call sites to remember — the same reasoning as `TaskRowActions`.
 *
 * A native `<input type="checkbox">` on purpose: it is keyboard-operable,
 * announced correctly, and participates in shift-click range selection for free.
 * A styled `<div role="checkbox">` would have to re-earn all of that.
 */
interface TaskSelectCheckboxProps {
  task: Task;
  checked: boolean;
  onToggle: (task: Task, event: React.MouseEvent) => void;
  className?: string;
}

export const TaskSelectCheckbox = ({
  task,
  checked,
  onToggle,
  className = ''
}: TaskSelectCheckboxProps) => (
  <input
    type="checkbox"
    checked={checked}
    // `onClick` rather than `onChange` because the range-select modifier is only
    // on the mouse event; onChange would lose shiftKey.
    onClick={e => {
      e.stopPropagation();
      onToggle(task, e);
    }}
    onChange={() => {
      /* controlled by onClick above; React requires a handler on a checked input */
    }}
    aria-label={`Select ${task.name}`}
    className={`h-4 w-4 shrink-0 cursor-pointer accent-primary rounded border-border bg-background ${className}`}
  />
);

export default TaskSelectCheckbox;
