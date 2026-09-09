import { describe, it, expect } from 'vitest';
import { shiftCronToUtc, zoneOffsetMinutes } from '../cron.js';

/**
 * **The server-side zone conversion, which exists for exactly one platform.**
 *
 * Gemini API Triggers is the first source that stores a zone *itself*
 * (`{ schedule, time_zone }`), and Cronsole's contract is 5-field UTC. The
 * browser cannot do this reconciliation — the same trigger has to normalize
 * identically for a sync, an MCP session and the rail, none of which have one.
 *
 * Every case below is one of the two things this function must never do:
 * **shift wrongly**, or **decline silently**. The second is troubleshooting #60:
 * "I will not convert this" and "this reads the same in both zones" must not be
 * the same answer, because a user told the conversion was unnecessary has no way
 * to discover their schedule is hours out.
 *
 * A fixed instant is passed throughout, so a test cannot start failing in
 * November when the northern clocks go back.
 */

/** Mid-January: northern zones on standard time, southern on daylight time. */
const WINTER = new Date('2026-01-15T12:00:00Z');
/** Mid-July: the mirror image, which is what makes the DST cases meaningful. */
const SUMMER = new Date('2026-07-15T12:00:00Z');

describe('zoneOffsetMinutes', () => {
  it('reads a whole-hour zone east of UTC', () => {
    expect(zoneOffsetMinutes('Asia/Tokyo', WINTER)).toBe(540);
  });

  it('reads a partial-hour zone', () => {
    // The case that makes the minute field movable at all.
    expect(zoneOffsetMinutes('Asia/Kolkata', WINTER)).toBe(330);
  });

  it('reads the offset in force at that instant, not a fixed one', () => {
    expect(zoneOffsetMinutes('America/New_York', WINTER)).toBe(-300);
    expect(zoneOffsetMinutes('America/New_York', SUMMER)).toBe(-240);
  });

  it('returns null for a zone it cannot resolve, rather than assuming UTC', () => {
    // Assuming UTC would look exactly like a successful conversion, which is the
    // silent-wrong-answer shape this whole module is written against.
    expect(zoneOffsetMinutes('Mars/Olympus_Mons', WINTER)).toBeNull();
  });
});

describe('a UTC trigger is passed through untouched', () => {
  it.each(['UTC', 'Etc/UTC', 'GMT', 'utc'])('%s does not shift', zone => {
    const result = shiftCronToUtc('0 9 * * *', zone, WINTER);
    expect(result).toEqual({ cron: '0 9 * * *', shifted: false });
  });

  it('treats an absent zone as UTC', () => {
    // What Cronsole writes on everything it creates, and the common case.
    expect(shiftCronToUtc('30 6 * * 1', null, WINTER).cron).toBe('30 6 * * 1');
  });

  it('normalizes whitespace on the way through', () => {
    expect(shiftCronToUtc('0   9  *  * *', 'UTC', WINTER).cron).toBe('0 9 * * *');
  });
});

describe('a fixed clock time moves', () => {
  it('shifts west-of-UTC forward', () => {
    // 09:00 New York in January is 14:00 UTC.
    const result = shiftCronToUtc('0 9 * * *', 'America/New_York', WINTER);
    expect(result).toEqual({ cron: '0 14 * * *', shifted: true });
  });

  it('shifts the same expression differently in summer, and says so by moving', () => {
    // 09:00 New York in July is 13:00 UTC. No single cron says both, which is
    // why the platform's original pair is kept in metadata rather than discarded.
    expect(shiftCronToUtc('0 9 * * *', 'America/New_York', SUMMER).cron).toBe('0 13 * * *');
  });

  it('shifts east-of-UTC backward', () => {
    // 09:00 Tokyo is 00:00 UTC the same day.
    expect(shiftCronToUtc('0 9 * * *', 'Asia/Tokyo', WINTER).cron).toBe('0 0 * * *');
  });

  it('carries a partial-hour offset into the minute field', () => {
    // 09:30 Kolkata is 04:00 UTC.
    expect(shiftCronToUtc('30 9 * * *', 'Asia/Kolkata', WINTER).cron).toBe('0 4 * * *');
  });
});

