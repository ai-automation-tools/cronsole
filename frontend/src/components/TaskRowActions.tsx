import { CopyPlus, Loader2, Play, Power } from 'lucide-react';
import type { Task } from '../types';
import { isRunnable, runButtonTitle, canToggleStatus, toggleStatusTitle } from '../utils/taskActions';

/**
 * The clone / enable-disable / run cluster every task row carries.
 *
 * It was written out five times — the grid card, the list row, both kanban
 * columns, and the schedule row — at four icon sizes and three background
 * shades that nobody chose. That duplication is not just untidy: it is the
 * reason adding one affordance to "every task" is a five-file change, which is
 * exactly what made bulk selection look expensive.
 *
 * Every caller sits inside a container whose own `onClick` opens the task
 * modal, so the wrapper stops propagation here rather than leaving each of five
 * call sites to remember.
 */

export type TaskActionSize = 'xs' | 'sm' | 'md' | 'lg';

/**
 * Full class strings, never interpolated fragments — Tailwind's compiler only
 * sees literals, and a built-up class name silently produces an unstyled button.
 */
const SIZES: Record<TaskActionSize, { icon: number; button: string; gap: string }> = {
  xs: { icon: 12, button: 'p-1.5 rounded', gap: 'gap-1.5' },
  sm: { icon: 14, button: 'p-2 rounded', gap: 'gap-1.5' },
  md: { icon: 16, button: 'p-2 rounded-lg', gap: 'gap-2' },
  lg: { icon: 18, button: 'p-2 rounded-lg', gap: 'gap-2' }
};

const NEUTRAL =
  'bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground border border-border transition-all active:scale-90 disabled:opacity-50 disabled:cursor-not-allowed';

const RUN =
  'bg-success hover:bg-success-hover text-success-foreground shadow-lg shadow-success/20 transition-all active:scale-90 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 disabled:shadow-none';

interface TaskRowActionsProps {
  task: Task;
  size?: TaskActionSize;
  onRun: (task: Task) => void;
  onClone: (task: Task) => void;
  onToggleStatus: (task: Task) => void;
  isTogglingStatus?: boolean;
}

export const TaskRowActions = ({
  task,
  size = 'md',
  onRun,
  onClone,
  onToggleStatus,
  isTogglingStatus
}: TaskRowActionsProps) => {
  const { icon, button, gap } = SIZES[size];

  return (
    <div className={`flex ${gap}`} onClick={e => e.stopPropagation()}>
      <button
        onClick={() => onClone(task)}
        className={`${button} ${NEUTRAL}`}
        title="Clone Task"
        aria-label={`Clone ${task.name}`}
      >
        <CopyPlus size={icon} />
      </button>

      {/* A MISSING task has nothing to toggle — the button is absent rather than
          present-and-broken, matching the detail modal (utils/taskActions). */}
      {canToggleStatus(task) && (
        <button
          onClick={() => onToggleStatus(task)}
          disabled={isTogglingStatus}
          className={`${button} ${NEUTRAL}`}
          title={toggleStatusTitle(task)}
          aria-label={`${toggleStatusTitle(task)}: ${task.name}`}
        >
          {isTogglingStatus ? (
            <Loader2 size={icon} className="animate-spin" />
          ) : (
            <Power size={icon} className={task.status === 'ACTIVE' ? 'text-green-400' : ''} />
          )}
        </button>
      )}

      {/* Run stays visible-but-disabled rather than hidden: the tooltip is the
          only thing that explains WHY a disabled task can't be run. */}
      <button
        onClick={() => isRunnable(task) && onRun(task)}
        disabled={!isRunnable(task)}
        className={`${button} ${RUN}`}
        title={runButtonTitle(task)}
        aria-label={`Run ${task.name}`}
      >
        <Play size={icon} fill="currentColor" />
      </button>
    </div>
  );
};

export default TaskRowActions;
