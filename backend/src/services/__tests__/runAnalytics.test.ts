import { describe, it, expect } from 'vitest';
import { ExecutionStatus, PlatformType, TaskStatus } from '@prisma/client';
import {
  analyzeDurations,
  bucketByDay,
  dayKey,
  findIdleTasks,
  isValidTimeZone,
  type DurationInput,
  type IdleInputTask
} from '../runAnalytics.js';

const NOW = new Date('2026-07-28T12:00:00.000Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86400000);

describe('dayKey', () => {
  it('cuts the day in the requested zone, not UTC', () => {
    // 2026-07-28 02:00Z is still the 27th in Los Angeles. Bucketing this run
    // under the 28th is the whole class of error the tz parameter exists for.
    const late = new Date('2026-07-28T02:00:00.000Z');
    expect(dayKey(late, 'UTC')).toBe('2026-07-28');
    expect(dayKey(late, 'America/Los_Angeles')).toBe('2026-07-27');
  });

  it('zero-pads so keys sort lexicographically', () => {
    expect(dayKey(new Date('2026-01-05T12:00:00.000Z'), 'UTC')).toBe('2026-01-05');
  });
});

describe('isValidTimeZone', () => {
  it('accepts IANA names and rejects anything else', () => {
    expect(isValidTimeZone('America/Los_Angeles')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
});

describe('bucketByDay', () => {
  const span = { from: new Date('2026-07-20T00:00:00.000Z'), to: new Date('2026-07-24T23:59:59.000Z') };

  it('emits every day in the span, including the ones with no runs', () => {
    // The empty days ARE the signal. A trend drawn only from days that have
    // rows joins a line straight across a two-week outage.
    const days = bucketByDay(
      [{ triggeredAt: new Date('2026-07-22T09:00:00.000Z'), status: ExecutionStatus.SUCCESS }],
      span,
      'UTC'
    );

    expect(days.map(d => d.day)).toEqual([
      '2026-07-20',
      '2026-07-21',
      '2026-07-22',
      '2026-07-23',
      '2026-07-24'
    ]);
    expect(days.find(d => d.day === '2026-07-21')).toMatchObject({ runs: 0, succeeded: 0, failed: 0 });
  });

  it('counts TIMEOUT as a failure, not as its own quiet category', () => {
    const days = bucketByDay(
      [
        { triggeredAt: new Date('2026-07-22T09:00:00.000Z'), status: ExecutionStatus.FAILURE },
        { triggeredAt: new Date('2026-07-22T10:00:00.000Z'), status: ExecutionStatus.TIMEOUT },
        { triggeredAt: new Date('2026-07-22T11:00:00.000Z'), status: ExecutionStatus.SUCCESS },
        { triggeredAt: new Date('2026-07-22T12:00:00.000Z'), status: ExecutionStatus.PENDING }
      ],
      span,
      'UTC'
    );

    expect(days.find(d => d.day === '2026-07-22')).toMatchObject({
      runs: 4,
      succeeded: 1,
      failed: 2,
      pending: 1
    });
  });

  it('assigns a run to the local day, so the zone changes which bar it lands on', () => {
    const rows = [{ triggeredAt: new Date('2026-07-22T02:00:00.000Z'), status: ExecutionStatus.SUCCESS }];

    expect(bucketByDay(rows, span, 'UTC').find(d => d.day === '2026-07-22')?.runs).toBe(1);
    expect(bucketByDay(rows, span, 'America/Los_Angeles').find(d => d.day === '2026-07-21')?.runs).toBe(1);
  });

  it('returns a single bucket when the span is one day', () => {
    const oneDay = { from: new Date('2026-07-20T01:00:00.000Z'), to: new Date('2026-07-20T23:00:00.000Z') };
    expect(bucketByDay([], oneDay, 'UTC')).toHaveLength(1);
  });
});

describe('analyzeDurations', () => {
  const run = (overrides: Partial<DurationInput> = {}): DurationInput => ({
    taskId: 'n1',
    taskName: 'Nightly digest',
    platform: PlatformType.TASKHUB_NATIVE,
    triggeredAt: daysAgo(1),
    durationMs: 1000,
    status: ExecutionStatus.SUCCESS,
    ...overrides
  });

  /** n runs for one task, oldest at `baselineMs`, newest `recentMs`. */
  const series = (taskId: string, baselineMs: number, recentMs: number, each = 5) => [
    ...Array.from({ length: each }, (_, i) =>
      run({ taskId, durationMs: recentMs, triggeredAt: daysAgo(i + 1) })
    ),
    ...Array.from({ length: each }, (_, i) =>
      run({ taskId, durationMs: baselineMs, triggeredAt: daysAgo(each + i + 1) })
    )
  ];

  it('ignores Windows rows entirely, and says how many it dropped', () => {
    // A Windows durationMs times the agent handshake, not the job. Ranking those
    // by duration would put a slow WebSocket at the top of a "getting slower" list.
    const report = analyzeDurations([
      ...series('n1', 1000, 4000),
      ...Array.from({ length: 20 }, () =>
        run({ taskId: 'w1', platform: PlatformType.WINDOWS_TASK_SCHEDULER, durationMs: 90000 })
      )
    ]);

    expect(report.excludedManualTriggerRuns).toBe(20);
    expect(report.tasks.map(t => t.taskId)).toEqual(['n1']);
    expect(report.considered).toBe(10);
  });

  it('reports the ratio of recent to baseline median', () => {
    const [task] = analyzeDurations(series('n1', 1000, 4000)).tasks;
    expect(task).toMatchObject({
      recentMedianMs: 4000,
      baselineMedianMs: 1000,
      changeRatio: 4,
      recentSamples: 5,
      baselineSamples: 5
    });
  });

  it('ranks the steepest growth first', () => {
    const report = analyzeDurations([...series('slow', 1000, 2000), ...series('slower', 1000, 8000)]);
    expect(report.tasks.map(t => t.taskId)).toEqual(['slower', 'slow']);
  });

  it('skips tasks without enough runs on both sides to be a trend', () => {
    // Six runs: five recent, one baseline. One data point is a coincidence.
    const runs = Array.from({ length: 6 }, (_, i) => run({ durationMs: 1000, triggeredAt: daysAgo(i + 1) }));
    expect(analyzeDurations(runs).tasks).toHaveLength(0);
    expect(analyzeDurations(runs).minimumSamplesPerSide).toBe(2);
  });

  it('skips a zero baseline rather than reporting an infinite ratio', () => {
    expect(analyzeDurations(series('n1', 0, 4000)).tasks).toHaveLength(0);
  });

  it('ignores rows with no recorded duration', () => {
    const report = analyzeDurations([
      ...series('n1', 1000, 4000),
      run({ taskId: 'n1', durationMs: null })
    ]);
    expect(report.considered).toBe(10);
    expect(report.tasks[0].recentSamples).toBe(5);
  });
});

describe('findIdleTasks', () => {
  const task = (overrides: Partial<IdleInputTask> = {}): IdleInputTask => ({
    id: 'w1',
    name: 'Nightly Backup',
    platform: PlatformType.WINDOWS_TASK_SCHEDULER,
    category: 'Work',
    externalId: '\\Work\\Nightly',
    status: TaskStatus.ACTIVE,
    schedule: '0 3 * * *',
    updatedAt: NOW,
    metadata: { lastRunTime: daysAgo(45).toISOString() },
    lastExecutionAt: null,
    ...overrides
  });

  it("judges a Windows task from Windows' own last-run time", () => {
    // NOT from ExecutionLog: a Windows task firing on its own schedule writes
    // nothing there, so that source would call every task on the machine idle.
    const report = findIdleTasks([task()], NOW, 30);
    expect(report.tasks).toHaveLength(1);
    expect(report.tasks[0]).toMatchObject({ taskId: 'w1', daysSinceLastRun: 45 });
    expect(report.tasks[0].evidence).toContain('Windows reported a last run');
  });

  it('leaves a recently-run task out', () => {
    const report = findIdleTasks([task({ metadata: { lastRunTime: daysAgo(2).toISOString() } })], NOW, 30);
    expect(report.tasks).toHaveLength(0);
    expect(report.unassessed).toHaveLength(0);
  });

  it('judges a native task from Cronsole execution records', () => {
    const report = findIdleTasks(
      [
        task({
          id: 'n1',
          platform: PlatformType.TASKHUB_NATIVE,
          externalId: 'native:n1',
          metadata: {},
          lastExecutionAt: daysAgo(60)
        })
      ],
      NOW,
      30
    );
    expect(report.tasks[0]).toMatchObject({ taskId: 'n1', daysSinceLastRun: 60 });
    expect(report.tasks[0].evidence).toContain("Cronsole's own execution record");
  });

  it('reports an agent that never sent a last-run time as unmeasured, never as idle', () => {
    // The health score was redesigned around this exact mistake: reading absence
    // as "never ran" flags the whole machine the moment an agent is a build behind.
    const report = findIdleTasks([task({ metadata: {} })], NOW, 30);
    expect(report.tasks).toHaveLength(0);
    expect(report.unassessed[0]).toMatchObject({ taskId: 'w1', reason: 'no-run-evidence' });
  });

  it('separates never-run from idle', () => {
    const report = findIdleTasks([task({ metadata: { lastRunTime: null } })], NOW, 30);
    expect(report.tasks).toHaveLength(0);
    expect(report.unassessed[0].reason).toBe('never-run');
  });

  it('does not blame a disabled task for not running', () => {
    // Parking a task is the recommended safe action — it is why set_task_status
    // ships ungated over MCP. Scoring it as a problem punishes correct use.
    const report = findIdleTasks([task({ status: TaskStatus.DISABLED })], NOW, 30);
    expect(report.tasks).toHaveLength(0);
    expect(report.unassessed[0].reason).toBe('disabled');
  });

  it('does not blame an on-demand task for not running', () => {
    const report = findIdleTasks([task({ schedule: null })], NOW, 30);
    expect(report.tasks).toHaveLength(0);
    expect(report.unassessed[0].reason).toBe('no-schedule');
  });

  it("carries the system verdict so the caller can apply the dashboard's lens", () => {
    const report = findIdleTasks(
      [task(), task({ id: 'm1', name: 'AikCertEnrollTask', externalId: '\\Microsoft\\Windows\\CertEnroll' })],
      NOW,
      30
    );
    expect(report.tasks.map(t => [t.taskId, t.isSystem])).toEqual(
      expect.arrayContaining([['w1', false], ['m1', true]])
    );
  });

  it('sorts the longest-idle first', () => {
    const report = findIdleTasks(
      [
        task({ id: 'a', metadata: { lastRunTime: daysAgo(40).toISOString() } }),
        task({ id: 'b', metadata: { lastRunTime: daysAgo(120).toISOString() } })
      ],
      NOW,
      30
    );
    expect(report.tasks.map(t => t.taskId)).toEqual(['b', 'a']);
  });

  it('honors the threshold it was given', () => {
    const tasks = [task({ metadata: { lastRunTime: daysAgo(10).toISOString() } })];
    expect(findIdleTasks(tasks, NOW, 30).tasks).toHaveLength(0);
    expect(findIdleTasks(tasks, NOW, 7).tasks).toHaveLength(1);
    expect(findIdleTasks(tasks, NOW, 7).thresholdDays).toBe(7);
  });
});
