import { dayKeyIn, resolveZone } from './timezone';
import type { TimezoneMode } from '../hooks/useSettings';

/**
 * The calendar view's arithmetic: which days are on screen, and which runs land
 * on each of them.
 *
 * Pure and Reactless so it can be pinned without rendering a month, and because
 * the two halves it holds are the only places this feature can go quietly wrong.
 *
 * **A grid is civil dates; an occurrence is an instant.** They are different
 * kinds of thing and the file keeps them apart. The grid is built from
 * `YYYY-MM-DD` strings with plain arithmetic and never touches a timezone — a
 * calendar month has the same shape everywhere. Placing a *run* on it is the one
 * zone-dependent step, and it goes through `dayKeyIn`, which is the same
 * definition `matchesDue` uses for "today". Two answers to "which day is this
 * instant on" is how a calendar comes to disagree with the *Due today* chip
 * above it.
 *
 * **The range asked of the server is padded, deliberately.** The grid's first
 * cell begins at local midnight, and converting that civil moment to an instant
 * needs an offset that is itself a function of the instant — circular at exactly
 * the two hours a year a DST transition happens. A day of padding on each side
 * costs one extra day of expansion and removes the entire class of problem,
 * because the *bucketing* is exact and simply ignores what falls outside.
 */

/** One cell of the grid. */
export interface CalendarDay {
  /** `YYYY-MM-DD`, and the key occurrences are bucketed under. */
  key: string;
  /** Day of the month, for the cell's label. */
  day: number;
  /** Month index (0-11) — a month grid's leading and trailing cells are not this month. */
  month: number;
  year: number;
  /** Is this cell in the month the grid is *about*? Always true for a week grid. */
  inFocus: boolean;
  /** 0 = Sunday. */
  weekday: number;
}

/** `YYYY-MM-DD` for a civil date. */
export function dayKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Parse a `YYYY-MM-DD` back into its three civil numbers. */
export function parseDayKey(key: string): { year: number; month: number; day: number } {
  const [y, m, d] = key.split('-').map(Number);
  return { year: y, month: m - 1, day: d };
}

function cellFrom(utcMidnight: number, focusMonth: number | null): CalendarDay {
  const d = new Date(utcMidnight);
  const month = d.getUTCMonth();
  return {
    key: dayKey(d.getUTCFullYear(), month, d.getUTCDate()),
    day: d.getUTCDate(),
    month,
    year: d.getUTCFullYear(),
    inFocus: focusMonth === null || month === focusMonth,
    weekday: d.getUTCDay()
  };
}

/**
 * The six-week grid a month is drawn on, Sunday-first — always 42 cells.
 *
 * Fixed at six weeks rather than "as many as this month needs", because a grid
 * that changes height between May and June makes every control below it jump on
 * a month step. The cells that spill either side are marked `inFocus: false` and
 * rendered dimmer; they are real days and their runs are real, so they are not
 * blanked.
 *
 * `UTC` arithmetic on a civil date, not local: `new Date(2026, 2, 1)` is an
 * instant in the machine's zone, and stepping it by 86,400,000ms lands on 23:00
 * the same day across a DST boundary. `Date.UTC` has no such transitions, which
 * is precisely why it is the right clock for something that is not a clock.
 */
export function buildMonthGrid(year: number, month: number): CalendarDay[] {
  const firstOfMonth = Date.UTC(year, month, 1);
  const lead = new Date(firstOfMonth).getUTCDay();
  const start = firstOfMonth - lead * 86_400_000;
  return Array.from({ length: 42 }, (_, i) => cellFrom(start + i * 86_400_000, month));
}

/** The seven days of the week containing `anchor` (a day key), Sunday-first. */
export function buildWeekGrid(anchor: string): CalendarDay[] {
  const { year, month, day } = parseDayKey(anchor);
  const at = Date.UTC(year, month, day);
  const start = at - new Date(at).getUTCDay() * 86_400_000;
  return Array.from({ length: 7 }, (_, i) => cellFrom(start + i * 86_400_000, null));
}

