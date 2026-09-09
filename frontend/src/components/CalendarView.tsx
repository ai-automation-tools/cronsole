import { useMemo, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Info, Loader2 } from 'lucide-react';
import type { Task } from '../types';
import { useSettings } from '../hooks/useSettings';
import { useOccurrences } from '../hooks/useOccurrences';
import { useMinuteClock } from '../hooks/useMinuteClock';
import { platformAccent, platformLabel } from '../platform';
import { dayKeyIn, resolveZone, zoneLabel } from '../utils/timezone';
import { HelpButton } from './HelpButton';
import {
  buildMonthGrid,
  buildWeekGrid,
  bucketByDay,
  dayKey,
  groupByTask,
  monthLabel,
  rangeFor,
  stepDayKey,
  stepMonth,
  weekLabel,
  WEEKDAY_LABELS,
  type CalendarDay,
  type DayEntry
} from '../utils/calendar';

/**
 * The calendar view — which of your tasks run on which day.
 *
 * The other four views answer "what do I have"; this one answers "what happens
 * next Tuesday", which none of them could. The Schedule timeline came closest
 * and still could not: it orders tasks by `nextRunTime`, one instant each, so a
 * task that runs every weekday appears exactly once and the shape of a week is
 * invisible.
 *
 * **It draws the same `tasks` every other view draws.** Every filter, the source
 * rail, the system lens and the search box all still apply — a calendar is a
 * layout, not a second question. The occurrence expansion comes from the server
 * (`useOccurrences`) and is joined to those tasks here, so a task the filters
 * excluded is simply not on the grid.
 *
 * **Two honesty rules, both inherited from the rest of the dashboard.**
 *
 * A task that *cannot* be placed is named, not dropped. A Windows task triggered
 * at logon has no cron and never will, and leaving it silently off a calendar is
 * indistinguishable from it having been deleted. The count sits under the grid
 * with the reasons behind it.
 *
 * And the cap is stated. A task firing every five minutes has thousands of runs
 * in a six-week grid; the server enumerates the first `maxPerTask` and says
 * where it stopped, so this prints a line rather than rendering a month whose
 * second half looks empty — which would read as "it stops running", the most
 * expensive wrong thing a calendar can say.
 */

interface CalendarViewProps {
  /** The filtered list every other view renders — same slice, different layout. */
  tasks: Task[];
  /** Whether the current lens includes the tasks Windows owns. */
  includeSystem: boolean;
  onTaskSelect: (task: Task) => void;
}

/** Lines a month cell can hold before it starts saying "+N more". */
const MAX_CHIPS_PER_CELL = 3;

type Mode = 'month' | 'week';

