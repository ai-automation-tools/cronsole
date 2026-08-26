import { describe, it, expect } from 'vitest';
import {
  bucketByDay,
  buildMonthGrid,
  buildWeekGrid,
  dayKey,
  groupByTask,
  parseDayKey,
  rangeFor,
  stepDayKey,
  stepMonth,
  WEEKDAY_LABELS
} from '../calendar';

describe('buildMonthGrid', () => {
  it('is always six weeks, so the page does not change height on a month step', () => {
    // February 2026 starts on a Sunday and has 28 days — it fits in exactly four
    // weeks, and a grid sized to fit would be two rows shorter than March's.
    expect(buildMonthGrid(2026, 1)).toHaveLength(42);
    expect(buildMonthGrid(2026, 2)).toHaveLength(42);
    expect(buildMonthGrid(2026, 7)).toHaveLength(42);
  });

  it('starts on the Sunday on or before the 1st', () => {
    // March 2026 starts on a Sunday, so there is no lead.
    expect(buildMonthGrid(2026, 2)[0].key).toBe('2026-03-01');
    // August 2026 starts on a Saturday — six leading cells from July.
    const august = buildMonthGrid(2026, 7);
    expect(august[0].key).toBe('2026-07-26');
    expect(august[0].weekday).toBe(0);
  });

  it('marks the days that spill either side, and does not blank them', () => {
    // They are real days and their runs are real. Dimmer, not absent.
    const august = buildMonthGrid(2026, 7);
    expect(august[0].inFocus).toBe(false);
    expect(august.find(c => c.key === '2026-08-01')!.inFocus).toBe(true);
    expect(august[41].inFocus).toBe(false);
    expect(august.filter(c => c.inFocus)).toHaveLength(31);
  });

  it('steps by civil days, not by 24-hour instants', () => {
    // 2026-03-08 is the US DST spring-forward. Local-date arithmetic would land
    // the following cell on 23:00 of the same day and repeat it; UTC has no
    // transitions, which is why a calendar is built on it.
    const march = buildMonthGrid(2026, 2);
    const keys = march.slice(6, 10).map(c => c.key);
    expect(keys).toEqual(['2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10']);
  });

  it('wraps a year at the edges', () => {
    const january = buildMonthGrid(2026, 0);
    expect(january[0].year).toBe(2025);
    expect(january[0].month).toBe(11);
  });
});

describe('buildWeekGrid', () => {
  it('is the seven days of the containing week, Sunday first', () => {
    const week = buildWeekGrid('2026-03-11');
    expect(week.map(c => c.key)).toEqual([
      '2026-03-08', '2026-03-09', '2026-03-10',
      '2026-03-11', '2026-03-12', '2026-03-13', '2026-03-14'
    ]);
  });

  it('has every cell in focus — a week is not about a month', () => {
    // A week straddling two months would otherwise dim half of itself for a
    // reason that means nothing in this mode.
    expect(buildWeekGrid('2026-03-31').every(c => c.inFocus)).toBe(true);
  });
});

