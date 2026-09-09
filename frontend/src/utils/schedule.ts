import type { TimezoneMode } from '../hooks/useSettings';
import { resolveZone, utcCronToZone, zoneAbbrev } from './timezone';
import { ordinalDay } from './scheduleBuilder';

/**
 * Best-effort, honest human description of a 5-field cron expression
 * (`minute hour day-of-month month day-of-week`). Covers the common shapes
 * Cronsole generates and syncs; returns `null` for anything it can't describe
 * confidently so callers fall back to showing the raw expression rather than
 * guessing wrong.
 *
 * Schedules are stored in UTC (see CLAUDE.md §9). The expression is shifted into
 * the Settings zone first (`utils/timezone.ts`) and described from there, so the
 * weekday roll across midnight — Mon 02:00 UTC is Sunday evening in Pacific —
 * falls out of the shift instead of being re-derived here. Only the shapes with
 * an absolute clock time (Daily / Weekly) carry a zone marker; the interval
 * shapes read the same wherever you are, so labelling them would be noise.
 */
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function clock12h(hh: number, mm: number): string | null {
  if (!Number.isInteger(hh) || !Number.isInteger(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    return null;
  }
  const period = hh < 12 ? 'AM' : 'PM';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${period}`;
}

export function describeCron(
  cron: string | null | undefined,
  tz: TimezoneMode = 'utc',
  now: Date = new Date()
): string | null {
  if (!cron || typeof cron !== 'string') return null;
  if (cron.trim().split(/\s+/).length !== 5) return null;

  const zone = resolveZone(tz);
  const shifted = utcCronToZone(cron, tz, now);
  // A shift that *declined* leaves the expression in UTC (a date-pinned cron
  // whose conversion crosses midnight has no cron form). Labelling those hours
  // with the reader's zone would be the same lie the shift refused to tell, so
  // the marker follows what the numbers actually are.
  const marker = shifted.reason ? 'UTC' : zoneAbbrev(zone, now);
  const parts = shifted.cron.trim().split(/\s+/);
  const [min, hour, dom, month, dow] = parts;
  const isNum = (s: string) => /^\d+$/.test(s);
  const wildDate = dom === '*' && month === '*';

  // Every N minutes
  const minStep = /^\*\/(\d+)$/.exec(min);
  if (minStep && hour === '*' && wildDate && dow === '*') {
    return `Every ${minStep[1]} minute${minStep[1] === '1' ? '' : 's'}`;
  }

  // Every N hours (optionally at a fixed minute)
  const hourStep = /^\*\/(\d+)$/.exec(hour);
  if (hourStep && (min === '*' || isNum(min)) && wildDate && dow === '*') {
    const suffix = isNum(min) ? ` at :${min.padStart(2, '0')}` : '';
    return `Every ${hourStep[1]} hour${hourStep[1] === '1' ? '' : 's'}${suffix}`;
  }

  // Hourly at a fixed minute
  if (isNum(min) && hour === '*' && wildDate && dow === '*') {
    return `Hourly at :${min.padStart(2, '0')}`;
  }

  // Weekly on specific weekday(s) at H:M — the shift already rolled the days, so
  // sort them back into week order after any midnight crossing.
  if (isNum(min) && isNum(hour) && wildDate && /^[0-6](,[0-6])*$/.test(dow)) {
    const time = clock12h(Number(hour), Number(min));
    if (!time) return null;
    const names = dow
      .split(',')
      .map(Number)
      .sort((a, b) => a - b)
      .map(d => DAY_NAMES[d]);
    return `Weekly on ${names.join(', ')} at ${time} ${marker}`;
  }

  // Daily at H:M
  if (isNum(min) && isNum(hour) && wildDate && dow === '*') {
    const time = clock12h(Number(hour), Number(min));
    return time ? `Daily at ${time} ${marker}` : null;
  }

  // Monthly on a day of the month at H:M. Added with the schedule picker, which
  // made this shape a one-click choice rather than something only a cron author
  // reached — an offered schedule that reads back as a raw expression looks
  // like the app failed to understand what it just built.
  if (isNum(min) && isNum(hour) && month === '*' && dow === '*' && isNum(dom)) {
    const day = Number(dom);
    const time = clock12h(Number(hour), Number(min));
    if (!time || day < 1 || day > 31) return null;
    return `Monthly on the ${ordinalDay(day)} at ${time} ${marker}`;
  }

  return null;
}

/** The minimum a caller needs for us to find its schedule. */
interface SchedulableTask {
  schedule?: string;
  metadata?: Record<string, unknown>;
}

/**
 * The stored UTC cron for a task, wherever the sync payload left it.
 *
 * A synced Windows task carries its schedule on the column; imported and
 * older-agent rows put it in `metadata.schedule` / `metadata.cron`. One
 * definition of "where the cron is" so the card preview and the detail modal
 * can never disagree about whether a task has one.
 */
export function taskCron(task: SchedulableTask): string | null {
  const pick = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const meta = (task.metadata ?? {}) as Record<string, unknown>;
  return pick(task.schedule) ?? pick(meta.schedule) ?? pick(meta.cron);
}

export interface SchedulePreview {
  /**
   * `human` — described in the reader's zone; `cron` — a real schedule whose
   * shape `describeCron` won't guess at, shown raw; `none` — no cron at all
   * (boot / logon / event / on-demand), which is a fact, not a gap.
   */
  kind: 'human' | 'cron' | 'none';
  /** What to render. */
  text: string;
  /** The stored UTC cron, when there is one. */
  cron: string | null;
}

/**
 * One-line schedule for a task, for the card previews.
 *
 * The three outcomes are deliberately distinct: a preview that printed nothing
 * for the last two would make "this runs at 8 AM" and "Cronsole has no idea
 * when this runs" look identical on the wall of cards, which is the failure the
 * card is being added to fix.
 *
 * The shifted reading does **not** print the stored UTC cron beside it here —
 * unlike the schedule *fields*, which must (CLAUDE.md §9). A card is a preview,
 * not an input: the UTC form rides in the tooltip and is printed in full by the
 * detail modal one click away.
 */
export function taskSchedulePreview(
  task: SchedulableTask,
  tz: TimezoneMode = 'utc',
  now: Date = new Date()
): SchedulePreview {
  const cron = taskCron(task);
  if (!cron) return { kind: 'none', text: 'No cron schedule', cron: null };
  const human = describeCron(cron, tz, now);
  return human ? { kind: 'human', text: human, cron } : { kind: 'cron', text: cron, cron };
}
