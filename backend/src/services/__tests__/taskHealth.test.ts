import { describe, it, expect } from 'vitest';
import { PlatformType, TaskStatus, ExecutionStatus } from '@prisma/client';
import {
  rankByHealth,
  readWindowsSnapshot,
  scoreTask,
  summarizeHealth,
  type HealthInputTask,
  type TaskHealth
} from '../taskHealth.js';

const NOW = new Date('2026-07-28T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600000);
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86400000);

/** A Windows task on an agent that DOES report run results. */
const windowsTask = (metadata: Record<string, unknown>, overrides: Partial<HealthInputTask> = {}): HealthInputTask => ({
  id: 'w1',
  name: 'Nightly Backup',
  externalId: '\\Work\\Nightly',
  platform: PlatformType.WINDOWS_TASK_SCHEDULER,
  category: 'Work',
  status: TaskStatus.ACTIVE,
  schedule: '0 3 * * *',
  nextRunTime: new Date(NOW.getTime() + 3600000),
  updatedAt: hoursAgo(1),
  metadata: { lastTaskResult: 0, lastRunTime: hoursAgo(12).toISOString(), ...metadata },
  executions: [],
  ...overrides
});

const nativeTask = (executions: HealthInputTask['executions'], overrides: Partial<HealthInputTask> = {}): HealthInputTask => ({
  id: 'n1',
  name: 'Health Check',
  externalId: 'native_health',
  platform: PlatformType.TASKHUB_NATIVE,
  category: 'Monitoring',
  status: TaskStatus.ACTIVE,
  schedule: '*/5 * * * *',
  nextRunTime: new Date(NOW.getTime() + 300000),
  updatedAt: hoursAgo(1),
  metadata: {},
  executions,
  ...overrides
});

const githubTask = (metadata: Record<string, unknown>, overrides: Partial<HealthInputTask> = {}): HealthInputTask => ({
  id: 'g1',
  name: 'Nightly',
  externalId: 'acme/website#42',
  platform: PlatformType.GITHUB_ACTIONS,
  category: 'acme/website',
  status: TaskStatus.ACTIVE,
  schedule: '0 9 * * *',
  nextRunTime: null,
  updatedAt: hoursAgo(1),
  metadata: { reportsRunResult: true, scheduledRunCount: 5, lastConclusion: 'success', lastRunTime: hoursAgo(12).toISOString(), ...metadata },
  executions: [],
  ...overrides
});

const run = (status: ExecutionStatus, hours: number, durationMs: number | null = 1000) => ({
  status,
  triggeredAt: hoursAgo(hours),
  durationMs
});

const codes = (health: TaskHealth) => health.signals.map(s => s.code);

describe('readWindowsSnapshot', () => {
  // The distinction the whole feature rests on. `lastTaskResult` only started
  // being reported on 2026-07-28, so on an un-republished agent the key is
  // ABSENT — and reading absence as "never ran" would flag every Windows task
  // on the machine at once.
  it('separates "the agent never told us" from "the agent told us there is nothing"', () => {
    expect(readWindowsSnapshot({}).reportsRunResult).toBe(false);
    expect(readWindowsSnapshot({ lastTaskResult: null }).reportsRunResult).toBe(true);
    expect(readWindowsSnapshot({ lastTaskResult: 0 }).reportsRunResult).toBe(true);
  });

  it('rejects the pre-2000 sentinels Task Scheduler uses for "never"', () => {
    expect(readWindowsSnapshot({ lastRunTime: '1899-12-30T00:00:00Z' }).lastRunTime).toBeNull();
    expect(readWindowsSnapshot({ lastRunTime: '0001-01-01T00:00:00Z' }).lastRunTime).toBeNull();
    expect(readWindowsSnapshot({ lastRunTime: null }).lastRunTime).toBeNull();
  });

  it('survives metadata that is missing, null, or not an object', () => {
    for (const value of [undefined, null, 'nope', 42]) {
      expect(readWindowsSnapshot(value).reportsRunResult).toBe(false);
    }
  });
});

describe('scoreTask — evidence is mandatory', () => {
  it('attaches evidence naming a source to every signal it raises', () => {
    const health = scoreTask(windowsTask({ lastTaskResult: 1 }), NOW);
    expect(health.signals.length).toBeGreaterThan(0);
    for (const signal of health.signals) {
      expect(signal.evidence.length).toBeGreaterThan(0);
      expect(signal.summary.length).toBeGreaterThan(0);
    }
  });

  // The headline rule: silence is not health.
  it('scores unknown — not ok — when the agent does not report run results', () => {
    const health = scoreTask(windowsTask({ lastTaskResult: undefined, lastRunTime: undefined }, {
      metadata: { state: 'Ready' }
    }), NOW);

    expect(health.tier).toBe('unknown');
    expect(health.score).toBeNull();
    // And it says WHY, so nobody debugs a task that is fine.
    expect(codes(health)).toContain('no-run-evidence');
    expect(health.signals[0].evidence).toMatch(/republish/i);
  });
});

