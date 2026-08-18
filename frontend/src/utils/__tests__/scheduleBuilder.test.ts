import { describe, it, expect } from 'vitest';
import {
  cronToShape,
  shapeToCron,
  withKind,
  shapeTime,
  fromTimeValue,
  toTimeValue,
  ordinalDay,
  type ScheduleShape
} from '../scheduleBuilder';

describe('cronToShape', () => {
  it('reads the five shapes the picker can hold', () => {
    expect(cronToShape('*/15 * * * *')).toEqual({ kind: 'minutes', every: 15 });
    expect(cronToShape('0 * * * *')).toEqual({ kind: 'hours', every: 1, minute: 0 });
    expect(cronToShape('30 */6 * * *')).toEqual({ kind: 'hours', every: 6, minute: 30 });
    expect(cronToShape('0 8 * * *')).toEqual({ kind: 'daily', hour: 8, minute: 0 });
    expect(cronToShape('0 9 * * 1-5')).toEqual({
      kind: 'weekly',
      days: [1, 2, 3, 4, 5],
      hour: 9,
      minute: 0
    });
    expect(cronToShape('0 9 1 * *')).toEqual({ kind: 'monthly', day: 1, hour: 9, minute: 0 });
  });

  // The bug the backend converter documents, in a second implementation: a
  // whole-field parseInt turns "every weekday" into "Mondays only" and looks
  // completely confident doing it.
  it('parses every weekday form, and folds cron’s two Sundays into one', () => {
    expect(cronToShape('0 9 * * 1,3,5')).toMatchObject({ days: [1, 3, 5] });
    expect(cronToShape('0 9 * * 1-3,5')).toMatchObject({ days: [1, 2, 3, 5] });
    expect(cronToShape('0 9 * * 7')).toMatchObject({ days: [0] });
    expect(cronToShape('0 9 * * 0,7')).toMatchObject({ days: [0] });
  });

  // `null` is what makes the simple editor *unavailable* rather than wrong. A
  // nearest-match here would rewrite a schedule the user only opened to read.
  it('returns null for anything the picker cannot hold, never a near miss', () => {
    expect(cronToShape('0 9-17 * * 1-5')).toBeNull(); // hour range
    expect(cronToShape('0,30 9 * * *')).toBeNull(); // minute list
    expect(cronToShape('0 9 1 1 *')).toBeNull(); // pinned to a month
    expect(cronToShape('0 9 1 * 1')).toBeNull(); // dom AND dow is cron's OR
    expect(cronToShape('0 9 L * *')).toBeNull(); // non-standard
    expect(cronToShape('0 9 * *')).toBeNull(); // four fields
    expect(cronToShape('0 99 * * *')).toBeNull(); // out of range
    expect(cronToShape('0 9 0 * *')).toBeNull(); // there is no 0th of the month
  });
});

describe('shapeToCron', () => {
  it('compiles each shape', () => {
    expect(shapeToCron({ kind: 'minutes', every: 15 })).toBe('*/15 * * * *');
    expect(shapeToCron({ kind: 'hours', every: 6, minute: 30 })).toBe('30 */6 * * *');
    expect(shapeToCron({ kind: 'daily', hour: 8, minute: 5 })).toBe('5 8 * * *');
    expect(shapeToCron({ kind: 'weekly', days: [5, 1], hour: 9, minute: 0 })).toBe('0 9 * * 1,5');
    expect(shapeToCron({ kind: 'monthly', day: 15, hour: 9, minute: 0 })).toBe('0 9 15 * *');
  });

  // `*/1` is legal and reads as clutter; hourly-at-:30 is `30 * * * *`, which
  // is also the one form the Windows converter matches exactly.
  it('collapses an interval of one to the plain form', () => {
    expect(shapeToCron({ kind: 'minutes', every: 1 })).toBe('* * * * *');
    expect(shapeToCron({ kind: 'hours', every: 1, minute: 30 })).toBe('30 * * * *');
  });

  // Unticking the last day must not produce a four-field expression — the API
  // would then answer a checkbox with a message about cron syntax.
  it('never emits an empty weekday field', () => {
    expect(shapeToCron({ kind: 'weekly', days: [], hour: 9, minute: 0 }).split(/\s+/)).toHaveLength(
      5
    );
  });
});

describe('the round trip', () => {
  const cases = [
    '*/15 * * * *',
    '* * * * *',
    '0 * * * *',
    '30 */6 * * *',
    '0 8 * * *',
    '0 9 * * 1,2,3,4,5',
    '0 22 * * 0',
    '0 9 15 * *'
  ];

  it('is stable in its canonical form', () => {
    for (const cron of cases) {
      const shape = cronToShape(cron);
      expect(shape, cron).not.toBeNull();
      expect(shapeToCron(shape as ScheduleShape), cron).toBe(cron);
    }
  });

  // Not byte-identical, and the component depends on knowing that: a range
  // reads back as a list. Compiling on mount would dirty every form merely
  // opened and rewrite the stored expression of a task nobody edited.
  it('preserves meaning but not spelling for a weekday range', () => {
    const shape = cronToShape('0 9 * * 1-5') as ScheduleShape;
    expect(shapeToCron(shape)).toBe('0 9 * * 1,2,3,4,5');
    expect(cronToShape(shapeToCron(shape))).toEqual(shape);
  });
});

describe('withKind', () => {
  it('keeps the clock time the new kind can hold', () => {
    const daily: ScheduleShape = { kind: 'daily', hour: 14, minute: 45 };
    expect(withKind(daily, 'weekly')).toEqual({
      kind: 'weekly',
      days: [1, 2, 3, 4, 5],
      hour: 14,
      minute: 45
    });
    expect(withKind(daily, 'monthly')).toEqual({ kind: 'monthly', day: 1, hour: 14, minute: 45 });
    expect(withKind(daily, 'hours')).toEqual({ kind: 'hours', every: 1, minute: 45 });
  });

  it('is identity for the kind it already is, so no keystroke is lost', () => {
    const weekly: ScheduleShape = { kind: 'weekly', days: [0], hour: 22, minute: 0 };
    expect(withKind(weekly, 'weekly')).toBe(weekly);
  });

  it('offers a sensible time when coming from a shape that had none', () => {
    expect(withKind({ kind: 'minutes', every: 15 }, 'daily')).toEqual({
      kind: 'daily',
      hour: 9,
      minute: 0
    });
  });
});

describe('helpers', () => {
  it('reads and writes an <input type="time"> value', () => {
    expect(toTimeValue(9, 5)).toBe('09:05');
    expect(fromTimeValue('09:05')).toEqual({ hour: 9, minute: 5 });
    expect(fromTimeValue('23:59:00')).toEqual({ hour: 23, minute: 59 });
    expect(fromTimeValue('')).toBeNull();
    expect(fromTimeValue('25:00')).toBeNull();
  });

  it('reports the clock time a shape carries', () => {
    expect(shapeTime({ kind: 'minutes', every: 5 })).toBeNull();
    expect(shapeTime({ kind: 'hours', every: 2, minute: 15 })).toEqual({ hour: 0, minute: 15 });
    expect(shapeTime({ kind: 'daily', hour: 6, minute: 0 })).toEqual({ hour: 6, minute: 0 });
  });

  it('suffixes a day of the month', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(ordinalDay)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '23rd',
      '31st'
    ]);
  });
});
