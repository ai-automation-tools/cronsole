import { describe, it, expect } from 'vitest';
import {
  hhmmInZone,
  resolveZone,
  shiftCron,
  utcCronToZone,
  zoneCronToUtc,
  zoneOffsetMinutes
} from '../timezone';

const PACIFIC = 'America/Los_Angeles';
const INDIA = 'Asia/Kolkata';
const JAN = new Date('2024-01-15T12:00:00Z'); // PST, −08:00
const JUL = new Date('2024-07-15T12:00:00Z'); // PDT, −07:00

describe('zoneOffsetMinutes', () => {
  it('reads the real offset at an instant, including DST', () => {
    expect(zoneOffsetMinutes(PACIFIC, JAN)).toBe(-480);
    expect(zoneOffsetMinutes(PACIFIC, JUL)).toBe(-420);
    expect(zoneOffsetMinutes('UTC', JAN)).toBe(0);
  });

  it('handles zones whose offset is not a whole hour', () => {
    expect(zoneOffsetMinutes(INDIA, JAN)).toBe(330);
  });
});

describe('resolveZone', () => {
  it('maps the two keywords and passes zone ids through', () => {
    expect(resolveZone('utc')).toBe('UTC');
    expect(resolveZone(PACIFIC)).toBe(PACIFIC);
    expect(resolveZone('local')).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
});

describe('shiftCron', () => {
  it('shifts a daily clock time', () => {
    expect(shiftCron('0 16 * * *', -480)).toEqual({ cron: '0 8 * * *', shifted: true });
  });

  it('rolls the weekday when the shift crosses midnight', () => {
    // Mon 02:00 UTC → Sun 18:00 Pacific.
    expect(shiftCron('0 2 * * 1', -480)).toEqual({ cron: '0 18 * * 0', shifted: true });
  });

  it('expands a day range before rolling it', () => {
    // parseInt('1-5') is 1 — the bug that once made every weekday schedule
    // Monday-only in three separate layers. Weekdays 09:00 Pacific → 17:00 UTC
    // stays on the same day; the reverse crosses midnight and must roll all five.
    expect(shiftCron('0 2 * * 1-5', -480)).toEqual({ cron: '0 18 * * 0,1,2,3,4', shifted: true });
  });

  it('folds cron\'s two spellings of Sunday onto one day when it rolls', () => {
    // 04:00 UTC Sunday → 20:00 Saturday Pacific. Both `0` and `7` mean Sunday,
    // so the roll must produce one Saturday, not two.
    expect(shiftCron('0 4 * * 0,7', -480)).toEqual({ cron: '0 20 * * 6', shifted: true });
  });

  it('leaves the day field untouched when the shift stays on the same day', () => {
    // Rewriting `1-5` into `1,2,3,4,5` for no reason would churn the stored
    // expression on every save and make "did this change?" checks noisy.
    expect(shiftCron('0 12 * * 1-5', -480)).toEqual({ cron: '0 4 * * 1-5', shifted: true });
    expect(shiftCron('0 12 * * 0,7', -480)).toEqual({ cron: '0 4 * * 0,7', shifted: true });
  });

  it('leaves expressions with no fixed clock time alone, and says nothing about them', () => {
    // No reason, because there is nothing to explain: the hour is a wildcard, so
    // these recur every hour and a whole-hour offset genuinely cannot move them.
    expect(shiftCron('*/15 * * * *', -480)).toEqual({ cron: '*/15 * * * *', shifted: false });
    expect(shiftCron('20 * * * *', -480)).toEqual({ cron: '20 * * * *', shifted: false });
    expect(shiftCron('* * * * *', -480)).toEqual({ cron: '* * * * *', shifted: false });
  });

  // The bug this pins: `shifted: false` with no reason is NOT silence. The hint
  // renders it as "no fixed clock time, so it reads the same in PDT and UTC",
  // so an unshiftable expression that DOES pin a clock time gets a confident
  // false statement printed under it while being stored 7–8 hours off.
  it('explains a multi-value hour instead of calling it clock-time-free', () => {
    // The reported case: a Pacific user's working day, stored as 01:00–09:00.
    const workday = shiftCron('0 9-17 * * 1-5', -480);
    expect(workday.cron).toBe('0 9-17 * * 1-5');
    expect(workday.shifted).toBe(false);
    expect(workday.reason).toMatch(/single hour/);
  });

  it('explains an hour list and an hour step too — both pin real clock times', () => {
    // `0 */6 * * *` fires at 00:00, 06:00, 12:00 and 18:00. That is four fixed
    // clock times, and they are four DIFFERENT ones in Pacific — exactly the
    // reasoning that makes "hourly at :20" shift for a half-hour zone below.
    expect(shiftCron('0 */6 * * *', -480).reason).toBeTruthy();
    expect(shiftCron('0 1,13 * * *', -480).reason).toBeTruthy();
    // A fixed hour with several minutes still pins an hour.
    expect(shiftCron('0,30 9 * * *', -480).reason).toBeTruthy();
  });

  it('flags a multi-value minute only when the zone offset is a partial hour', () => {
    // Whole-hour zone: `0,30 * * * *` really is the same statement in both.
    expect(shiftCron('0,30 * * * *', -480)).toEqual({ cron: '0,30 * * * *', shifted: false });
    // Kolkata: the minutes would have moved, and we cannot move them.
    expect(shiftCron('0,15 * * * *', 330).reason).toBeTruthy();
  });

  it('does move the minute of an hourly schedule for a half-hour zone', () => {
    // "Hourly at :20" is NOT the same statement in Kolkata as in UTC.
    expect(shiftCron('20 * * * *', 330)).toEqual({ cron: '50 * * * *', shifted: true });
    expect(shiftCron('50 * * * *', 330)).toEqual({ cron: '20 * * * *', shifted: true });
  });

  it('refuses — with a reason — when a date-pinned schedule crosses midnight', () => {
    // 0 4 1 1 * is the once-a-year expression from troubleshooting #14. In
    // Pacific it lands on 31 December, which cron cannot express, so the honest
    // answer is to leave it in UTC and say so rather than emit a wrong date.
    const result = shiftCron('0 4 1 1 *', -480);
    expect(result.cron).toBe('0 4 1 1 *');
    expect(result.shifted).toBe(false);
    expect(result.reason).toMatch(/pinned to a date/);
  });

  it('shifts a date-pinned schedule that stays on the same day', () => {
    expect(shiftCron('0 20 1 1 *', -480)).toEqual({ cron: '0 12 1 1 *', shifted: true });
  });

  it('is a no-op for a zero offset and for malformed input', () => {
    expect(shiftCron('0 8 * * *', 0)).toEqual({ cron: '0 8 * * *', shifted: false });
    expect(shiftCron('not a cron', -480)).toEqual({ cron: 'not a cron', shifted: false });
    expect(shiftCron('0 8 * *', -480)).toEqual({ cron: '0 8 * *', shifted: false });
  });
});

describe('utcCronToZone / zoneCronToUtc', () => {
  it('round-trips a daily schedule', () => {
    const stored = zoneCronToUtc('0 8 * * *', PACIFIC, JAN);
    expect(stored.cron).toBe('0 16 * * *');
    expect(utcCronToZone(stored.cron, PACIFIC, JAN).cron).toBe('0 8 * * *');
  });

  it('round-trips a weekly schedule across a midnight roll', () => {
    // Sunday 10 PM Pacific is Monday 06:00 UTC.
    const stored = zoneCronToUtc('0 22 * * 0', PACIFIC, JAN);
    expect(stored.cron).toBe('0 6 * * 1');
    expect(utcCronToZone(stored.cron, PACIFIC, JAN).cron).toBe('0 22 * * 0');
  });

  it('round-trips a weekday range that stays on the same day', () => {
    const stored = zoneCronToUtc('0 9 * * 1-5', PACIFIC, JAN);
    expect(stored.cron).toBe('0 17 * * 1-5');
    expect(utcCronToZone(stored.cron, PACIFIC, JAN).cron).toBe('0 9 * * 1-5');
  });

  it('round-trips every weekday of a range that crosses midnight', () => {
    // Weeknights at 10 PM Pacific are the next morning in UTC, so all five days
    // move — the case that `parseInt('1-5')` once turned into Mondays only.
    const stored = zoneCronToUtc('0 22 * * 1-5', PACIFIC, JAN);
    expect(stored.cron).toBe('0 6 * * 2,3,4,5,6');
    // The range comes back expanded, which is the same set of days.
    expect(utcCronToZone(stored.cron, PACIFIC, JAN).cron).toBe('0 22 * * 1,2,3,4,5');
  });

  it('converts in opposite directions', () => {
    // The whole point: the two must not be the same function. If they were,
    // authoring would silently double-shift on the way to the backend.
    expect(zoneCronToUtc('0 8 * * *', PACIFIC, JUL).cron).toBe('0 15 * * *');
    expect(utcCronToZone('0 8 * * *', PACIFIC, JUL).cron).toBe('0 1 * * *');
  });
});

describe('hhmmInZone', () => {
  it('converts a Windows start boundary out of UTC', () => {
    expect(hhmmInZone('16:00', PACIFIC, JAN)).toBe('08:00');
    expect(hhmmInZone('02:30', PACIFIC, JAN)).toBe('18:30');
    expect(hhmmInZone('06:00', INDIA, JAN)).toBe('11:30');
  });

  it('returns null rather than guessing at a non-HH:mm value', () => {
    expect(hhmmInZone('', PACIFIC, JAN)).toBeNull();
    expect(hhmmInZone('25:00', PACIFIC, JAN)).toBeNull();
    expect(hhmmInZone('2024-01-01T00:00', PACIFIC, JAN)).toBeNull();
  });
});
