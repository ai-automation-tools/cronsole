import { memo, useState } from 'react';
import type { CSSProperties } from 'react';
import { ChevronRight, XOctagon } from 'lucide-react';
import type { Task } from '../types';
import { platformLabel, sourceIcon, sourceAccentGlyph } from '../platform';
import { nextRunOf } from '../utils/taskFilters';
import { formatTime, nextRunText } from '../utils/datetime';
import { useSettings } from '../hooks/useSettings';
import { TaskRowActions } from './TaskRowActions';
import { TaskSchedule } from './TaskSchedule';
import { RunStrip } from './RunStrip';
import { TaskFavoriteStar } from './TaskFavoriteStar';
import { TaskCollectionMenu } from './TaskCollectionMenu';
import { useSpotlight } from '../hooks/useSpotlight';

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
  /**
   * Position in the list, for the staggered rise-in (`.rise` in index.css).
   * Capped at 12 steps so a long list settles in half a second rather than
   * animating for as long as it has rows. Optional: a card rendered on its
   * own rises at once.
   */
  index?: number;
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
  index = 0,
}: TaskCardProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [tempCat, setTempCat] = useState(task.category || 'Uncategorized');
  const onPointerMove = useSpotlight();
  const { settings } = useSettings();

  const next = nextRunOf(task);
  const SourceIcon = sourceIcon(task.source ?? task.platform);
  const statusWord = task.status.charAt(0) + task.status.slice(1).toLowerCase();
  const statusTone =
    task.status === 'ACTIVE' ? 'text-success-text'
    : task.status === 'MISSING' ? 'text-warning-text'
    : 'text-muted-foreground';

  return (
    /*
      A spotlight surface (`.spot`): the hover state is a ring of the brand
      colour that follows the pointer, drawn by index.css from `--mx`/`--my`.
      The layout reads top to bottom as *where · what · when · state · act*:
      source and folder as a breadcrumb, the name, the schedule, the next run
      beside the status word, then the actions under a rule.
    */
    <div
      className="spot rise flex flex-col bg-surface border border-border rounded-xl p-4 focus-within:border-primary/50 cursor-pointer transition-[transform,box-shadow,border-color] duration-300 group hover:-translate-y-0.5 hover:shadow-xl active:scale-[0.99]"
      style={{ '--i': Math.min(index, 12) } as CSSProperties}
      onPointerMove={onPointerMove}
      onClick={() => !isEditing && onSelect(task)}
    >
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-xs">
          <SourceIcon size={14} aria-hidden className={`shrink-0 ${sourceAccentGlyph(task.source ?? task.platform)}`} />
          <span className="shrink-0 font-semibold text-foreground">{platformLabel(task.platform)}</span>
          <span aria-hidden className="text-subtle-foreground">/</span>
          {isEditing ? (
            <input
              autoFocus
              onClick={e => e.stopPropagation()}
              className="min-w-0 bg-background border border-border rounded px-1.5 py-0.5 text-xs text-foreground w-32 outline-none focus:border-primary"
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
          ) : (
            <button
              type="button"
              aria-label={`Edit category of ${task.name}`}
              title="Edit category"
              className="min-w-0 truncate text-muted-foreground hover:text-foreground transition-colors"
              onClick={e => { e.stopPropagation(); setIsEditing(true); }}
            >
              {task.category || 'Uncategorized'}
            </button>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onToggleFavorite && (
            <TaskFavoriteStar task={task} onToggle={onToggleFavorite} size={15} />
          )}
          {/*
            Beside the star on every task surface: both are Cronsole-side labels
            on a task that touch no platform, and collections are a rail
            dimension you can navigate to.
          */}
          <TaskCollectionMenu task={task} size={15} />
        </div>
      </div>

      {/*
        The card is a clickable <div>, which is unreachable by keyboard and has no
        accessible name, so the title is the real control: a button whose name is
        the task's. It can't be the card itself — TaskRowActions' buttons are
        inside it, and a button may not nest inside a button.
      */}
      <h3 className="mt-3 font-bold text-base leading-snug truncate">
        <button
          type="button"
          aria-label={`Open details for ${task.name}`}
          title={task.externalId === task.name ? task.name : `${task.name} — ${task.externalId}`}
          onClick={e => { e.stopPropagation(); onSelect(task); }}
          className="block w-full text-left truncate rounded outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {task.name}
        </button>
      </h3>
      <TaskSchedule task={task} className="mt-1" />

      <div className="mt-4 flex items-center gap-2.5 min-w-0">
        <RunStrip task={task} />
        <span
          className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
          title={next ? `Next run ${next.toLocaleString()}` : 'The platform reports no upcoming run'}
        >
          {next ? nextRunText(next, settings.timezone) : 'No upcoming run'}
        </span>
        {task.lastRunStatus === 'FAILURE' && (
          <span
            className="flex shrink-0 items-center gap-1 rounded-md border border-danger/30 bg-danger/10 px-1.5 py-0.5 text-[10px] font-bold text-danger-text"
            title={task.lastRunAt ? `Failed ${new Date(task.lastRunAt).toLocaleString()}` : 'Last run failed'}
          >
            <XOctagon size={10} /> Run failed
          </span>
        )}
        <span className={`shrink-0 text-xs font-semibold ${statusTone}`}>{statusWord}</span>
      </div>

      <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-3">
        <div className="min-w-0 truncate text-[11px] text-subtle-foreground">
          {/*
            Names the card as a control on hover/focus. aria-hidden because the
            title button already carries the semantics.
          */}
          <span
            aria-hidden="true"
            className="hidden group-hover:inline-flex group-focus-within:inline-flex items-center gap-0.5 font-bold text-primary"
          >
            Open details <ChevronRight size={10} />
          </span>
          <span className="group-hover:hidden group-focus-within:hidden">
            {/* A run Cronsole recorded when there is one; otherwise the row's
                last change, labelled as that — never passed off as a run. */}
            {task.lastRunAt
              ? <>Last run: {formatTime(task.lastRunAt, settings.timezone)}</>
              : <>Updated: {formatTime(task.updatedAt, settings.timezone)}</>}
          </span>
        </div>
        <TaskRowActions
          task={task}
          size="sm"
          runLabel
          onRun={onRun}
          onClone={onClone}
          onToggleStatus={onToggleStatus}
          isTogglingStatus={isTogglingStatus}
        />
      </div>
    </div>
  );
});
