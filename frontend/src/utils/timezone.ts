import type { TimezoneMode } from '../hooks/useSettings';

/**
 * The schedule timezone layer.
 *
 * Storage does not move. Schedules are still 5-field cron in UTC everywhere
 * below this file (CLAUDE.md §9) — the backend converter, the HMAC-signed
 * `task:create` payload, and the agent's `TriggerBuilder.UtcTimeToLocalToday`
 * all keep reading UTC. What changes is *authoring*: the user types a clock
 * time in their own zone and it is converted to UTC before it leaves the
 * browser, instead of the user doing that arithmetic in their head.
 *
 * That distinction is the whole design. A zone that reached storage would fork
 * the meaning of every cron string in the database depending on who wrote it,
 * and the MCP surface — which has no access to a browser preference — would
 * have no way to know which reading applied. So the zone lives at the edge, and
 * the edge alone.
 *
 * **The DST caveat, stated once and honestly.** A UTC cron is a fixed offset
 * from UTC; a Pacific wall-clock time is not (PST is −08:00, PDT is −07:00). So
 * "8:00 AM Pacific" converts to a *different* UTC cron depending on when you
 * convert it. For Windows tasks this is harmless in practice: the agent
 * converts UTC→local at registration and Windows then holds the local
 * wall-clock time across transitions, so the task keeps firing at 8:00 AM.
 * For Cronsole-native tasks it is not: `NativeScheduler` evaluates the stored
 * cron in UTC forever, so a task authored in PDT fires an hour earlier once PST
 * begins. The UI says so rather than pretending otherwise.
 */

/** IANA zone id of the machine Cronsole is being viewed on. */
export function machineZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * The concrete IANA zone a `TimezoneMode` names. `'local'` follows the machine,
 * `'utc'` is UTC, and anything else is already a zone id.
 */
export function resolveZone(mode: TimezoneMode): string {
  if (mode === 'local') return machineZone();
  if (mode === 'utc') return 'UTC';
  return mode;
}

/**
 * Minutes east of UTC for `zone` at the instant `at` — i.e. the number to ADD to
 * a UTC clock time to get the zone's clock time. Pacific is −480 (PST) or −420
 * (PDT), which is why it must be evaluated at an instant rather than looked up.
 *
 * Derived by formatting `at` in the zone and reading the wall-clock back, which
 * is the only approach that works for every zone the browser knows without
 * shipping a tz database.
 */
export function zoneOffsetMinutes(zone: string, at: Date = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).formatToParts(at);

    const field = (type: string) => {
      const part = parts.find(p => p.type === type);
      return part ? Number(part.value) : NaN;
    };

    // `hour12: false` renders midnight as "24" in some engines; fold it back.
    const asIfUtc = Date.UTC(
      field('year'),
      field('month') - 1,
      field('day'),
      field('hour') % 24,
      field('minute'),
      field('second')
    );
    if (Number.isNaN(asIfUtc)) return 0;
    return Math.round((asIfUtc - at.getTime()) / 60_000);
  } catch {
    // An unknown zone id must not silently become UTC-with-confidence, but the
    // display layer has no way to refuse — 0 at least keeps times readable and
    // `zoneAbbrev` will surface the raw id beside them.
    return 0;
  }
}

/** Short zone name at an instant — "PDT", "GMT+5:30", "UTC". */
export function zoneAbbrev(zone: string, at: Date = new Date()): string {
  if (zone === 'UTC') return 'UTC';
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      timeZoneName: 'short'
    }).formatToParts(at);
    return parts.find(p => p.type === 'timeZoneName')?.value ?? zone;
  } catch {
    return zone;
  }
}

/**
 * How a zone is named in the UI: the abbreviation when it has a real one
 * ("PDT"), otherwise the zone's city ("Kolkata"). Never just "Local" — the
 * point of the setting is that you can see which zone you are authoring in.
 */
export function zoneLabel(mode: TimezoneMode, at: Date = new Date()): string {
  const zone = resolveZone(mode);
  const abbrev = zoneAbbrev(zone, at);
  // A zone with no abbreviation formats as an offset ("GMT+5:30"); pair it with
  // the city so the row is identifiable at a glance.
  if (/^GMT|^UTC[+-]/.test(abbrev)) {
    const city = zone.split('/').pop()?.replace(/_/g, ' ') ?? zone;
    return `${city} (${abbrev})`;
  }
  return abbrev;
}

// ---------------------------------------------------------------------------
// Cron ↔ zone
// ---------------------------------------------------------------------------

export interface CronShift {
  /** The expression in the target zone, or the input unchanged when it could not move. */
  cron: string;
  /** True when the expression actually changed. */
  shifted: boolean;
  /**
   * Set only when the expression HAS a clock time we would have moved but
   * could not. An expression with no fixed clock time (an every-N-minutes step)
   * reads the same in any whole-hour zone and is not a refusal — it is a no-op,
   * and reporting it as a problem would train the user to ignore the warning.
   */
  reason?: string;
}

