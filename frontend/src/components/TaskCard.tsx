import { memo, useState } from 'react';
import { ChevronRight, Folder, Plus, XOctagon } from 'lucide-react';
import type { Task } from '../types';
import { platformLabel, platformBadgeClass } from '../platform';
import { TaskRowActions } from './TaskRowActions';
import { TaskSchedule } from './TaskSchedule';
import { TaskFavoriteStar } from './TaskFavoriteStar';

interface TaskCardProps {
  task: Task;
  onSelect: (task: Task) => void;
  onRun: (task: Task) => void;
  onCategoryUpdate: (taskId: string, category: string) => void;
  onClone: (task: Task) => void;
  onToggleStatus: (task: Task) => void;
  /** Optional so the card stays renderable outside the dashboard's mutations. */
  onToggleFavorite?: (task: Task) => void;
  isTogglingStatus?: boolean;
}

/**
 * Memoised because the dashboard renders one of these per task and re-renders
 * the whole list on every keystroke in the search box. Measured before this:
 * tearing down 255 cards took ~63ms, i.e. a few dropped frames per character.
 *
 * The default shallow compare is enough *because the handlers above are stable*
 * — they come from the dashboard's mutations, not from inline closures rebuilt
 * each render. If that ever stops being true this memo silently becomes a
 * no-op rather than breaking, which is the failure mode to watch for.
 */
export const TaskCard = memo(({
  task,
  onSelect,
  onRun,
  onCategoryUpdate,
  onClone,
  onToggleStatus,
  onToggleFavorite,
  isTogglingStatus,
}: TaskCardProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [tempCat, setTempCat] = useState(task.category || 'Uncategorized');

  return (
    <div
      className="bg-surface border border-border rounded-2xl p-5 hover:border-primary/50 focus-within:border-primary/50 cursor-pointer transition-all shadow-xl group hover:-translate-y-1 active:scale-[0.98]"
      onClick={() => !isEditing && onSelect(task)}
    >
      <div className="flex justify-between items-start mb-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className={`text-[10px] w-fit uppercase font-black px-2.5 py-1 rounded-lg border ${platformBadgeClass(task.platform)}`}>
              {platformLabel(task.platform)}
            </span>
          </div>

          {isEditing ? (
            <div className="flex items-center gap-1 mt-1" onClick={e => e.stopPropagation()}>
              <input 
                autoFocus
                className="bg-background border border-border rounded px-1.5 py-0.5 text-[10px] text-foreground w-24 outline-none focus:border-primary"
                value={tempCat}
                onChange={e => setTempCat(e.target.value)}
                onBlur={() => setIsEditing(false)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    onCategoryUpdate(task.id, tempCat);
                    setIsEditing(false);
                  }
                  if (e.key === 'Escape') setIsEditing(false);
                }}
              />
            </div>
          ) : (
            <button
              type="button"
              aria-label={`Edit category of ${task.name}`}
              title="Edit category"
              className="flex items-center gap-1.5 text-[10px] font-bold text-subtle-foreground ml-1 hover:text-foreground transition-colors"
              onClick={e => { e.stopPropagation(); setIsEditing(true); }}
            >
              <Folder size={10} /> {task.category || 'Uncategorized'}
              <Plus size={8} className="opacity-0 group-hover:opacity-100" />
            </button>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-2">
            {onToggleFavorite && (
              <TaskFavoriteStar task={task} onToggle={onToggleFavorite} size={16} />
            )}
            <div className="flex items-center gap-1.5 bg-background px-2 py-1 rounded-lg border border-border">
              <div className={`h-2 w-2 rounded-full ${task.status === 'ACTIVE' ? 'bg-success' : 'bg-muted'}`}></div>
              <span className="text-[10px] font-bold text-muted-foreground">{task.status}</span>
            </div>
          </div>
          {task.lastRunStatus === 'FAILURE' && (
            <div className="flex items-center gap-1 bg-danger/10 px-2 py-1 rounded-lg border border-danger/30" title={task.lastRunAt ? `Failed ${new Date(task.lastRunAt).toLocaleString()}` : 'Last run failed'}>
              <XOctagon size={10} className="text-danger-text" />
              <span className="text-[9px] font-black text-danger-text uppercase">Run failed</span>
            </div>
          )}
        </div>
      </div>
      {/*
        The card is a clickable <div>, which is unreachable by keyboard and has no
        accessible name. Rather than redesign the card, the title becomes the real
        control: a button whose name is the task's, so the card's default action is
        tab-reachable and announced. It can't be the card itself — TaskRowActions'
        buttons are inside it, and a button may not nest inside a button.
      */}
      <h3 className="font-bold text-lg mb-1 truncate">
        <button
          type="button"
          aria-label={`Open details for ${task.name}`}
          onClick={e => { e.stopPropagation(); onSelect(task); }}
          className="block w-full text-left truncate rounded outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {task.name}
        </button>
      </h3>
      <p className="text-xs text-subtle-foreground mb-3 italic truncate">{task.externalId}</p>
      <TaskSchedule task={task} className="mb-5" />
      <div className="flex items-center justify-between border-t border-border pt-4">
        <div className="text-[10px] text-muted-foreground min-w-0 truncate">
          {/*
            The card row carries five controls plus the card's own click target, and
            nothing said the card *was* one. This names it on hover/focus. It is
            aria-hidden because the title button above already carries the semantics —
            a second announced "Open details" would be one control described twice.
          */}
          <span
            aria-hidden="true"
            className="hidden group-hover:inline-flex group-focus-within:inline-flex items-center gap-0.5 font-bold text-primary"
          >
            Open details <ChevronRight size={10} />
          </span>
          <span className="group-hover:hidden group-focus-within:hidden">
            Last updated: <span className="text-foreground">{new Date(task.updatedAt).toLocaleTimeString()}</span>
          </span>
        </div>
        <TaskRowActions
          task={task}
          size="lg"
          onRun={onRun}
          onClone={onClone}
          onToggleStatus={onToggleStatus}
          isTogglingStatus={isTogglingStatus}
        />
      </div>
    </div>
  );
});