/** Step a month, wrapping the year. */
export function stepMonth(year: number, month: number, by: number): { year: number; month: number } {
  const d = new Date(Date.UTC(year, month + by, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
}

/** Step a day key by whole days. */
export function stepDayKey(key: string, byDays: number): string {
  const { year, month, day } = parseDayKey(key);
  const d = new Date(Date.UTC(year, month, day) + byDays * 86_400_000);
  return dayKey(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * The instants to ask the server for, to cover `grid` in **any** zone.
 *
 * Takes no timezone on purpose. Converting the grid's first local midnight to an
 * instant needs an offset that is a function of that instant — circular at
 * exactly the two hours a year a transition happens. Padding a day on each side
 * makes the range wide enough for every offset on earth (UTC−12 to UTC+14, so
 * the widest a civil day can slide is 14 hours) and the *bucketing* stays exact:
 * runs outside the grid match no cell key and fall away.
 *
 * The cost is one day of expansion at each end. The alternative is DST
 * arithmetic in a file whose whole job is to not do arithmetic about clocks.
 */
export function rangeFor(grid: CalendarDay[]): { from: Date; to: Date } {
  const first = parseDayKey(grid[0].key);
  const last = parseDayKey(grid[grid.length - 1].key);
  return {
    from: new Date(Date.UTC(first.year, first.month, first.day) - 86_400_000),
    to: new Date(Date.UTC(last.year, last.month, last.day) + 2 * 86_400_000)
  };
}

/** One run of one task, on one day. */
export interface DayRun {
  taskId: string;
  at: Date;
}

/**
 * Bucket run instants under the calendar day they fall on **in the reader's
 * zone**, ascending within each day.
 *
 * The one zone-dependent step in this file, and it goes through the same
 * `dayKeyIn` that answers "is this due today". Instants outside the grid — the
 * padding, mostly — simply do not match a cell key and fall away.
 */
export function bucketByDay(
  runs: { taskId: string; occurrences: string[] }[],
  tz: TimezoneMode
): Map<string, DayRun[]> {
  const zone = resolveZone(tz);
  const buckets = new Map<string, DayRun[]>();
  for (const run of runs) {
    for (const raw of run.occurrences) {
      const at = new Date(raw);
      if (Number.isNaN(at.getTime())) continue;
      const key = dayKeyIn(zone, at);
      const bucket = buckets.get(key);
      if (bucket) bucket.push({ taskId: run.taskId, at });
      else buckets.set(key, [{ taskId: run.taskId, at }]);
    }
  }
  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => a.at.getTime() - b.at.getTime());
  }
  return buckets;
}

/**
 * Group a day's runs by task, keeping the first time and the count.
 *
 * A month cell has room for a handful of lines, and a task that runs six times
 * on Tuesday is one thing that happened six times, not six things. Collapsing it
 * here rather than in the cell keeps the count honest when the cell decides how
 * many lines it can afford — see `MAX_CHIPS_PER_CELL` in `CalendarView`.
 */
export interface DayEntry {
  taskId: string;
  first: Date;
  count: number;
  times: Date[];
}

export function groupByTask(runs: DayRun[]): DayEntry[] {
  const byTask = new Map<string, DayEntry>();
  for (const run of runs) {
    const entry = byTask.get(run.taskId);
    if (entry) {
      entry.count++;
      entry.times.push(run.at);
    } else {
      byTask.set(run.taskId, { taskId: run.taskId, first: run.at, count: 1, times: [run.at] });
    }
  }
  return [...byTask.values()].sort((a, b) => a.first.getTime() - b.first.getTime());
}

/** Month name for a heading, in the reader's own locale. */
export function monthLabel(year: number, month: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(Date.UTC(year, month, 1)));
  } catch {
    return `${year}-${String(month + 1).padStart(2, '0')}`;
  }
}

/** `Mar 1 – Mar 7` for a week grid's heading. */
export function weekLabel(grid: CalendarDay[]): string {
  const fmt = (cell: CalendarDay) => {
    try {
      return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
        .format(new Date(Date.UTC(cell.year, cell.month, cell.day)));
    } catch {
      return cell.key;
    }
  };
  return `${fmt(grid[0])} – ${fmt(grid[grid.length - 1])}`;
}

/** Sunday-first weekday headers in the reader's locale. */
export const WEEKDAY_LABELS: string[] = Array.from({ length: 7 }, (_, i) => {
  try {
    // 2026-03-01 is a Sunday, so this walks Sun→Sat.
    return new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' })
      .format(new Date(Date.UTC(2026, 2, 1 + i)));
  } catch {
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][i];
  }
});