const DAY_FIELD = /^(\d+|\d+-\d+)(,(\d+|\d+-\d+))*$/;

/**
 * Expand a cron day-of-week field to individual indices (0=Sunday). Mirrors the
 * backend's `parseCronDaysOfWeek` (scheduler-conversion.ts), including cron's
 * two spellings of Sunday (`0` and `7`). Returns null rather than a guess when
 * any part is unparseable — the caller then declines to shift instead of
 * inventing a day, the same rule the backend follows.
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

const mod = (n: number, m: number) => ((n % m) + m) % m;

/**
 * Move a 5-field cron by `offsetMinutes`, or explain why it can't move.
 *
 * Only expressions with a fixed clock time carry a zone at all:
 *   - `M H * * [dow]`  — shifts the time, and rolls the weekday when the shift
 *                         crosses midnight (Mon 02:00 UTC is Sun in Pacific).
 *   - `M * * * *`      — hourly at a fixed minute: only the minute can move, and
 *                         only for a zone whose offset isn't a whole hour.
 * Everything else — minute steps, hour steps, wildcards — is offset-invariant
 * for a whole-hour zone and is returned untouched.
 *
 * The one honest refusal: a shift that crosses midnight while the expression
 * pins a day-of-month or month (`0 4 1 1 *`) cannot be re-expressed — "the 1st
 * at 04:00 UTC" is the 31st of the previous month in Pacific, and cron has no
 * way to say that. Refusing and saying so beats emitting a plausible expression
 * that fires on the wrong date.
 */
export function shiftCron(cron: string, offsetMinutes: number): CronShift {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return { cron, shifted: false };
  if (mod(offsetMinutes, 1440) === 0) return { cron, shifted: false };

  const [min, hour, dom, month, dow] = fields;
  const isNum = (s: string) => /^\d+$/.test(s);

  // Hourly at a fixed minute — no hour to move, but a half-hour zone moves the
  // minute. A whole-hour offset leaves it genuinely unchanged.
  if (isNum(min) && hour === '*') {
    const minuteShift = mod(offsetMinutes, 60);
    if (minuteShift === 0) return { cron, shifted: false };
    return {
      cron: [String(mod(Number(min) + offsetMinutes, 60)), hour, dom, month, dow].join(' '),
      shifted: true
    };
  }

  if (!isNum(min) || !isNum(hour)) return { cron, shifted: false };

  const total = Number(hour) * 60 + Number(min) + offsetMinutes;
  const dayDelta = Math.floor(total / 1440);
  const inDay = mod(total, 1440);
  const newHour = Math.floor(inDay / 60);
  const newMin = inDay % 60;

  if (dayDelta === 0) {
    return { cron: [newMin, newHour, dom, month, dow].join(' '), shifted: true };
  }

  // The shift crosses midnight from here on.
  if (dom !== '*' || month !== '*') {
    return {
      cron,
      shifted: false,
      reason:
        'This schedule is pinned to a date, and converting it crosses midnight — ' +
        'cron cannot express the resulting date, so it is shown and stored in UTC.'
    };
  }

  if (dow === '*') {
    return { cron: [newMin, newHour, dom, month, dow].join(' '), shifted: true };
  }

  const days = parseDays(dow);
  if (!days) {
    return {
      cron,
      shifted: false,
      reason:
        'The day-of-week field uses a form Cronsole can’t roll across midnight, ' +
        'so this schedule is shown and stored in UTC.'
    };
  }

  const rolled = [...new Set(days.map(d => mod(d + dayDelta, 7)))].sort((a, b) => a - b).join(',');
  return { cron: [newMin, newHour, dom, month, rolled].join(' '), shifted: true };
}

/**
 * A bare `HH:mm` UTC clock time, as it reads in the user's zone.
 *
 * Windows trigger start boundaries arrive this way: Task Scheduler holds them in
 * local time and the agent converts them to UTC on the way out
 * (`TriggerReader.ToUtcHhmm`), so the value in `metadata.trigger` is genuinely
 * UTC. Rendering it raw beside a dashboard that now reads in Pacific would put
 * two different zones on one card with nothing distinguishing them.
 * Returns null for anything that isn't `HH:mm`.
 */
export function hhmmInZone(hhmm: string, mode: TimezoneMode, at: Date = new Date()): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  const shifted = mod(hours * 60 + minutes + zoneOffsetMinutes(resolveZone(mode), at), 1440);
  return `${String(Math.floor(shifted / 60)).padStart(2, '0')}:${String(shifted % 60).padStart(2, '0')}`;
}

/** A stored UTC cron, as it reads in the user's zone (what the input shows). */
export function utcCronToZone(cron: string, mode: TimezoneMode, at: Date = new Date()): CronShift {
  return shiftCron(cron, zoneOffsetMinutes(resolveZone(mode), at));
}

/** A cron the user typed in their zone, as UTC (what gets stored). */
export function zoneCronToUtc(cron: string, mode: TimezoneMode, at: Date = new Date()): CronShift {
  return shiftCron(cron, -zoneOffsetMinutes(resolveZone(mode), at));
}