describe('scoreTask — Windows', () => {
  it('is ok when Windows reports a clean exit', () => {
    const health = scoreTask(windowsTask({ lastTaskResult: 0 }), NOW);
    expect(health.tier).toBe('ok');
    expect(health.score).toBe(100);
  });

  it('is critical when Windows reports a non-zero exit code, and quotes it', () => {
    const health = scoreTask(windowsTask({ lastTaskResult: 2 }), NOW);
    expect(health.tier).toBe('critical');
    expect(codes(health)).toContain('last-run-failed');
    expect(health.signals.find(s => s.code === 'last-run-failed')!.evidence).toContain('exit code 2');
  });

  // 267009 is SCHED_S_TASK_RUNNING — a task working correctly right now. Reading
  // it as an exit code would show "your task is broken" for a healthy task.
  it('does not mistake Task Scheduler status codes for exit codes', () => {
    const running = scoreTask(windowsTask({ lastTaskResult: 267009 }), NOW);
    expect(running.tier).toBe('ok');
    expect(codes(running)).toContain('sched-267009');

    const terminated = scoreTask(windowsTask({ lastTaskResult: 267014 }), NOW);
    expect(terminated.tier).toBe('attention');
    expect(codes(terminated)).toContain('run-terminated');
  });

  // Found by running this against a real machine: 0x40010004 is
  // DBG_TERMINATE_PROCESS — the process was killed (shutdown, or the task's own
  // "stop after N minutes"). Read as a plain exit code it produced "the last run
  // failed" for a task that was simply cut short. Different fact, different fix.
  it('reports a stopped run as stopped, not failed', () => {
    const health = scoreTask(windowsTask({ lastTaskResult: 1073807364 }), NOW);
    expect(health.tier).toBe('attention');
    expect(codes(health)).toContain('run-terminated');
    expect(codes(health)).not.toContain('last-run-failed');
  });

  // Also found live: 4 of the 5 worst tasks were \Microsoft\ system tasks the
  // user will never act on — re-creating the exact burial the dashboard's
  // personal/system lens exists to prevent.
  it('marks Windows-owned tasks so the personal lens can apply', () => {
    expect(scoreTask(windowsTask({}, { externalId: '\\Microsoft\\Windows\\Defrag\\ScheduledDefrag' }), NOW).isSystem)
      .toBe(true);
    expect(scoreTask(windowsTask({}), NOW).isSystem).toBe(false);
    expect(scoreTask(nativeTask([]), NOW).isSystem).toBe(false);
  });

  it('flags a task Windows has never run', () => {
    const health = scoreTask(windowsTask({ lastRunTime: null, lastTaskResult: null }), NOW);
    expect(codes(health)).toContain('never-run');
    expect(health.tier).toBe('attention');
  });

  it('flags missed scheduled starts', () => {
    const health = scoreTask(windowsTask({ numberOfMissedRuns: 3 }), NOW);
    expect(codes(health)).toContain('missed-runs');
    expect(health.signals.find(s => s.code === 'missed-runs')!.summary).toContain('3');
  });

  it('agrees with itself about plurals in the summary and the evidence', () => {
    // The evidence read "reported 1 missed runs" under a summary that correctly
    // said "1 scheduled start" — small, but the evidence line is the half that
    // is meant to be quotable.
    const one = scoreTask(windowsTask({ numberOfMissedRuns: 1 }), NOW);
    const signal = one.signals.find(s => s.code === 'missed-runs')!;
    expect(signal.summary).toContain('1 scheduled start.');
    expect(signal.evidence).toContain('1 missed run ');
  });

  it('flags a task whose own next-run time is long past with no later run', () => {
    const health = scoreTask(
      windowsTask({ lastRunTime: daysAgo(9).toISOString() }, { nextRunTime: daysAgo(8) }),
      NOW
    );
    expect(codes(health)).toContain('overdue');
    // The evidence names the snapshot, so a stale sync can't read as a stalled task.
    expect(health.signals.find(s => s.code === 'overdue')!.evidence).toContain('sync');
  });

  it('does not call a task overdue when it ran after its due time', () => {
    const health = scoreTask(
      windowsTask({ lastRunTime: hoursAgo(1).toISOString() }, { nextRunTime: daysAgo(8) }),
      NOW
    );
    expect(codes(health)).not.toContain('overdue');
  });

  // Duration on a Windows row measures the trigger round trip, not the work, so
  // comparing them would be comparing handshakes.
  it('never raises duration drift for a Windows task', () => {
    const health = scoreTask(
      windowsTask({}, {
        executions: [run(ExecutionStatus.SUCCESS, 1, 90000), run(ExecutionStatus.SUCCESS, 2, 100),
                     run(ExecutionStatus.SUCCESS, 3, 100), run(ExecutionStatus.SUCCESS, 4, 100)]
      }),
      NOW
    );
    expect(codes(health)).not.toContain('duration-drift');
  });
});

