import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { describeCron, taskCron, taskSchedulePreview } from '../schedule';

// The frontend has no @types/node; declare the sliver of `process` the TZ-pinned
// tests need so the app build (tsc -b, which includes test files) stays clean.
declare const process: { env: Record<string, string | undefined> };

// Fixed instants so every offset is deterministic. January is standard time in
// both hemispheres' northern zones used here (EST −05:00, PST −08:00); July is
// daylight time (EDT −04:00, PDT −07:00) — both are exercised, because a
// conversion that only works in one half of the year is the bug this layer is
// most likely to grow.
const JAN = new Date('2024-01-15T12:00:00Z'); // a Monday
const JUL = new Date('2024-07-15T12:00:00Z'); // a Monday

describe('describeCron — UTC', () => {
  it('describes daily schedules', () => {
    expect(describeCron('0 3 * * *')).toBe('Daily at 3:00 AM UTC');
    expect(describeCron('30 15 * * *')).toBe('Daily at 3:30 PM UTC');
    expect(describeCron('0 0 * * *')).toBe('Daily at 12:00 AM UTC');
  });

  it('describes hourly and every-N-hour schedules', () => {
    expect(describeCron('0 * * * *')).toBe('Hourly at :00');
    expect(describeCron('15 * * * *')).toBe('Hourly at :15');
    expect(describeCron('0 */6 * * *')).toBe('Every 6 hours at :00');
    expect(describeCron('* */2 * * *')).toBe('Every 2 hours');
  });

  it('describes every-N-minute schedules', () => {
    expect(describeCron('*/5 * * * *')).toBe('Every 5 minutes');
    expect(describeCron('*/1 * * * *')).toBe('Every 1 minute');
  });

  it('describes weekly schedules', () => {
    expect(describeCron('0 9 * * 1')).toBe('Weekly on Monday at 9:00 AM UTC');
    expect(describeCron('0 9 * * 1,3,5')).toBe('Weekly on Monday, Wednesday, Friday at 9:00 AM UTC');
  });

  // Added with the schedule picker: monthly became a one-click choice, and an
  // offered schedule that reads back as a raw expression looks like the app
  // failed to understand what it just built.
  it('describes a day-of-month schedule', () => {
    expect(describeCron('0 3 1 * *')).toBe('Monthly on the 1st at 3:00 AM UTC');
    expect(describeCron('30 14 22 * *')).toBe('Monthly on the 22nd at 2:30 PM UTC');
  });

  it('returns null for expressions it cannot describe confidently', () => {
    expect(describeCron('0 3 * 6 *')).toBeNull(); // specific month
    expect(describeCron('0 3 1 * 1')).toBeNull(); // day-of-month AND weekday
    expect(describeCron('not a cron')).toBeNull();
    expect(describeCron('0 3 * *')).toBeNull(); // 4 fields
    expect(describeCron('')).toBeNull();
    expect(describeCron(null)).toBeNull();
    expect(describeCron(undefined)).toBeNull();
  });
});

describe('describeCron — named zone conversion', () => {
  const PACIFIC = 'America/Los_Angeles';

  it('reads a daily UTC time in Pacific, naming the zone', () => {
    // The defect this whole layer exists for: a template scheduled `0 8 * * *`
    // is 8 AM UTC, which is the middle of the night in Pacific.
    expect(describeCron('0 8 * * *', PACIFIC, JAN)).toBe('Daily at 12:00 AM PST');
    expect(describeCron('0 16 * * *', PACIFIC, JAN)).toBe('Daily at 8:00 AM PST');
  });

  it('tracks daylight saving rather than assuming a fixed offset', () => {
    // Same expression, six months apart: PST is −08:00, PDT is −07:00.
    expect(describeCron('0 15 * * *', PACIFIC, JAN)).toBe('Daily at 7:00 AM PST');
    expect(describeCron('0 15 * * *', PACIFIC, JUL)).toBe('Daily at 8:00 AM PDT');
  });

  it('rolls the weekday back when the conversion crosses midnight', () => {
    // Mon 02:00 UTC is Sunday evening in Pacific.
    expect(describeCron('0 2 * * 1', PACIFIC, JAN)).toBe('Weekly on Sunday at 6:00 PM PST');
  });

  it('rolls every day of a multi-day weekly schedule', () => {
    expect(describeCron('0 2 * * 1,3,5', PACIFIC, JAN)).toBe(
      'Weekly on Sunday, Tuesday, Thursday at 6:00 PM PST'
    );
  });

  it('keeps a same-day conversion on the same day', () => {
    expect(describeCron('0 18 * * 3', PACIFIC, JAN)).toBe('Weekly on Wednesday at 10:00 AM PST');
  });

  it('leaves interval schedules zone-independent and unlabelled', () => {
    expect(describeCron('*/15 * * * *', PACIFIC, JAN)).toBe('Every 15 minutes');
    expect(describeCron('0 * * * *', PACIFIC, JAN)).toBe('Hourly at :00');
  });

  it('still labels UTC mode with UTC', () => {
    expect(describeCron('0 3 * * *', 'utc', JAN)).toBe('Daily at 3:00 AM UTC');
    expect(describeCron('0 3 * * *', undefined, JAN)).toBe('Daily at 3:00 AM UTC');
  });
});

