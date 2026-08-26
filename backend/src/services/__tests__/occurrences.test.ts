import { describe, it, expect } from 'vitest';
import {
  expandCron,
  expandOccurrences,
  DEFAULT_MAX_PER_TASK,
  type OccurrenceInput
} from '../occurrences.js';

const at = (iso: string) => new Date(iso);
const iso = (d: Date) => d.toISOString();

// A tidy three-day window, so an expectation can list every instant it wants.
const FROM = at('2026-03-01T00:00:00.000Z');
const TO = at('2026-03-04T00:00:00.000Z');

const task = (over: Partial<OccurrenceInput> = {}): OccurrenceInput => ({
  id: 't1',
  schedule: '0 9 * * *',
  metadata: {},
  ...over
});

describe('expandCron', () => {
  it('lists every firing inside the window, ascending', () => {
    const { occurrences } = expandCron('0 9 * * *', FROM, TO);
    expect(occurrences.map(iso)).toEqual([
      '2026-03-01T09:00:00.000Z',
      '2026-03-02T09:00:00.000Z',
      '2026-03-03T09:00:00.000Z'
    ]);
  });

  it('expands in UTC regardless of the machine it runs on', () => {
    // Storage is 5-field cron in UTC (CLAUDE.md §9). Which calendar *day* an
    // instant lands on is the browser's arithmetic; if this walked in the
    // server's local zone the whole conversion layer would have a second,
    // invisible definition sitting under it.
    const { occurrences } = expandCron('30 23 * * *', FROM, TO);
    expect(occurrences.map(iso)).toEqual([
      '2026-03-01T23:30:00.000Z',
      '2026-03-02T23:30:00.000Z',
      '2026-03-03T23:30:00.000Z'
    ]);
  });

  it('excludes `from` and includes `to`', () => {
    // Half-open the other way would double-count the boundary day when a caller
    // pages from one month grid to the next.
    const { occurrences } = expandCron(
      '0 0 * * *',
      at('2026-03-01T00:00:00.000Z'),
      at('2026-03-03T00:00:00.000Z')
    );
    expect(occurrences.map(iso)).toEqual([
      '2026-03-02T00:00:00.000Z',
      '2026-03-03T00:00:00.000Z'
    ]);
  });

  it('refuses anything that is not five fields', () => {
    // cron-parser accepts a six-field form with seconds, which would read the
    // stored string as something other than what every other reader means by it.
    expect(expandCron('0 0 9 * * *', FROM, TO).occurrences).toEqual([]);
    expect(expandCron('0 9 * *', FROM, TO).occurrences).toEqual([]);
  });

  it('returns nothing for an unparseable expression rather than throwing', () => {
    expect(expandCron('not a cron at all', FROM, TO).occurrences).toEqual([]);
  });

  it('stops at the cap and says where it stopped', () => {
    const { occurrences, truncatedAfter } = expandCron('*/5 * * * *', FROM, TO, 10);
    expect(occurrences).toHaveLength(10);
    // `truncatedAfter` is the last instant enumerated, not a boolean: the caller
    // has to know from *where* the answer stops describing the range.
    expect(truncatedAfter && iso(truncatedAfter)).toBe(iso(occurrences[9]));
  });

  it('does not call a complete list truncated', () => {
    // A task whose last firing happens to be the Nth is complete. Reporting it
    // as truncated would put a "not everything is shown" warning over a list
    // that shows everything.
    const { occurrences, truncatedAfter } = expandCron('0 9 * * *', FROM, TO, 3);
    expect(occurrences).toHaveLength(3);
    expect(truncatedAfter).toBeNull();
  });

  it('keeps what it found when the expression runs out mid-walk', () => {
    // February 30th never comes. cron-parser signals that by throwing on
    // `next()`, and "it fires once more and then never again" is a real answer.
    const { occurrences } = expandCron(
      '0 0 29 2 *',
      at('2026-01-01T00:00:00.000Z'),
      at('2026-12-31T00:00:00.000Z')
    );
    expect(occurrences).toEqual([]);
  });
});