describe('scoreTask — Cronsole-native', () => {
  it('is critical when the most recent run failed', () => {
    const health = scoreTask(nativeTask([run(ExecutionStatus.FAILURE, 1), run(ExecutionStatus.SUCCESS, 2)]), NOW);
    expect(health.tier).toBe('critical');
    expect(codes(health)).toContain('recent-failure');
    expect(codes(health)).not.toContain('failure-streak');
  });

  it('calls out a run of consecutive failures separately', () => {
    const health = scoreTask(
      nativeTask([run(ExecutionStatus.FAILURE, 1), run(ExecutionStatus.TIMEOUT, 2), run(ExecutionStatus.FAILURE, 3)]),
      NOW
    );
    expect(codes(health)).toContain('failure-streak');
    expect(health.signals.find(s => s.code === 'failure-streak')!.summary).toContain('3');
    // Two criticals stack, so a persistently broken task outranks a one-off.
    expect(health.score).toBeLessThan(scoreTask(nativeTask([run(ExecutionStatus.FAILURE, 1)]), NOW).score!);
  });

  it('is ok after a failure that has since recovered', () => {
    const health = scoreTask(nativeTask([run(ExecutionStatus.SUCCESS, 1), run(ExecutionStatus.FAILURE, 2)]), NOW);
    expect(health.tier).toBe('ok');
  });

  it('flags a task with no execution records at all', () => {
    const health = scoreTask(nativeTask([]), NOW);
    expect(codes(health)).toContain('never-run');
  });

  it('flags a run that took far longer than its own baseline', () => {
    const health = scoreTask(
      nativeTask([
        run(ExecutionStatus.SUCCESS, 1, 30000),
        run(ExecutionStatus.SUCCESS, 2, 1000),
        run(ExecutionStatus.SUCCESS, 3, 1100),
        run(ExecutionStatus.SUCCESS, 4, 900)
      ]),
      NOW
    );
    expect(codes(health)).toContain('duration-drift');
    expect(health.signals.find(s => s.code === 'duration-drift')!.evidence).toMatch(/30s against a typical 1s/);
  });

  it('needs a real baseline before calling anything drift', () => {
    // Two runs is not a pattern; claiming drift from it is a guess.
    const health = scoreTask(
      nativeTask([run(ExecutionStatus.SUCCESS, 1, 30000), run(ExecutionStatus.SUCCESS, 2, 1000)]),
      NOW
    );
    expect(codes(health)).not.toContain('duration-drift');
  });
});

describe('scoreTask — states that are not failures', () => {
  // Parking a task is the RECOMMENDED safe action — it is why set_task_status
  // ships ungated over MCP. Scoring it as unhealthy would punish the behavior
  // the product asks for.
  it('treats disabled as information, never as a deduction', () => {
    const health = scoreTask(windowsTask({}, { status: TaskStatus.DISABLED }), NOW);
    expect(health.tier).toBe('ok');
    expect(health.score).toBe(100);
    expect(health.signals.find(s => s.code === 'disabled')!.weight).toBe(0);
  });

  it('does not nag that a disabled task has never run', () => {
    const health = scoreTask(
      windowsTask({ lastRunTime: null, lastTaskResult: null }, { status: TaskStatus.DISABLED }),
      NOW
    );
    expect(codes(health)).not.toContain('never-run');
  });

  it('does not call a disabled task overdue', () => {
    const health = scoreTask(
      windowsTask({ lastRunTime: null, lastTaskResult: null }, { status: TaskStatus.DISABLED, nextRunTime: daysAgo(8) }),
      NOW
    );
    expect(codes(health)).not.toContain('overdue');
  });

  it('does not charge a disabled task for the starts it was parked to miss', () => {
    // Windows keeps incrementing numberOfMissedRuns while a task is disabled,
    // so this signal scored a task for doing exactly what disabling it means —
    // and put a parked task at the top of a real machine's worst-first list,
    // above every task that was actually still running and failing.
    const health = scoreTask(
      windowsTask({ numberOfMissedRuns: 4 }, { status: TaskStatus.DISABLED }),
      NOW
    );
    expect(codes(health)).not.toContain('missed-runs');
  });

  it('still counts missed starts once the task is enabled again', () => {
    // The suppression is about the parked state, not about forgetting the fact.
    const health = scoreTask(windowsTask({ numberOfMissedRuns: 4 }), NOW);
    expect(codes(health)).toContain('missed-runs');
  });

  it('explains an on-demand task instead of flagging it', () => {
    const health = scoreTask(windowsTask({ lastRunTime: null, lastTaskResult: null }, { schedule: null }), NOW);
    expect(codes(health)).toContain('no-schedule');
    expect(health.signals.find(s => s.code === 'no-schedule')!.weight).toBe(0);
  });
});

