/**
 * The picker form of a cron schedule — "Weekly, Mon–Fri, 09:00" — and the
 * translation both ways.
 *
 * Cron stays the storage, the API, the signed agent command and the MCP
 * contract (CLAUDE.md §9). This adds no second representation of a schedule:
 * the shape below exists only between a click and the cron string it compiles
 * to, and every surface still holds **a cron in the user's zone** and converts
 * once on submit (`useScheduleZone`). Nothing downstream can tell whether an
 * expression was typed or assembled, which is the property that makes this safe
 * to add to four screens at once.
 *
 * Two rules the UI depends on, both of them here rather than in the component:
 *
 * - **`cronToShape` returns `null` rather than a guess.** A range in the hour
 *   field, a step inside a weekday, an `L` or a `#` — anything the five shapes
 *   cannot hold — has no picker form, and inventing the nearest one would
 *   silently rewrite a schedule the user is only trying to look at. `null` is
 *   what makes the simple editor *unavailable* for that expression instead of
 *   wrong about it.
 * - **The round trip is not byte-identical, so the component must not write on
 *   open.** `0 9 * * 1-5` reads back as `0 9 * * 1,2,3,4,5` — the same
 *   schedule, a different string. Compiling on mount would dirty a form nobody
 *   edited and rewrite the stored expression of every task merely opened. The
 *   shape is derived for *display*; a cron is emitted only on interaction.
 *
 * What this deliberately does **not** do is judge how well a shape converts to a
 * Windows trigger. That verdict has one definition and it is the server's
 * (`POST /api/tasks/preview` → `scheduler-conversion.ts`); a second copy in the
 * browser is the #20a drift shape, and it would be the copy that goes stale the
 * day the agent learns a Monthly trigger.
 */

export type ScheduleKind = 'minutes' | 'hours' | 'daily' | 'weekly' | 'monthly';

export type ScheduleShape =
  /** Every N minutes. */
  | { kind: 'minutes'; every: number }
  /** Every N hours, at minute M. `every: 1` is plain hourly. */
  | { kind: 'hours'; every: number; minute: number }
  /** Daily at H:M. */
  | { kind: 'daily'; hour: number; minute: number }
  /** Weekly on one or more weekdays at H:M — 0 = Sunday, as in cron. */
  | { kind: 'weekly'; days: number[]; hour: number; minute: number }
  /** Monthly on a day of the month at H:M. */
  | { kind: 'monthly'; day: number; hour: number; minute: number };

/** Sunday-first, matching cron's own 0–6 numbering. */
export const WEEKDAYS: readonly { value: number; short: string; label: string }[] = [
  { value: 0, short: 'S', label: 'Sunday' },
  { value: 1, short: 'M', label: 'Monday' },
  { value: 2, short: 'T', label: 'Tuesday' },
  { value: 3, short: 'W', label: 'Wednesday' },
  { value: 4, short: 'T', label: 'Thursday' },
  { value: 5, short: 'F', label: 'Friday' },
  { value: 6, short: 'S', label: 'Saturday' }
] as const;

export const KIND_LABELS: Readonly<Record<ScheduleKind, string>> = {
  minutes: 'Every N minutes',
  hours: 'Hourly / every N hours',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly'
};

export const SCHEDULE_KINDS: readonly ScheduleKind[] = [
  'minutes',
  'hours',
  'daily',
  'weekly',
  'monthly'
] as const;

const int = (s: string, max: number, min = 0): number | null => {
  if (!/^\d{1,2}$/.test(s)) return null;
  const n = Number(s);
  return n >= min && n <= max ? n : null;
};

/**
 * Cron's day-of-week field as a sorted list of 0–6.
 *
 * Handles the forms a weekly schedule actually uses — `1`, `1,3,5`, `1-5`,
 * `1-3,5` — and folds cron's two spellings of Sunday (`0` and `7`) onto one.
 * `null` on anything else, deliberately: `parseInt('1-5')` is `1`, which is how
 * "every weekday" becomes "Mondays only" at full confidence — the bug the
 * backend converter documents at length.
 */
function parseDays(field: string): number[] | null {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    const range = /^(\d)-(\d)$/.exec(part);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (from > 7 || to > 7 || from > to) return null;
      for (let d = from; d <= to; d++) out.add(d === 7 ? 0 : d);
      continue;
    }
    const one = int(part, 7);
    if (one === null) return null;
    out.add(one === 7 ? 0 : one);
  }
  return out.size ? [...out].sort((a, b) => a - b) : null;
}

