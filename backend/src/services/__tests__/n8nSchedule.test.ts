import { describe, it, expect } from 'vitest';
import { readRule, readWorkflowSchedule, resolveZone } from '../n8nSchedule.js';

/**
 * Fixtures are copied from a live n8n instance (2026-10-04), not from the docs.
 * The weekly one is the case that decided the design: its body names an hour
 * and nothing else, and its runs land at 10:00:51Z.
 */
const LIVE_WEEKLY_NODES = [
  { name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger' },
  {
    name: 'Weekly Trigger',
    type: 'n8n-nodes-base.scheduleTrigger',
    parameters: { rule: { interval: [{ field: 'weeks', triggerAtHour: 6 }] } }
  },
  { name: 'Configuration', type: 'n8n-nodes-base.code' }
];

/** A Sunday in October: America/New_York is on EDT, UTC-4. */
const OCT = new Date('2026-10-04T12:00:00Z');

describe('readRule fills in what the body omits', () => {
  it('reads the live weekly rule as Sunday 06:00 — both day and minute are defaults', () => {
    expect(readRule({ field: 'weeks', triggerAtHour: 6 })).toEqual({ cron: '0 6 * * 0' });
  });

  it('reads an absent field as the node default, daily at midnight', () => {
    expect(readRule({})).toEqual({ cron: '0 0 * * *' });
  });

  it('reads an explicitly empty weekday list as every day', () => {
    expect(readRule({ field: 'weeks', triggerAtDay: [], triggerAtHour: 9 })).toEqual({ cron: '0 9 * * *' });
  });

  it('sorts and de-duplicates weekdays, folding 7 into Sunday', () => {
    expect(readRule({ field: 'weeks', triggerAtDay: [5, 1, 7, 0], triggerAtHour: 8, triggerAtMinute: 30 }))
      .toEqual({ cron: '30 8 * * 0,1,5' });
  });

  it('reads minutes and monthly rules', () => {
    expect(readRule({ field: 'minutes' })).toEqual({ cron: '*/5 * * * *' });
    expect(readRule({ field: 'minutes', minutesInterval: 1 })).toEqual({ cron: '* * * * *' });
    expect(readRule({ field: 'months', triggerAtDayOfMonth: 15, triggerAtHour: 3 })).toEqual({ cron: '0 3 15 * *' });
  });

  it('reads hours only when the interval divides the day', () => {
    expect(readRule({ field: 'hours', triggerAtMinute: 10 })).toEqual({ cron: '10 * * * *' });
    expect(readRule({ field: 'hours', hoursInterval: 6 })).toEqual({ cron: '0 */6 * * *' });
    // 20:00 → 00:00 is four hours, so n8n skips a midnight run cron would report.
    expect(readRule({ field: 'hours', hoursInterval: 5 }).cron).toBeNull();
  });
});

describe('readRule refuses, with a reason, what no cron can say', () => {
  it.each([
    [{ field: 'seconds', secondsInterval: 30 }, /minute/],
    [{ field: 'days', daysInterval: 2 }, /previous run/],
    [{ field: 'weeks', weeksInterval: 2 }, /previous run/],
    [{ field: 'months', monthsInterval: 3 }, /previous run/],
    [{ field: 'days', triggerAtHour: '={{ $now.hour }}' }, /expression/],
    [{ field: 'fortnights' }, /Unrecognised/]
  ])('%j', (rule, reason) => {
    const read = readRule(rule);
    expect(read.cron).toBeNull();
    expect(read.reason).toMatch(reason);
  });
});

describe('readRule reads Custom (Cron)', () => {
  it('keeps a 5-field expression', () => {
    expect(readRule({ field: 'cronExpression', expression: ' 0  15 * * 1 ' })).toEqual({ cron: '0 15 * * 1' });
  });

  it('drops a single-valued seconds field, which only moves the run within its minute', () => {
    expect(readRule({ field: 'cronExpression', expression: '30 0 15 * * 1' })).toEqual({ cron: '0 15 * * 1' });
  });

  it('refuses a seconds field that fires more than once a minute', () => {
    expect(readRule({ field: 'cronExpression', expression: '*/10 * * * * *' }).cron).toBeNull();
  });

  it('refuses an empty expression', () => {
    expect(readRule({ field: 'cronExpression', expression: '' }).reason).toMatch(/no expression/);
  });
});

describe('resolveZone', () => {
  it("prefers the workflow's own zone, and reads DEFAULT as the instance's", () => {
    expect(resolveZone({ workflowZone: 'Europe/Berlin', instanceZone: 'America/New_York' })).toBe('Europe/Berlin');
    expect(resolveZone({ workflowZone: 'DEFAULT', instanceZone: 'America/New_York' })).toBe('America/New_York');
    expect(resolveZone({ workflowZone: null, instanceZone: '' })).toBeNull();
  });
});

describe('readWorkflowSchedule', () => {
  it('converts the live weekly workflow to the UTC its runs actually land at', () => {
    const schedule = readWorkflowSchedule(LIVE_WEEKLY_NODES, { instanceZone: 'America/New_York' }, OCT);
    // Execution 976 started 2026-10-04T10:00:51Z.
    expect(schedule).toMatchObject({ scheduled: true, cron: '0 10 * * 0', timeZone: 'America/New_York' });
    expect(schedule.rules).toEqual([{ node: 'Weekly Trigger', localCron: '0 6 * * 0' }]);
  });

  it('refuses rather than reading local time as UTC when no zone is known', () => {
    // The #60 shape: storing 06:00 as UTC would put this run four hours early.
    const schedule = readWorkflowSchedule(LIVE_WEEKLY_NODES, {}, OCT);
    expect(schedule.cron).toBeNull();
    expect(schedule.reason).toMatch(/instance time zone/);
    expect(schedule.rules[0]!.localCron).toBe('0 6 * * 0');
  });

  it('reports a workflow with no schedule node as unscheduled, not as a failed read', () => {
    // The live "Song" workflow is form-triggered.
    const schedule = readWorkflowSchedule(
      [{ name: 'Song type request form', type: 'n8n-nodes-base.formTrigger' }],
      { instanceZone: 'UTC' }
    );
    expect(schedule).toEqual({ scheduled: false, cron: null, timeZone: 'UTC', rules: [] });
  });

  it('ignores a disabled schedule node', () => {
    const nodes = [{ ...LIVE_WEEKLY_NODES[1]!, disabled: true }];
    expect(readWorkflowSchedule(nodes, { instanceZone: 'UTC' }).scheduled).toBe(false);
  });

  it('keeps every rule but stores no cron when there is more than one', () => {
    const schedule = readWorkflowSchedule(
      [{
        name: 'Twice',
        type: 'n8n-nodes-base.scheduleTrigger',
        parameters: { rule: { interval: [{ field: 'days', triggerAtHour: 8 }, { field: 'days', triggerAtHour: 20 }] } }
      }],
      { instanceZone: 'UTC' }
    );
    expect(schedule.cron).toBeNull();
    expect(schedule.reason).toMatch(/2 schedule rules/);
    expect(schedule.rules.map(r => r.localCron)).toEqual(['0 8 * * *', '0 20 * * *']);
  });

  it('recognises the legacy Cron node and says it is not read', () => {
    const schedule = readWorkflowSchedule([{ name: 'Cron', type: 'n8n-nodes-base.cron' }], { instanceZone: 'UTC' });
    expect(schedule.scheduled).toBe(true);
    expect(schedule.reason).toMatch(/legacy Cron node/);
  });

  it('passes a refused zone shift through with its reason', () => {
    // Midnight crossing with a pinned day of month — shiftCronToUtc's refusal.
    const schedule = readWorkflowSchedule(
      [{
        name: 'Monthly',
        type: 'n8n-nodes-base.scheduleTrigger',
        parameters: { rule: { interval: [{ field: 'months', triggerAtDayOfMonth: 1, triggerAtHour: 22 }] } }
      }],
      { instanceZone: 'America/New_York' },
      OCT
    );
    expect(schedule.cron).toBeNull();
    expect(schedule.reason).toMatch(/crosses midnight/);
  });
});