describe('scoreTask — MISSING', () => {
  it('is critical and says nothing else about a task that is gone', () => {
    const health = scoreTask(
      windowsTask({ numberOfMissedRuns: 5, lastTaskResult: 1 }, { status: TaskStatus.MISSING }),
      NOW
    );
    expect(health.tier).toBe('critical');
    // Describing the schedule of a task that no longer exists is noise about a
    // snapshot of something gone.
    expect(codes(health)).toEqual(['missing']);
  });
});

describe('rankByHealth', () => {
  it('puts the worst first, and unknown above ok', () => {
    const health = (id: string, tier: TaskHealth['tier'], score: number | null): TaskHealth => ({
      taskId: id, name: id, platform: PlatformType.WINDOWS_TASK_SCHEDULER, category: 'x', isSystem: false, tier, score, signals: []
    });

    const ranked = rankByHealth([
      health('ok', 'ok', 100),
      health('unknown', 'unknown', null),
      health('warn', 'attention', 80),
      health('bad', 'critical', 40),
      health('worse', 'critical', 5)
    ]).map(h => h.taskId);

    expect(ranked).toEqual(['worse', 'bad', 'warn', 'unknown', 'ok']);
  });
});

/**
 * **GitHub Actions is the one platform whose run outcomes are real outcomes.**
 *
 * Everywhere else in this file a run's verdict is either Cronsole's own
 * (`ExecutionLog`, native) or an exit code the agent read off Task Scheduler —
 * and a Cronsole-recorded `SUCCESS` on a Windows task only ever means *the agent
 * accepted a start*. GitHub reports `conclusion` for the run itself, so the
 * evidence sentence can name the thing the user cares about.
 *
 * The two rules carried over unchanged are the ones that stop a summary lying,
 * and both are pinned below: absence of evidence is `unknown`, and a workflow
 * GitHub turned off by itself is a fact rather than a preference.
 */