/** The picker form of a cron expression, or `null` when it has none. */
export function cronToShape(cron: string): ScheduleShape | null {
  if (typeof cron !== 'string') return null;
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [min, hour, dom, month, dow] = fields;
  if (month !== '*') return null;

  const minStep = /^\*\/(\d{1,2})$/.exec(min);
  const hourStep = /^\*\/(\d{1,2})$/.exec(hour);
  const minNum = int(min, 59);
  const hourNum = int(hour, 23);
  const wildDate = dom === '*' && dow === '*';

  // Every N minutes. `* * * * *` is the every-1 case: it is what the picker
  // compiles at an interval of one, so it has to read back, or the simple
  // editor refuses the expression it just wrote.
  if (min === '*' && hour === '*' && wildDate) return { kind: 'minutes', every: 1 };
  if (minStep && hour === '*' && wildDate) {
    const every = Number(minStep[1]);
    return every >= 1 && every <= 59 ? { kind: 'minutes', every } : null;
  }

  // Hourly at :M. `30 * * * *` is "every 1 hour", so the two collapse into one
  // control rather than making the user know that `*/1` and `*` mean the same.
  if (minNum !== null && hour === '*' && wildDate) {
    return { kind: 'hours', every: 1, minute: minNum };
  }

  // Every N hours at :M.
  if (minNum !== null && hourStep && wildDate) {
    const every = Number(hourStep[1]);
    return every >= 1 && every <= 23 ? { kind: 'hours', every, minute: minNum } : null;
  }

  if (minNum === null || hourNum === null) return null;

  // Daily at H:M.
  if (wildDate) return { kind: 'daily', hour: hourNum, minute: minNum };

  // Weekly on days at H:M.
  if (dom === '*') {
    const days = parseDays(dow);
    return days ? { kind: 'weekly', days, hour: hourNum, minute: minNum } : null;
  }

  // Monthly on a day of the month at H:M. A single day only: `1,15` has no
  // control here, and reading it back as a picker would silently narrow it.
  if (dow === '*') {
    const day = int(dom, 31, 1);
    return day === null ? null : { kind: 'monthly', day, hour: hourNum, minute: minNum };
  }

  // A day-of-month *and* a weekday is cron's OR, which no shape here means.
  return null;
}

/** The cron a picker form compiles to. Always 5 fields, in the caller's zone. */
export function shapeToCron(shape: ScheduleShape): string {
  switch (shape.kind) {
    case 'minutes':
      return shape.every <= 1 ? '* * * * *' : `*/${shape.every} * * * *`;
    case 'hours':
      return shape.every <= 1
        ? `${shape.minute} * * * *`
        : `${shape.minute} */${shape.every} * * *`;
    case 'daily':
      return `${shape.minute} ${shape.hour} * * *`;
    case 'weekly': {
      // Never an empty field: an unticked week would compile to a four-field
      // expression, and the API would answer a checkbox with a message about
      // cron syntax.
      const days = shape.days.length ? [...new Set(shape.days)].sort((a, b) => a - b) : [1];
      return `${shape.minute} ${shape.hour} * * ${days.join(',')}`;
    }
    case 'monthly':
      return `${shape.minute} ${shape.hour} ${shape.day} * *`;
  }
}

/** `hour`/`minute` where the shape has a clock time — `null` where it has none. */
export function shapeTime(shape: ScheduleShape): { hour: number; minute: number } | null {
  if (shape.kind === 'minutes') return null;
  if (shape.kind === 'hours') return { hour: 0, minute: shape.minute };
  return { hour: shape.hour, minute: shape.minute };
}

/**
 * Switch a shape to another kind, keeping everything the new kind can hold.
 *
 * Daily 09:00 → Weekly must stay 09:00. Re-defaulting to midnight every time
 * the dropdown moves makes the control feel like it throws your work away, and
 * for the kinds that keep no clock time it quietly does.
 */
export function withKind(shape: ScheduleShape, kind: ScheduleKind): ScheduleShape {
  if (shape.kind === kind) return shape;
  const time = shapeTime(shape);
  const hour = time ? time.hour : 9;
  const minute = time ? time.minute : 0;
  switch (kind) {
    case 'minutes':
      return { kind: 'minutes', every: 15 };
    case 'hours':
      return { kind: 'hours', every: 1, minute };
    case 'daily':
      return { kind: 'daily', hour, minute };
    case 'weekly':
      return { kind: 'weekly', days: [1, 2, 3, 4, 5], hour, minute };
    case 'monthly':
      return { kind: 'monthly', day: 1, hour, minute };
  }
}

/** `"09:05"` for an `<input type="time">`. */
export function toTimeValue(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** An `<input type="time">` value, or `null` when it hands back something else. */
export function fromTimeValue(value: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!m) return null;
  const hour = int(m[1], 23);
  const minute = int(m[2], 59);
  return hour === null || minute === null ? null : { hour, minute };
}

/** Day-of-month with its ordinal suffix — "1st", "22nd", "31st". */
export function ordinalDay(day: number): string {
  const rem100 = day % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}