describe('crossing midnight rolls the weekday', () => {
  it('rolls Monday back to Sunday when the shift goes backwards past midnight', () => {
    // 09:00 Monday in Tokyo is 00:00 Monday UTC — no roll. 08:00 Monday Tokyo is
    // 23:00 **Sunday** UTC, which is the case a naive shift gets wrong by a day.
    const result = shiftCronToUtc('0 8 * * 1', 'Asia/Tokyo', WINTER);
    expect(result).toEqual({ cron: '0 23 * * 0', shifted: true });
  });

  it('rolls forward across the week boundary', () => {
    // 22:00 Sunday in New York (January) is 03:00 Monday UTC.
    expect(shiftCronToUtc('0 22 * * 0', 'America/New_York', WINTER).cron).toBe('0 3 * * 1');
  });

  it('rolls every day in a list, and de-duplicates', () => {
    const result = shiftCronToUtc('0 8 * * 1,2', 'Asia/Tokyo', WINTER);
    expect(result.cron).toBe('0 23 * * 0,1');
  });

  it('reads both of cron\'s spellings of Sunday', () => {
    // `7` and `0` are the same day, and a shift that treated 7 as an eighth day
    // would emit a field no scheduler fires on.
    expect(shiftCronToUtc('0 8 * * 7', 'Asia/Tokyo', WINTER).cron).toBe('0 23 * * 6');
  });
});

describe('an offset-invariant expression is returned unchanged', () => {
  it('leaves a per-minute expression alone', () => {
    expect(shiftCronToUtc('* * * * *', 'Asia/Tokyo', WINTER)).toEqual({ cron: '* * * * *', shifted: false });
  });

  it('leaves hourly-at-a-fixed-minute alone for a whole-hour zone', () => {
    expect(shiftCronToUtc('15 * * * *', 'Asia/Tokyo', WINTER)).toEqual({ cron: '15 * * * *', shifted: false });
  });

  it('but moves the minute for a partial-hour zone', () => {
    // The one case where "hourly" is not offset-invariant.
    expect(shiftCronToUtc('15 * * * *', 'Asia/Kolkata', WINTER).cron).toBe('45 * * * *');
  });
});

describe('a refusal is null with a reason, never a plausible cron', () => {
  const refused = (cron: string, zone: string) => {
    const result = shiftCronToUtc(cron, zone, WINTER);
    expect(result.cron).toBeNull();
    expect(result.shifted).toBe(false);
    // The #60 rule, mechanized: declining and answering "no problem here" must
    // not be the same code path, so a null cron always carries a sentence.
    expect(result.reason).toBeTruthy();
    return result.reason!;
  };

  it('refuses a multi-value hour rather than enumerating the shift', () => {
    expect(refused('0 9-17 * * 1-5', 'America/New_York')).toMatch(/more than one hour/);
  });

  it('refuses a stepped hour for the same reason', () => {
    expect(refused('0 */2 * * *', 'Asia/Tokyo')).toMatch(/more than one hour/);
  });

  it('refuses a midnight-crossing shift that pins a day of the month', () => {
    // "The 1st at 04:00 in Tokyo" is the 31st of the previous month in UTC, and
    // a 5-field cron cannot say that. A plausible `0 19 1 1 *` would fire on the
    // wrong date every year, silently.
    expect(refused('0 4 1 1 *', 'Asia/Tokyo')).toMatch(/crosses midnight/);
  });

  it('refuses a partial-hour shift of a multi-value minute field', () => {
    expect(refused('0,30 * * * *', 'Asia/Kolkata')).toMatch(/part of an hour/);
  });

  it('refuses a zone it cannot resolve rather than assuming UTC', () => {
    expect(refused('0 9 * * *', 'Nowhere/Fictional')).toMatch(/cannot resolve/);
  });

  it('refuses a day-of-week field it cannot read well enough to roll', () => {
    expect(refused('0 8 * * MON', 'Asia/Tokyo')).toMatch(/day-of-week/);
  });

  it('refuses anything that is not five fields', () => {
    expect(refused('0 9 * *', 'UTC')).toMatch(/5-field/);
  });
});
