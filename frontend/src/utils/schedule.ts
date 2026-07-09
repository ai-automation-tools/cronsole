/**
 * Best-effort, honest human description of a 5-field cron expression
 * (`minute hour day-of-month month day-of-week`). Covers the common shapes
 * TaskHub generates and syncs; returns `null` for anything it can't describe
 * confidently so callers fall back to showing the raw expression rather than
 * guessing wrong.
 *
 * Schedules are stored in UTC (see CLAUDE.md §9), so the clock times below are
 * UTC and callers should label them as such.
 */
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function clock12h(hour: string, minute: string): string | null {
  const hh = Number(hour);
  const mm = Number(minute);
  if (!Number.isInteger(hh) || !Number.isInteger(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    return null;
  }
  const period = hh < 12 ? 'AM' : 'PM';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${period}`;
}

export function describeCron(cron: string | null | undefined): string | null {
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
    const names = dow.split(',').map(d => DAY_NAMES[Number(d)]);
    const time = clock12h(hour, min);
    return time ? `Weekly on ${names.join(', ')} at ${time} UTC` : null;
  }

  // Daily at H:M
  if (isNum(min) && isNum(hour) && wildDate && dow === '*') {
    const time = clock12h(hour, min);
    return time ? `Daily at ${time} UTC` : null;
  }

  return null;
}