describe('expandOccurrences', () => {
  it('places each task under its own id', () => {
    const report = expandOccurrences(
      [task({ id: 'a', schedule: '0 9 * * *' }), task({ id: 'b', schedule: '0 21 * * *' })],
      FROM,
      TO
    );
    expect(report.tasks.map(t => t.taskId)).toEqual(['a', 'b']);
    expect(report.tasks[0].occurrences).toHaveLength(3);
    expect(report.unplaceable).toEqual([]);
  });

  it('reads the cron from metadata when the column is empty', () => {
    // A connector that only writes `metadata.schedule` still produced a
    // scheduled task. A third spelling of "where is the cron" would make the
    // calendar disagree with the line printed on the task's own card.
    const report = expandOccurrences(
      [task({ schedule: null, metadata: { schedule: '0 9 * * *' } })],
      FROM,
      TO
    );
    expect(report.tasks[0].occurrences).toHaveLength(3);
  });

  it('reports a task with no cron rather than dropping it', () => {
    // §9: a refusal to convert must state its reason. Omitting it would put a
    // logon-triggered Windows task in the same bucket as one that simply does
    // not run this month, and the user would conclude their task vanished.
    const report = expandOccurrences([task({ id: 'logon', schedule: null })], FROM, TO);
    expect(report.tasks).toEqual([]);
    expect(report.unplaceable).toEqual([
      { taskId: 'logon', reason: expect.stringContaining('No cron schedule') }
    ]);
  });

  it("uses the connector's own reason when it has one", () => {
    // "Could not read the schedule" and "there is no schedule" are different
    // facts, and only the first is something to go and fix.
    const report = expandOccurrences(
      [task({ id: 'gh', schedule: null, metadata: { scheduleReason: 'Could not parse the workflow yaml' } })],
      FROM,
      TO
    );
    expect(report.unplaceable[0].reason).toBe('Could not parse the workflow yaml');
  });

  it('reports an unreadable expression, and stays silent about one that just does not fire', () => {
    // The pair is the point. Both produce zero occurrences, and only one is a
    // defect — collapsing them is the "declining to answer and answering
    // nothing-here are the same code path" failure §9 names.
    const report = expandOccurrences(
      [
        task({ id: 'broken', schedule: 'every tuesday-ish' }),
        // Valid, and fires in April rather than in this window.
        task({ id: 'quiet', schedule: '0 9 1 4 *' })
      ],
      FROM,
      TO
    );
    expect(report.tasks).toEqual([]);
    expect(report.unplaceable.map(u => u.taskId)).toEqual(['broken']);
    expect(report.unplaceable[0].reason).toContain('every tuesday-ish');
  });

  it('counts the tasks that hit the cap', () => {
    // The number a "not everything below is shown" line needs. Zero has to mean
    // every list is complete, or the caller cannot say so.
    const report = expandOccurrences(
      [task({ id: 'busy', schedule: '*/5 * * * *' }), task({ id: 'daily', schedule: '0 9 * * *' })],
      FROM,
      TO,
      10
    );
    expect(report.truncated).toBe(1);
    expect(report.tasks.find(t => t.taskId === 'busy')!.truncatedAfter).not.toBeNull();
    expect(report.tasks.find(t => t.taskId === 'daily')!.truncatedAfter).toBeNull();
  });

  it('defaults the cap to something a month grid can survive', () => {
    // A five-minute task has 12,096 firings in a six-week grid. The default
    // exists so one careless page load is not a 12,000-entry response.
    const report = expandOccurrences([task({ schedule: '*/5 * * * *' })], FROM, TO);
    expect(report.tasks[0].occurrences).toHaveLength(DEFAULT_MAX_PER_TASK);
    expect(report.truncated).toBe(1);
  });
});
