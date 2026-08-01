import type { TimezoneMode } from '../hooks/useSettings';
import { resolveZone, utcCronToZone, zoneAbbrev } from './timezone';

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
  const marker = zoneAbbrev(zone, now);
  const shifted = utcCronToZone(cron, tz, now);
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

  return null;
}
