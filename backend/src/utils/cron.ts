/**
 * The project's cron shape check: 5 fields, `min hour dom month dow`, UTC.
 *
 * One definition, imported — it was previously a `const` copy-pasted into
 * `routes/tasks.ts` and `routes/templates.ts`, which is two places to change a
 * rule that must be identical in both. It is deliberately a *shape* check and
 * not a full parse: the parse belongs to `cron-parser` at the point of use, and
 * the routes want to distinguish "not a cron at all" (a 400) from "a cron that
 * converts imperfectly" (a low-confidence preview).
 */
export function isValidCron(cron: string): boolean {
  return cron.trim().split(/\s+/).length === 5;
}

/**
 * **Why a zone conversion exists on the server at all.**
 *
 * The rule is that a zone never reaches storage and conversion happens at the
 * browser's edge, once, on submit (`frontend/src/utils/timezone.ts`). That rule
 * is about *Cronsole's own* schedules, where the browser is the only place a
 * user's zone is known and the only place it is needed.
 *
 * Gemini API Triggers is the first platform that stores a zone **itself**: a
 * trigger carries `{ schedule, time_zone }`, and `time_zone` is whatever the
 * developer who created it wrote — Google's own example is
 * `America/Argentina/Buenos_Aires`. Cronsole's storage contract is 5-field UTC,
 * so the read has to reconcile the two somewhere, and the browser is the one
 * place it cannot be: the same trigger has to normalize identically for a sync,
 * for an MCP session and for the rail, none of which have a browser.
 *
 * So this is the server-side twin of `shiftCron`, and the duplication is
 * deliberate rather than overlooked. `backend/` and `frontend/` are separate npm
 * projects with no shared package, and the alternative to two files is a build
 * boundary invented to hold sixty lines. **They must stay in step**, and the
 * cases below are written in the same order as the frontend's for that reason.
 *
 * Two behaviours are inherited from the frontend twin on purpose:
 *
 * **The offset is read at a moment in time, so DST is the offset in force
 * *now*.** A trigger at 09:00 `America/New_York` is 13:00 UTC in summer and
 * 14:00 in winter, and no single 5-field cron says both. Cronsole stores the
 * current one and prints the platform's original beside it, which is the same
 * bargain the browser's edge already makes.
 *
 * **A refusal states its reason, and never renders as "no problem here."** That
 * is troubleshooting #60: declining to convert and answering "this reads the
 * same in both zones" must not be the same code path, because a user told the
 * conversion was unnecessary has no way to discover their schedule is 7 hours
 * out.
 */
export interface CronShiftToUtc {
  /**
   * The 5-field cron in UTC, or **null when the shift was refused**.
   *
   * Null rather than the original expression, and the difference is load-bearing:
   * returning the unshifted cron would store a zoned expression as though it
   * were UTC, which is the one outcome the storage contract rules out. A caller
   * writes `schedule: null` and shows `reason`.
   */
  cron: string | null;
  /** Did the expression actually move? False for a UTC trigger and for a shift of zero. */
  shifted: boolean;
  /** Why the conversion was declined. Present exactly when `cron` is null. */
  reason?: string;
}

const mod = (n: number, m: number) => ((n % m) + m) % m;

/**
 * A zone's offset from UTC in minutes, east-positive, at a given instant.
 *
 * Via `Intl`, which every supported Node build carries with full tz data — no
 * dependency, and no offset table of our own to go stale when a country moves
 * its clocks (several do most years).
 *
 * Returns null for a zone `Intl` will not accept, which is the honest answer for
 * a `time_zone` string the platform allowed and we cannot resolve: the caller
 * refuses with a reason rather than assuming UTC. Assuming UTC is precisely the
 * silent-wrong-answer shape — it would look like a successful conversion.
 */
export function zoneOffsetMinutes(timeZone: string, at: Date = new Date()): number | null {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).formatToParts(at);
  } catch {
    return null;
  }

  const field = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find(p => p.type === type);
    return found ? Number(found.value) : NaN;
  };

  // The wall-clock reading in `timeZone`, re-read as though it were UTC. The gap
  // between that and the real instant *is* the offset.
  const wall = Date.UTC(
    field('year'),
    field('month') - 1,
    field('day'),
    field('hour'),
    field('minute'),
    field('second')
  );
  if (Number.isNaN(wall)) return null;

  // Seconds are dropped: no zone is offset by a fraction of a minute today, and
  // rounding here keeps a leap-second-adjacent read from producing 329.98.
  return Math.round((wall - at.getTime()) / 60_000);
}

/**
 * Re-express a cron written in `timeZone` as the same wall-clock times in UTC.
 *
 * Mirrors `shiftCron` in the frontend, case for case:
 *
 *  - `M H * * [dow]` — the time moves, and the weekday rolls when the shift
 *    crosses midnight (Monday 02:00 in Tokyo is Sunday in UTC).
 *  - `M * * * *` — hourly at a fixed minute: only the minute can move, and only
 *    for a zone whose offset is not a whole hour (`Asia/Kolkata`, `+05:30`).
 *  - Anything offset-invariant for a whole-hour zone is returned untouched.
 *
 * Two refusals, and each is a case where a plausible expression would fire on
 * the wrong day:
 *
 *  - **The hour field names more than one hour** — a range, a step or a list. A zone
 *    change moves every one of them and cron has no way to say "these seven
 *    hours, shifted" without enumerating them, so it is declined rather than
 *    enumerated — the same call `shiftCron` makes, and the same one Cronsole's
 *    own multi-value-hour conversion still owes (ROADMAP › Next up).
 *  - **The shift crosses midnight while a day-of-month or month is pinned**
 *    (`0 4 1 1 *`). "The 1st at 04:00 in Tokyo" is the 31st of December in UTC,
 *    and a 5-field cron cannot express that.
 */