describe('taskCron — where the schedule lives', () => {
  it('prefers the column, then the two metadata spellings', () => {
    expect(taskCron({ schedule: '0 15 * * *' })).toBe('0 15 * * *');
    expect(taskCron({ metadata: { schedule: '0 9 * * 1' } })).toBe('0 9 * * 1');
    expect(taskCron({ metadata: { cron: '*/5 * * * *' } })).toBe('*/5 * * * *');
    expect(taskCron({ schedule: '0 1 * * *', metadata: { cron: '0 2 * * *' } })).toBe('0 1 * * *');
  });

  it('treats blank and non-string values as absent', () => {
    expect(taskCron({})).toBeNull();
    expect(taskCron({ schedule: '   ' })).toBeNull();
    expect(taskCron({ metadata: { schedule: 42 } })).toBeNull();
  });
});

describe('taskSchedulePreview — the card line', () => {
  const PACIFIC = 'America/Los_Angeles';

  it('describes a recognizable cron in the reader’s zone', () => {
    const p = taskSchedulePreview({ schedule: '0 15 * * *' }, PACIFIC, JUL);
    expect(p).toEqual({ kind: 'human', text: 'Daily at 8:00 AM PDT', cron: '0 15 * * *' });
  });

  it('falls back to the raw expression rather than guessing at an odd shape', () => {
    // A range in the hour field has no shape describeCron will name.
    const p = taskSchedulePreview({ schedule: '0 9-17 * * 1-5' }, PACIFIC, JUL);
    expect(p).toEqual({ kind: 'cron', text: '0 9-17 * * 1-5', cron: '0 9-17 * * 1-5' });
  });

  /**
   * A monthly schedule keeps the zone marker honest in both directions.
   * `0 20 15 * *` shifts cleanly into Pacific, so it is described there.
   * `0 4 1 * *` would cross midnight, and cron cannot express the resulting
   * date — `utcCronToZone` therefore *declines*, and the reading must then say
   * UTC rather than putting a Pacific label on numbers that never moved.
   */
  it('names the zone it actually described a monthly schedule in', () => {
    expect(taskSchedulePreview({ schedule: '0 20 15 * *' }, PACIFIC, JUL).text).toBe(
      'Monthly on the 15th at 1:00 PM PDT'
    );
    expect(taskSchedulePreview({ schedule: '0 4 1 * *' }, PACIFIC, JUL).text).toBe(
      'Monthly on the 1st at 4:00 AM UTC'
    );
  });

  it('says so when there is no cron at all, instead of rendering blank', () => {
    // A boot/logon/event-triggered Windows task: the agent reports no cron.
    const p = taskSchedulePreview({ metadata: { trigger: null } }, PACIFIC, JUL);
    expect(p).toEqual({ kind: 'none', text: 'No cron schedule', cron: null });
  });
});

describe('describeCron — machine local', () => {
  const origTZ = process.env.TZ;
  beforeAll(() => { process.env.TZ = 'America/New_York'; });
  afterAll(() => { process.env.TZ = origTZ; });

  it('follows the machine zone and names it', () => {
    // 03:00 UTC = 22:00 (10:00 PM) EST.
    expect(describeCron('0 3 * * *', 'local', JAN)).toBe('Daily at 10:00 PM EST');
  });
});
