import type { TimezoneMode } from '../hooks/useSettings';

/**
 * Best-effort, honest human description of a 5-field cron expression
 * (`minute hour day-of-month month day-of-week`). Covers the common shapes
 * Cronsole generates and syncs; returns `null` for anything it can't describe
 * confidently so callers fall back to showing the raw expression rather than
 * guessing wrong.
 *
 * Schedules are stored in UTC (see CLAUDE.md §9). With `tz: 'utc'` the clock
 * times are shown in UTC (suffixed `UTC`); with `tz: 'local'` the recurring
 * time is converted to the viewer's zone — shifting the hour/minute and rolling
 * the day-of-week when the conversion crosses midnight (e.g. Mon 02:00 UTC is
 * Sun 21:00 in New York). Only the Daily/Weekly shapes carry an absolute clock
 * time; the interval shapes (every N min/hours, hourly) read the same in any
 * zone (whole-hour offsets), so they're unaffected.
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

/**
 * Convert a UTC time-of-day (and optional weekday) to the viewer's local zone.
 * `now` anchors the conversion so it reflects the current DST offset. For a
 * weekly schedule (`dow` set) the returned `dow` is the local weekday, which may
 * differ from the UTC one when the time crosses midnight. For daily (`dow` null)
 * the weekday is irrelevant and ignored by the caller.
 */
function toLocalParts(
  dow: number | null,
  hh: number,
  mm: number,
  now: Date
): { dow: number; hour: number; min: number } {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hh, mm));
  if (dow !== null) {
    // Advance to the next date whose UTC weekday matches, so the local weekday
    // reflects this exact UTC instant.
    for (let i = 0; i < 7 && d.getUTCDay() !== dow; i++) {
      d.setUTCDate(d.getUTCDate() + 1);
    }
  }
  return { dow: d.getDay(), hour: d.getHours(), min: d.getMinutes() };
}

export function describeCron(
  cron: string | null | undefined,
  tz: TimezoneMode = 'utc',
  now: Date = new Date()
): string | null {
  if (!cron || typeof cron !== 'string') return null;
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, dom, mon, dow] = parts;
  const isNum = (s: string) => /^\d+$/.test(s);
  const wildDate = dom === '*' && mon === '*';

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

  // Weekly on specific weekday(s) at H:M
  if (isNum(min) && isNum(hour) && wildDate && /^[0-6](,[0-6])*$/.test(dow)) {
    const hh = Number(hour);
    const mm = Number(min);
    const days = dow.split(',').map(Number);
    if (tz === 'local') {
      // Each day converts independently (same clock time), then re-sort so the
      // week reads in order after any midnight roll.
      const localDays = days.map(d => toLocalParts(d, hh, mm, now));
      const time = clock12h(localDays[0].hour, localDays[0].min);
      if (!time) return null;
      const names = localDays
        .map(p => p.dow)
        .sort((a, b) => a - b)
        .map(d => DAY_NAMES[d]);
      return `Weekly on ${names.join(', ')} at ${time}`;
    }
    const time = clock12h(hh, mm);
    return time ? `Weekly on ${days.map(d => DAY_NAMES[d]).join(', ')} at ${time} UTC` : null;
  }

  // Daily at H:M
  if (isNum(min) && isNum(hour) && wildDate && dow === '*') {
    const hh = Number(hour);
    const mm = Number(min);
    if (tz === 'local') {
      const { hour: lh, min: lm } = toLocalParts(null, hh, mm, now);
      const time = clock12h(lh, lm);
      return time ? `Daily at ${time}` : null;
    }
    const time = clock12h(hh, mm);
    return time ? `Daily at ${time} UTC` : null;
  }

  return null;
}