describe('stepping', () => {
  it('steps months across a year boundary', () => {
    expect(stepMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
    expect(stepMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
  });

  it('steps day keys by whole days', () => {
    expect(stepDayKey('2026-02-28', 1)).toBe('2026-03-01');
    expect(stepDayKey('2026-03-11', 7)).toBe('2026-03-18');
    expect(stepDayKey('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('round-trips a day key', () => {
    expect(parseDayKey(dayKey(2026, 2, 9))).toEqual({ year: 2026, month: 2, day: 9 });
  });
});

describe('rangeFor', () => {
  it('pads a day either side of the grid', () => {
    // The grid's first cell begins at *local* midnight, and converting that to
    // an instant needs an offset that is a function of the instant. Padding is
    // how that circularity is avoided rather than reasoned about.
    const range = rangeFor(buildMonthGrid(2026, 2));
    expect(range.from.toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-04-13T00:00:00.000Z');
  });

  it('stays inside the window one request is allowed to expand', () => {
    // The route refuses more than 70 days. A six-week grid plus padding is 45,
    // and this pins the headroom rather than leaving it to be rediscovered by a
    // 400 on somebody's screen.
    const range = rangeFor(buildMonthGrid(2026, 2));
    const days = (range.to.getTime() - range.from.getTime()) / 86_400_000;
    expect(days).toBeLessThanOrEqual(70);
  });
});

describe('bucketByDay', () => {
  const runs = [
    { taskId: 'a', occurrences: ['2026-03-09T16:00:00.000Z', '2026-03-10T16:00:00.000Z'] },
    { taskId: 'b', occurrences: ['2026-03-09T02:00:00.000Z'] }
  ];

  it('buckets by the day the reader is in, not by the day UTC is in', () => {
    // 02:00 UTC on the 9th is still the *evening of the 8th* in Los Angeles.
    // This is the whole reason the calendar takes a zone at all, and getting it
    // wrong puts a task on a day the card beside it does not agree with.
    const utc = bucketByDay(runs, 'utc');
    expect([...utc.keys()].sort()).toEqual(['2026-03-09', '2026-03-10']);

    const pacific = bucketByDay(runs, 'America/Los_Angeles');
    expect([...pacific.keys()].sort()).toEqual(['2026-03-08', '2026-03-09', '2026-03-10']);
    expect(pacific.get('2026-03-08')!.map(r => r.taskId)).toEqual(['b']);
  });

  it('sorts each day ascending', () => {
    const out = bucketByDay(
      [{ taskId: 'a', occurrences: ['2026-03-09T18:00:00.000Z', '2026-03-09T06:00:00.000Z'] }],
      'utc'
    );
    expect(out.get('2026-03-09')!.map(r => r.at.toISOString())).toEqual([
      '2026-03-09T06:00:00.000Z',
      '2026-03-09T18:00:00.000Z'
    ]);
  });

  it('drops an unparseable instant rather than bucketing it as epoch zero', () => {
    // A bad stamp landing on 1970 would put a chip on a cell no user can see and
    // silently change the counts on the ones they can.
    const out = bucketByDay([{ taskId: 'a', occurrences: ['not a date'] }], 'utc');
    expect(out.size).toBe(0);
  });
});

describe('groupByTask', () => {
  const at = (iso: string) => new Date(iso);

  it('collapses a task that runs several times into one entry with a count', () => {
    // Six runs of one task is one thing that happened six times, not six rows in
    // a cell that has room for three.
    const entries = groupByTask([
      { taskId: 'a', at: at('2026-03-09T06:00:00.000Z') },
      { taskId: 'b', at: at('2026-03-09T07:00:00.000Z') },
      { taskId: 'a', at: at('2026-03-09T18:00:00.000Z') }
    ]);
    expect(entries.map(e => [e.taskId, e.count])).toEqual([['a', 2], ['b', 1]]);
    expect(entries[0].first.toISOString()).toBe('2026-03-09T06:00:00.000Z');
    expect(entries[0].times).toHaveLength(2);
  });

  it('orders entries by their first run', () => {
    const entries = groupByTask([
      { taskId: 'late', at: at('2026-03-09T22:00:00.000Z') },
      { taskId: 'early', at: at('2026-03-09T01:00:00.000Z') }
    ]);
    expect(entries.map(e => e.taskId)).toEqual(['early', 'late']);
  });
});

describe('WEEKDAY_LABELS', () => {
  it('is seven labels starting at Sunday, matching the grid', () => {
    // The header row and the cells are built from two different mechanisms, so
    // an off-by-one here would silently shift every chip a column.
    expect(WEEKDAY_LABELS).toHaveLength(7);
    expect(buildMonthGrid(2026, 2)[0].weekday).toBe(0);
  });
});
