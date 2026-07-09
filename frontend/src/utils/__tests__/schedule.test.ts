import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { describeCron } from '../schedule';

// The frontend has no @types/node; declare the sliver of `process` the TZ-pinned
// tests need so the app build (tsc -b, which includes test files) stays clean.
declare const process: { env: Record<string, string | undefined> };

describe('describeCron', () => {
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

  it('returns null for expressions it cannot describe confidently', () => {
    expect(describeCron('0 3 1 * *')).toBeNull(); // day-of-month
    expect(describeCron('0 3 * 6 *')).toBeNull(); // specific month
    expect(describeCron('not a cron')).toBeNull();
    expect(describeCron('0 3 * *')).toBeNull(); // 4 fields
    expect(describeCron('')).toBeNull();
    expect(describeCron(null)).toBeNull();
    expect(describeCron(undefined)).toBeNull();
  });
});

describe('describeCron — local timezone conversion', () => {
  // Pin the runner to a fixed offset so the conversion is deterministic.
  // America/New_York in January = EST (UTC-5, no DST).
  const NOW = new Date('2024-01-15T12:00:00Z'); // a Monday
  const origTZ = process.env.TZ;
  beforeAll(() => { process.env.TZ = 'America/New_York'; });
  afterAll(() => { process.env.TZ = origTZ; });

  it('converts a daily UTC time to local, dropping the UTC label', () => {
    // 03:00 UTC = 22:00 (10:00 PM) EST
    expect(describeCron('0 3 * * *', 'local', NOW)).toBe('Daily at 10:00 PM');
  });

  it('rolls the weekday back a day when the local time crosses midnight', () => {
    // Mon 02:00 UTC = Sun 21:00 (9:00 PM) EST
    expect(describeCron('0 2 * * 1', 'local', NOW)).toBe('Weekly on Sunday at 9:00 PM');
  });

  it('keeps a same-day weekly conversion on the same day', () => {
    // Wed 18:00 UTC = Wed 13:00 (1:00 PM) EST
    expect(describeCron('0 18 * * 3', 'local', NOW)).toBe('Weekly on Wednesday at 1:00 PM');
  });

  it('converts each day of a multi-day weekly schedule', () => {
    // 02:00 UTC on Mon/Wed/Fri = 21:00 EST on Sun/Tue/Thu
    expect(describeCron('0 2 * * 1,3,5', 'local', NOW)).toBe(
      'Weekly on Sunday, Tuesday, Thursday at 9:00 PM'
    );
  });

  it('still labels UTC mode with UTC (unchanged)', () => {
    expect(describeCron('0 3 * * *', 'utc', NOW)).toBe('Daily at 3:00 AM UTC');
    expect(describeCron('0 3 * * *', undefined, NOW)).toBe('Daily at 3:00 AM UTC');
  });

  it('leaves interval schedules timezone-independent', () => {
    expect(describeCron('*/15 * * * *', 'local', NOW)).toBe('Every 15 minutes');
    expect(describeCron('0 * * * *', 'local', NOW)).toBe('Hourly at :00');
  });
});