export function shiftCronToUtc(
  cron: string,
  timeZone: string | null | undefined,
  at: Date = new Date()
): CronShiftToUtc {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) {
    return {
      cron: null,
      shifted: false,
      reason: `Not a 5-field cron expression: "${cron}"`
    };
  }

  // The common case, and the one Cronsole writes on everything it creates: no
  // conversion, no rounding, no DST question. `Etc/UTC` and `GMT` are the same
  // answer by a different name.
  if (!timeZone || /^(utc|gmt|etc\/(utc|gmt|greenwich))$/i.test(timeZone.trim())) {
    return { cron: fields.join(' '), shifted: false };
  }

  const offset = zoneOffsetMinutes(timeZone, at);
  if (offset === null) {
    return {
      cron: null,
      shifted: false,
      reason:
        `The platform reports this schedule in the time zone "${timeZone}", which this system cannot ` +
        'resolve — so Cronsole will not guess a UTC equivalent for it.'
    };
  }

  // East-positive offset, so UTC is the local clock **minus** the offset.
  const delta = -offset;
  if (mod(delta, 1440) === 0) return { cron: fields.join(' '), shifted: false };

  const [min, hour, dom, month, dow] = fields as [string, string, string, string, string];
  const isNum = (s: string) => /^\d+$/.test(s);

  // Hourly at a fixed minute. Only a partial-hour zone moves anything.
  if (isNum(min) && hour === '*') {
    if (mod(delta, 60) === 0) return { cron: fields.join(' '), shifted: false };
    return {
      cron: [String(mod(Number(min) + delta, 60)), hour, dom, month, dow].join(' '),
      shifted: true
    };
  }

  if (!isNum(min) || !isNum(hour)) {
    const pinsHours = hour !== '*';
    const minutesWouldMove = mod(delta, 60) !== 0 && min !== '*';
    if (pinsHours) {
      return {
        cron: null,
        shifted: false,
        reason:
          `The hour field names more than one hour ("${hour}"), so Cronsole cannot re-express this ` +
          `schedule from ${timeZone} into UTC without enumerating every hour it would move to.`
      };
    }
    if (minutesWouldMove) {
      return {
        cron: null,
        shifted: false,
        reason:
          `${timeZone} is offset from UTC by part of an hour and the minute field is not a single ` +
          'value, so Cronsole cannot re-express this schedule in UTC.'
      };
    }
    // Genuinely offset-invariant: no fixed clock time to move.
    return { cron: fields.join(' '), shifted: false };
  }

  const total = Number(hour) * 60 + Number(min) + delta;
  const dayDelta = Math.floor(total / 1440);
  const inDay = mod(total, 1440);
  const shiftedTime = [String(inDay % 60), String(Math.floor(inDay / 60))];

  if (dayDelta === 0) {
    return { cron: [...shiftedTime, dom, month, dow].join(' '), shifted: true };
  }

  if (dom !== '*' || month !== '*') {
    return {
      cron: null,
      shifted: false,
      reason:
        `Converting this schedule from ${timeZone} to UTC crosses midnight, and it pins a day of the ` +
        'month or a month — cron cannot express the resulting date, so Cronsole will not approximate it.'
    };
  }

  if (dow === '*') {
    return { cron: [...shiftedTime, dom, month, dow].join(' '), shifted: true };
  }

  const days = parseDays(dow);
  if (!days) {
    return {
      cron: null,
      shifted: false,
      reason:
        `Converting this schedule from ${timeZone} to UTC crosses midnight, and Cronsole cannot read ` +
        `the day-of-week field ("${dow}") well enough to roll it to the correct day.`
    };
  }

  const rolled = [...new Set(days.map(d => mod(d + dayDelta, 7)))].sort((a, b) => a - b);
  return { cron: [...shiftedTime, dom, month, rolled.join(',')].join(' '), shifted: true };
}

const DAY_FIELD = /^(\d+|\d+-\d+)(,(\d+|\d+-\d+))*$/;

/**
 * Expand a cron day-of-week field to individual indices (0 = Sunday).
 *
 * Mirrors the frontend's `parseDays` and the agent-side `parseCronDaysOfWeek`,
 * including cron's two spellings of Sunday (`0` and `7`). Returns null rather
 * than a guess when any part is unparseable — the caller then declines to shift
 * instead of inventing a day.
 */
function parseDays(dow: string): number[] | null {
  if (!DAY_FIELD.test(dow)) return null;
  const days = new Set<number>();
  for (const part of dow.split(',')) {
    const range = /^(\d+)-(\d+)$/.exec(part);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (start > 7 || end > 7 || start > end) return null;
      for (let d = start; d <= end; d++) days.add(d % 7);
      continue;
    }
    const day = Number(part);
    if (day > 7) return null;
    days.add(day % 7);
  }
  return days.size > 0 ? [...days] : null;
}