describe('scoreTask — GitHub Actions', () => {
  it('is ok when the last scheduled run succeeded', () => {
    const result = scoreTask(githubTask({}), NOW);
    expect(result.tier).toBe('ok');
  });

  it('reads a failure as critical and names GitHub as the source', () => {
    const result = scoreTask(githubTask({ lastConclusion: 'failure' }), NOW);
    expect(result.tier).toBe('critical');
    const signal = result.signals.find(s => s.code === 'recent-failure')!;
    expect(signal.summary).toMatch(/failed/);
    // The claim never travels without its source.
    expect(signal.evidence).toMatch(/GitHub reports conclusion "failure"/);
  });

  it('calls a cancelled run terminated, not failed', () => {
    // `cancelled` and `skipped` are outcomes somebody chose, not breakage.
    const result = scoreTask(githubTask({ lastConclusion: 'cancelled' }), NOW);
    expect(result.signals.map(s => s.code)).toContain('run-terminated');
    expect(result.signals.map(s => s.code)).not.toContain('recent-failure');
  });

  it('adds a streak signal only once it is worth saying', () => {
    const one = scoreTask(githubTask({ lastConclusion: 'failure', failureStreak: 1 }), NOW);
    expect(one.signals.map(s => s.code)).not.toContain('failure-streak');

    const three = scoreTask(githubTask({ lastConclusion: 'failure', failureStreak: 3 }), NOW);
    const streak = three.signals.find(s => s.code === 'failure-streak')!;
    // Named alongside the sample size — it is a streak *seen* in the runs GitHub
    // returned, never a claim about the whole history.
    expect(streak.evidence).toMatch(/in the 5 runs GitHub returned/);
  });

  it('is unknown, not ok, when the run query failed', () => {
    // `reportsRunResult: false` scores nothing at all. Reading silence as "never
    // ran" is what would flag every workflow in a repository over one
    // rate-limited request.
    const result = scoreTask(githubTask({ reportsRunResult: false }), NOW);
    expect(result.tier).toBe('unknown');
    expect(result.score).toBeNull();
    expect(result.signals.map(s => s.code)).toContain('no-run-evidence');
  });

  it('flags a workflow GitHub disabled for inactivity', () => {
    // GitHub does this silently after 60 days of repository quiet. Unlike a task
    // a person parked, nobody chose this — so it is a warning, not an info note.
    const result = scoreTask(
      githubTask(
        { state: 'disabled_inactivity', disabledReason: 'GitHub disabled this scheduled workflow…' },
        { status: TaskStatus.DISABLED }
      ),
      NOW
    );
    const signal = result.signals.find(s => s.code === 'workflow-auto-disabled')!;
    expect(signal.severity).toBe('warn');
    expect(signal.summary).toMatch(/inactivity/);
  });

  it('does not call a workflow never-run when it is disabled', () => {
    const result = scoreTask(
      githubTask({ scheduledRunCount: 0, lastConclusion: undefined }, { status: TaskStatus.DISABLED }),
      NOW
    );
    expect(result.signals.map(s => s.code)).not.toContain('never-run');
  });

  it('flags an active workflow that has never completed a scheduled run', () => {
    const result = scoreTask(githubTask({ scheduledRunCount: 0, lastConclusion: undefined }), NOW);
    expect(result.signals.map(s => s.code)).toContain('never-run');
  });

  it('does not ask a GitHub task for a Windows agent republish', () => {
    // Before this branch existed every non-native platform fell through to the
    // Windows snapshot, so a GitHub row would have been told to republish an
    // agent it has nothing to do with.
    const result = scoreTask(githubTask({ reportsRunResult: false }), NOW);
    expect(JSON.stringify(result.signals)).not.toMatch(/republish/i);
  });
});

describe('a platform with no run evidence says so in its own terms', () => {
  const vercelTask = (overrides: Partial<HealthInputTask> = {}): HealthInputTask => ({
    id: 'v1',
    name: '/api/cron',
    externalId: 'website#/api/cron',
    platform: PlatformType.VERCEL_CRON,
    category: 'website',
    status: TaskStatus.ACTIVE,
    schedule: '0 9 * * *',
    nextRunTime: null,
    updatedAt: hoursAgo(1),
    metadata: { reportsRunResult: false, project: 'website', path: '/api/cron' },
    executions: [],
    ...overrides
  });

  it('scores a Vercel cron as unknown, never as ok', () => {
    // Vercel publishes no run history for a cron, so there is nothing to score
    // with — permanently, not until some future sync fills it in. Scoring
    // `enabledAt` instead would report every configured cron as healthy, which
    // is the confident lie the observer exists to avoid: *configured* and
    // *working* are different claims.
    const result = scoreTask(vercelTask(), NOW);
    expect(result.tier).toBe('unknown');
    expect(result.score).toBeNull();
  });

  it('blames the platform rather than an agent the user does not have', () => {
    // The misdirection this branch exists to stop. Until 2026-08-24 the Windows
    // arm was the `else`, so **every** platform without its own scoring fell
    // into it, read an absent Windows snapshot, and was told to "republish the
    // agent" — a true sentence about exactly one platform.
    const result = scoreTask(vercelTask(), NOW);
    expect(JSON.stringify(result.signals)).not.toMatch(/republish/i);
    expect(JSON.stringify(result.signals)).toMatch(/function logs/i);
  });

  it('gives a Claude routine the same honest reason, not the Windows one', () => {
    // The root-cause half: fixing this only for Vercel would have left the
    // sibling platform still misrouted.
    const result = scoreTask(vercelTask({ platform: PlatformType.CLAUDE_CODE, metadata: {} }), NOW);
    expect(result.tier).toBe('unknown');
    expect(JSON.stringify(result.signals)).not.toMatch(/republish/i);
  });
});

describe('summarizeHealth', () => {
  it('counts each tier for the badge', () => {
    const results = [
      scoreTask(windowsTask({ lastTaskResult: 1 }), NOW),
      scoreTask(windowsTask({ numberOfMissedRuns: 2 }), NOW),
      scoreTask(windowsTask({ lastTaskResult: 0 }), NOW),
      scoreTask(windowsTask({}, { metadata: {} }), NOW)
    ];
    expect(summarizeHealth(results)).toEqual({ tasks: 4, critical: 1, attention: 1, unknown: 1, ok: 1 });
  });
});
