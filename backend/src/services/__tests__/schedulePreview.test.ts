import { describe, it, expect } from 'vitest';
import { PlatformType } from '@prisma/client';
import { previewSchedule, PREVIEW_RUN_COUNT } from '../schedulePreview.js';

// A fixed reference instant so every expectation below is a date, not a range.
const FROM = new Date('2026-07-31T12:00:00.000Z');
const WINDOWS = PlatformType.WINDOWS_TASK_SCHEDULER;

describe('previewSchedule', () => {
  it('rejects a non-cron with score 0 rather than throwing', () => {
    const result = previewSchedule(WINDOWS, 'not a cron', FROM);

    expect(result.score).toBe(0);
    expect(result.warnings[0]).toMatch(/5-field cron/);
    expect(result.requestedRuns).toEqual([]);
    expect(result.effectiveRuns).toBeNull();
    expect(result.diverges).toBe(false);
  });

  it('lists the next five occurrences of an exact daily cron', () => {
    const result = previewSchedule(WINDOWS, '0 9 * * *', FROM);

    expect(result.score).toBe(1);
    expect(result.lossy).toBeUndefined();
    expect(result.requestedRuns).toHaveLength(PREVIEW_RUN_COUNT);
    expect(result.requestedRuns[0]).toBe('2026-08-01T09:00:00.000Z'); // 09:00 today already passed
    expect(result.requestedRuns[4]).toBe('2026-08-05T09:00:00.000Z');
  });

  it('does not report divergence when the trigger is an exact reading of the cron', () => {
    const result = previewSchedule(WINDOWS, '0 9 * * *', FROM);

    expect(result.effectiveRuns).toEqual(result.requestedRuns);
    expect(result.diverges).toBe(false);
  });

  it('keeps every weekday of a multi-day cron — the Monday-only bug in date form', () => {
    // `parseInt('1-5')` is 1, which once silently produced a Monday-only trigger
    // at confidence 1.0. Five consecutive weekdays in the run list is the
    // reading of that fix a person can actually check.
    const result = previewSchedule(WINDOWS, '0 9 * * 1-5', FROM);

    expect(result.score).toBe(1);
    expect(result.requestedRuns).toEqual([
      '2026-08-03T09:00:00.000Z', // Mon
      '2026-08-04T09:00:00.000Z', // Tue
      '2026-08-05T09:00:00.000Z', // Wed
      '2026-08-06T09:00:00.000Z', // Thu
      '2026-08-07T09:00:00.000Z'  // Fri
    ]);
    expect(result.diverges).toBe(false);
  });

  it('SHOWS THE #14 TRAP: a once-a-year cron actually runs hourly', () => {
    // The entire reason this feature exists. `0 4 1 1 *` is the schedule someone
    // picks *because it cannot fire during a test* — and Windows registers a
    // fixed hourly trigger that fires ~8,760 times a year instead.
    const result = previewSchedule(WINDOWS, '0 4 1 1 *', FROM);

    expect(result.lossy).toBe('replaced');
    expect(result.requestedRuns[0]).toBe('2027-01-01T04:00:00.000Z'); // once, next year

    expect(result.effectiveRuns).not.toBeNull();
    expect(result.effectiveRuns![0]).toBe('2026-07-31T13:00:00.000Z'); // an hour from now
    expect(result.effectiveRuns![4]).toBe('2026-07-31T17:00:00.000Z'); // and hourly after that
    expect(result.diverges).toBe(true);
  });

  it('reports a cron that has no upcoming runs at all, keeping any it did find', () => {
    // February 30th never comes. The honest answer is an empty list, not a throw
    // and not a fabricated date.
    const result = previewSchedule(WINDOWS, '0 0 30 2 *', FROM);

    expect(result.requestedRuns).toEqual([]);
    // It still converts (to the hourly fallback), so the tester can say the
    // machine will run this hourly despite the cron meaning "never".
    expect(result.lossy).toBe('replaced');
    expect(result.effectiveRuns).not.toBeNull();
    expect(result.diverges).toBe(true);
  });

  it('treats a non-Windows platform as running the cron itself — nothing to diverge from', () => {
    const result = previewSchedule(PlatformType.TASKHUB_NATIVE, '0 9 * * *', FROM);

    expect(result.score).toBe(1);
    expect(result.trigger).toBeNull();
    expect(result.requestedRuns).toHaveLength(PREVIEW_RUN_COUNT);
    expect(result.effectiveRuns).toBeNull(); // NativeScheduler runs this exact expression
    expect(result.diverges).toBe(false);
  });

  it('offers NO dates for an approximated step, because they could only be guessed', () => {
    // `*/7` converts to a Windows repetition of PT7M, and the reverse converter
    // maps that straight back to `*/7` — so a round-trip would report the two
    // schedules as identical when the drift is the entire point. They are not:
    // Windows repeats continuously from a start boundary (…:56, then 1:03) while
    // cron restarts each hour (…:56, then 1:00). Simulating that properly means
    // writing a second scheduler, so the drift stays stated in words and no
    // dates are shown. Silence beats a plausible wrong answer here.
    const result = previewSchedule(WINDOWS, '*/7 * * * *', FROM);

    expect(result.lossy).toBe('approximated');
    expect(result.warnings.join(' ')).toMatch(/7/); // the drift is still stated
    expect(result.requestedRuns).toHaveLength(PREVIEW_RUN_COUNT);
    expect(result.effectiveRuns).toBeNull();
    expect(result.diverges).toBe(false); // "not claimed", not "not divergent"
  });

  it('still shows dates for an even step, where the two agree exactly', () => {
    const result = previewSchedule(WINDOWS, '*/15 * * * *', FROM);

    expect(result.score).toBe(1);
    expect(result.lossy).toBeUndefined();
    expect(result.effectiveRuns).toEqual(result.requestedRuns);
  });

  it('is anchored to the caller\'s instant, so the dates are reproducible', () => {
    const a = previewSchedule(WINDOWS, '0 9 * * *', new Date('2026-07-31T12:00:00.000Z'));
    const b = previewSchedule(WINDOWS, '0 9 * * *', new Date('2026-08-01T12:00:00.000Z'));

    expect(a.requestedRuns[0]).toBe('2026-08-01T09:00:00.000Z');
    expect(b.requestedRuns[0]).toBe('2026-08-02T09:00:00.000Z');
  });
});