export const CalendarView = ({ tasks, includeSystem, onTaskSelect }: CalendarViewProps) => {
  const { settings } = useSettings();
  const zone = resolveZone(settings.timezone);
  // One instant for the whole render, advancing once a minute — the same clock
  // the filters use, so "today" cannot mean two different days on one screen.
  const now = useMinuteClock();
  const todayKey = dayKeyIn(zone, now);

  const [mode, setMode] = useState<Mode>('month');
  // The grid's anchor is a *civil* date, held as the same two shapes the two
  // modes step in: a month steps by months, a week steps by days. Initialized
  // from today as the reader's zone sees it, so opening the calendar in Tokyo on
  // the 1st does not land on the 31st.
  const [anchor, setAnchor] = useState(() => todayKey);

  const grid = useMemo<CalendarDay[]>(() => {
    if (mode === 'week') return buildWeekGrid(anchor);
    const [year, month] = anchor.split('-').map(Number);
    return buildMonthGrid(year, month - 1);
  }, [mode, anchor]);

  const range = useMemo(() => rangeFor(grid), [grid]);
  const { data, isPending, error } = useOccurrences(range, { enabled: true, includeSystem });

  // Only the tasks on screen. The response covers everything the lens allows,
  // because it is keyed on the range rather than on the filters — joining here
  // is what lets narrowing to a collection cost no round trip.
  const byId = useMemo(() => new Map(tasks.map(t => [t.id, t])), [tasks]);

  const buckets = useMemo(() => {
    const visible = (data?.tasks ?? []).filter(t => byId.has(t.taskId));
    return bucketByDay(visible, settings.timezone);
  }, [data, byId, settings.timezone]);

  /** Tasks on screen that could never be placed, with the reason. */
  const unplaceable = useMemo(
    () => (data?.unplaceable ?? []).filter(u => byId.has(u.taskId)),
    [data, byId]
  );

  /** Tasks on screen whose run list the cap cut short. */
  const truncated = useMemo(
    () => (data?.tasks ?? []).filter(t => t.truncatedAfter && byId.has(t.taskId)),
    [data, byId]
  );

  const step = (by: number) => {
    if (mode === 'week') {
      setAnchor(stepDayKey(anchor, by * 7));
      return;
    }
    const [year, month] = anchor.split('-').map(Number);
    const next = stepMonth(year, month - 1, by);
    setAnchor(dayKey(next.year, next.month, 1));
  };

  const heading = mode === 'week'
    ? weekLabel(grid)
    : monthLabel(Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7)) - 1);

  const modeButton = (value: Mode, label: string) => (
    <button
      onClick={() => setMode(value)}
      aria-pressed={mode === value}
      className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
        mode === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-3 pb-20">
      {/* Header: what you are looking at, and the two ways to move through it. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => step(-1)}
            aria-label={mode === 'week' ? 'Previous week' : 'Previous month'}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
          >
            <ChevronLeft size={16} />
          </button>
          <h3 className="font-bold text-base text-foreground min-w-[11rem] text-center tabular-nums">
            {heading}
          </h3>
          <button
            onClick={() => step(1)}
            aria-label={mode === 'week' ? 'Next week' : 'Next month'}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
          >
            <ChevronRight size={16} />
          </button>
          <button
            onClick={() => setAnchor(mode === 'week' ? todayKey : `${todayKey.slice(0, 7)}-01`)}
            className="ml-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-surface border border-border text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors"
          >
            Today
          </button>
          {/*
            The zone is stated on the grid rather than assumed. Every cell is a
            day in the *schedule* timezone, which is not necessarily the one on
            the reader's taskbar — an unlabelled calendar in another zone is the
            same unmarked clock reading `formatDateTime` refuses to print.
          */}
          <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-subtle-foreground">
            {zoneLabel(settings.timezone, now)}
          </span>
          <HelpButton topic="calendar" />
        </div>

        <div className="flex bg-surface border border-border p-1 rounded-xl items-center shadow-md">
          {modeButton('month', 'Month')}
          {modeButton('week', 'Week')}
        </div>
      </div>

      {isPending && (
        <div className="flex items-center gap-2 text-xs font-medium text-warning-text bg-warning/10 border border-warning/30 rounded-xl px-3 py-2">
          <Loader2 size={13} className="animate-spin" />
          Working out when each task fires — the grid below is empty until this lands, which is not the same as nothing being scheduled.
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 text-xs font-medium text-danger-text bg-danger/10 border border-danger/30 rounded-xl px-3 py-2">
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
          Could not work out when these tasks fire, so this grid is empty for a reason that has nothing to do with your schedules.
        </div>
      )}

      {/* Weekday header row — shared by both modes, so a week reads like a slice
          of the month rather than like a different component. */}
      <div className="grid grid-cols-7 gap-px">
        {WEEKDAY_LABELS.map(label => (
          <div
            key={label}
            className="text-[10px] font-black uppercase tracking-wider text-subtle-foreground text-center py-1"
          >
            {label}
          </div>
        ))}
      </div>

      <div
        data-testid="calendar-grid"
        className="grid grid-cols-7 gap-px bg-border border border-border rounded-2xl overflow-hidden"
      >
        {grid.map(cell => (
          <DayCell
            key={cell.key}
            cell={cell}
            mode={mode}
            isToday={cell.key === todayKey}
            entries={groupByTask(buckets.get(cell.key) ?? [])}
            byId={byId}
            timezone={settings.timezone}
            onTaskSelect={onTaskSelect}
          />
        ))}
      </div>

      {/*
        What the grid above is NOT showing, and why. Both notices are the same
        rule the dashboard applies everywhere: a lens that withholds silently has
        to print a number, because "nothing here" and "not listed here" render
        identically and only one of them is true.
      */}
      {truncated.length > 0 && (
        <div className="flex items-start gap-2 text-xs text-warning-text bg-warning/10 border border-warning/30 rounded-xl px-3 py-2">
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
          <span>
            <strong className="tabular-nums">{truncated.length}</strong>{' '}
            {truncated.length === 1 ? 'task runs' : 'tasks run'} too often to list every run across this
            range, so the later part of the grid is incomplete for{' '}
            {truncated.length === 1 ? 'it' : 'them'}. Switch to <strong>Week</strong> for a complete picture.
          </span>
        </div>
      )}

      {unplaceable.length > 0 && (
        <details className="text-xs bg-surface/50 border border-border rounded-xl px-3 py-2">
          <summary className="cursor-pointer text-muted-foreground font-semibold flex items-center gap-1.5">
            <Info size={13} className="text-subtle-foreground" />
            <span className="tabular-nums">{unplaceable.length}</span>{' '}
            {unplaceable.length === 1 ? 'task has' : 'tasks have'} no place on a calendar
          </summary>
          <ul className="mt-2 space-y-1.5 pl-5">
            {unplaceable.map(u => {
              const task = byId.get(u.taskId)!;
              return (
                <li key={u.taskId}>
                  <button
                    onClick={() => onTaskSelect(task)}
                    className="font-bold text-foreground hover:text-primary-text transition-colors text-left"
                  >
                    {task.name}
                  </button>
                  <span className="text-subtle-foreground"> — {u.reason}</span>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </div>
  );
};

const DayCell = ({
  cell,
  mode,
  isToday,
  entries,
  byId,
  timezone,
  onTaskSelect
}: {
  cell: CalendarDay;
  mode: Mode;
  isToday: boolean;
  entries: DayEntry[];
  byId: Map<string, Task>;
  timezone: ReturnType<typeof useSettings>['settings']['timezone'];
  onTaskSelect: (task: Task) => void;
}) => {
  const [expanded, setExpanded] = useState(false);
  // A week has seven cells to fill the same width, so it can afford every run;
  // a month cell is a seventh of the width and a sixth of the height.
  const limit = mode === 'week' ? entries.length : MAX_CHIPS_PER_CELL;
  const shown = expanded ? entries : entries.slice(0, limit);
  const hidden = entries.length - shown.length;

  return (
    <div
      className={`bg-surface min-h-[6.5rem] ${mode === 'week' ? 'sm:min-h-[18rem]' : ''} p-1.5 flex flex-col gap-1 ${
        cell.inFocus ? '' : 'opacity-45'
      }`}
    >
      <div className="flex items-center justify-between">
        <span
          className={`text-[11px] font-bold tabular-nums w-5 h-5 flex items-center justify-center rounded-md ${
            isToday ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
          }`}
        >
          {cell.day}
        </span>
        {entries.length > 0 && (
          <span className="text-[9px] font-bold tabular-nums text-subtle-foreground pr-0.5">
            {entries.reduce((n, e) => n + e.count, 0)}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-0.5 min-w-0">
        {shown.map(entry => {
          const task = byId.get(entry.taskId)!;
          const accent = platformAccent(task.platform);
          return (
            <button
              key={entry.taskId}
              onClick={() => onTaskSelect(task)}
              title={`${task.name} — ${platformLabel(task.platform)} · ${entry.times
                .slice(0, 8)
                .map(t => clock(t, timezone))
                .join(', ')}${entry.times.length > 8 ? ` and ${entry.times.length - 8} more` : ''}`}
              className={`${accent.tile} w-full text-left px-1.5 py-0.5 rounded-md text-[10px] font-semibold truncate hover:brightness-125 transition-all active:scale-[0.98]`}
            >
              <span className="tabular-nums opacity-70">{clock(entry.first, timezone)}</span>{' '}
              {task.name}
              {/* A task that runs six times today is one thing that happened six
                  times, not six rows. The count keeps that readable without
                  spending six lines of a cell that has three. */}
              {entry.count > 1 && <span className="opacity-70"> ×{entry.count}</span>}
            </button>
          );
        })}

        {hidden > 0 && (
          <button
            onClick={() => setExpanded(true)}
            className="text-[10px] font-bold text-subtle-foreground hover:text-foreground text-left px-1.5 transition-colors"
          >
            +{hidden} more
          </button>
        )}
      </div>
    </div>
  );
};

/** `09:30` in the schedule zone — the densest honest form for a chip. */
function clock(at: Date, timezone: ReturnType<typeof useSettings>['settings']['timezone']): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: resolveZone(timezone),
      hour: '2-digit',
      minute: '2-digit'
    }).format(at);
  } catch {
    return at.toISOString().slice(11, 16);
  }
}

export default CalendarView;
