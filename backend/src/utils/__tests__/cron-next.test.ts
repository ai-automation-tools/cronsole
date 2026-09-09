import { describe, it, expect } from 'vitest';
import { computeNextRun } from '../cron-next.js';

describe('computeNextRun', () => {
  it('computes the next daily occurrence in UTC', () => {
    const from = new Date('2026-07-07T07:00:00Z');
    const next = computeNextRun('0 8 * * *', from);
    expect(next?.toISOString()).toBe('2026-07-07T08:00:00.000Z');
  });

  it('rolls to the next day when the time has passed', () => {
    const from = new Date('2026-07-07T09:00:00Z');
    const next = computeNextRun('0 8 * * *', from);
    expect(next?.toISOString()).toBe('2026-07-08T08:00:00.000Z');
  });

  it('computes interval schedules', () => {
    const from = new Date('2026-07-07T10:07:00Z');
    const next = computeNextRun('*/15 * * * *', from);
    expect(next?.toISOString()).toBe('2026-07-07T10:15:00.000Z');
  });

  it('computes weekly schedules', () => {
    // 2026-07-07 is a Tuesday; next Monday 9am is 2026-07-13.
    const from = new Date('2026-07-07T00:00:00Z');
    const next = computeNextRun('0 9 * * 1', from);
    expect(next?.toISOString()).toBe('2026-07-13T09:00:00.000Z');
  });

  it('returns null for invalid expressions', () => {
    expect(computeNextRun('not a cron')).toBeNull();
    expect(computeNextRun('0 8 * *')).toBeNull();
    expect(computeNextRun('')).toBeNull();
  });
});
