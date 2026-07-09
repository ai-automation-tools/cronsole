import { describe, it, expect } from 'vitest';
import { describeCron } from '../schedule';

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
