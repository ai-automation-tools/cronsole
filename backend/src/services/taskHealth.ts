/**
 * Automation health — "which of my tasks need attention?"
 *
 * A score is a summary, and a summary is a **claim**. This project's whole
 * failure mode is a confident lie, so three rules shape everything here:
 *
 *  1. **Score only what can be evidenced.** Every signal names the field it was
 *     derived from, and that evidence travels to the UI beside the number. A
 *     task is never "unhealthy because the model says so".
 *  2. **Absence of evidence is `unknown`, never `ok`.** Silence is the easiest
 *     thing in the world to mistake for health, and here it would be wrong at
 *     dashboard scale — see the platform note below.
 *  3. **The number ranks; it does not grade.** Each signal carries a fixed
 *     weight and the score is 100 minus their sum. Its job is to sort 352 tasks
 *     worst-first, which needs a scalar. It is not a percentage of anything and
 *     the UI never shows it alone.
 *
 * ## Two platforms, two sources of truth
 *
 * `ExecutionLog` records runs **TaskHub performed** — a Windows task firing on
 * its own schedule writes nothing there. So:
 *
 * - **TaskHub-native** tasks score from `ExecutionLog`, which genuinely *is*
 *   their run history (`NativeScheduler` executes the work and records it).
 * - **Windows** tasks score from what **Windows itself** reports: `lastRunTime`,
 *   `lastTaskResult` (the exit code), and `numberOfMissedRuns`, carried in the
 *   sync snapshot. Scoring these from `ExecutionLog` would have marked nearly
 *   every task on a real machine as never-run.
 *
 * Signals that cannot exist for a platform are **absent**, not defaulted to
 * healthy: a fire-and-forget Windows trigger has no meaningful duration, so it
 * has no duration signal at all.
 */

import { PlatformType, TaskStatus, ExecutionStatus } from '@prisma/client';
import { TaskService } from './TaskService.js';

export type HealthTier = 'ok' | 'attention' | 'critical' | 'unknown';

export interface HealthSignal {
  /** Stable identifier — the UI keys copy and icons off this, not the prose. */
  code: string;
  severity: 'critical' | 'warn' | 'info';
  /** One sentence a user can act on. */
  summary: string;
  /** **Where this came from.** Never omitted: a claim without its source is the thing we are avoiding. */
  evidence: string;
  /** Points deducted. `info` signals always weigh 0 — they explain, they don't judge. */
  weight: number;
}

export interface TaskHealth {
  taskId: string;
  name: string;
  platform: PlatformType;
  category: string;
  /**
   * Windows' own task, per the server's single definition
   * (`TaskService.isSystemTask`). Carried so the UI can apply the same
   * personal/system lens the dashboard already uses: on a real machine 257 of
   * 354 tasks are `\Microsoft\`, and a "needs attention" list led by
   * `AikCertEnrollTask` re-creates the exact burial the lens exists to prevent.
   */
  isSystem: boolean;
  tier: HealthTier;
  /** 0–100, or null when there is nothing to score. A ranking key, not a grade. */
  score: number | null;
  signals: HealthSignal[];
}

export interface HealthExecution {
  status: ExecutionStatus;
  triggeredAt: Date;
  durationMs: number | null;
}

export interface HealthInputTask {
  id: string;
  name: string;
  platform: PlatformType;
  category: string;
  /** The platform's native id — used only to ask whether Windows owns this task. */
  externalId: string;
  status: TaskStatus;
  schedule: string | null;
  nextRunTime: Date | null;
  /** When this row was last written by a sync — the "as of" for platform evidence. */
  updatedAt: Date;
  /** The platform snapshot. For Windows: the agent's `task:list` payload. */
  metadata: unknown;
  /** Most recent first, bounded by the caller. */
  executions: HealthExecution[];
}

/**
 * Task Scheduler's informational result codes. These are **not** exit codes, and
 * treating them as failures is how "your task is broken" gets shown for a task
 * that is running perfectly well right now.
 */
const SCHED_CODES: Record<number, { severity: HealthSignal['severity']; summary: string } | null> = {
  0: null, // success
  267009: { severity: 'info', summary: 'The task is currently running.' },
  267010: { severity: 'info', summary: 'Windows reports the task as disabled.' },
  267011: null, // has not run yet — reported as "never run" from lastRunTime instead
  267014: { severity: 'warn', summary: 'The last run was terminated before it finished.' },
  // 0x40010004 DBG_TERMINATE_PROCESS — the process was killed, typically at
  // shutdown or by the task's own "stop if it runs longer than" setting. Seen on
  // a real machine reported as a plain exit code, which read as "the last run
  // failed" for a task that was simply cut short. Different fact, different fix.
  1073807364: { severity: 'warn', summary: 'The last run was stopped before it finished.' }
};

/** A task idle this long past its own next-run time is worth surfacing. */
const OVERDUE_GRACE_MS = 24 * 60 * 60 * 1000;

/** How much slower than typical a run has to be before it is worth mentioning. */
const DRIFT_MULTIPLE = 3;

const WEIGHTS = {
  missing: 60,
  lastRunFailed: 50,
  recentFailure: 45,
  failureStreak: 15,
  overdue: 20,
  neverRun: 20,
  missedRuns: 15,
  terminated: 15,
  durationDrift: 10
};

type WindowsSnapshot = {
  reportsRunResult: boolean;
  lastRunTime: Date | null;
  lastTaskResult: number | null;
  numberOfMissedRuns: number | null;
};

/**
 * Read the platform snapshot, keeping "the agent never told us" distinct from
 * "the agent told us there is nothing".
 *
 * That distinction is load-bearing. `lastTaskResult` only started being reported
 * in 2026-07-28's agent build, so **until an agent is republished the key is
 * absent entirely** — and reading absence as "never ran" would flag every
 * Windows task on the machine at once. Absent key → no evidence → `unknown`.
 * Present-but-null → the task genuinely has not run.
 */
export function readWindowsSnapshot(metadata: unknown): WindowsSnapshot {
  const m = (metadata && typeof metadata === 'object' ? metadata : {}) as Record<string, unknown>;
  const parseDate = (v: unknown) => {
    if (typeof v !== 'string' && typeof v !== 'number') return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) || d.getUTCFullYear() < 2000 ? null : d;
  };

  return {
    reportsRunResult: 'lastTaskResult' in m,
    lastRunTime: parseDate(m.lastRunTime),
    lastTaskResult: typeof m.lastTaskResult === 'number' ? m.lastTaskResult : null,
    numberOfMissedRuns: typeof m.numberOfMissedRuns === 'number' ? m.numberOfMissedRuns : null
  };
}

/** Median of a numeric sample. Median, not mean — one 40-minute outlier shouldn't set the baseline. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const ago = (date: Date, now: Date) => {
  const days = Math.floor((now.getTime() - date.getTime()) / 86400000);
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'} ago`;
  const hours = Math.floor((now.getTime() - date.getTime()) / 3600000);
  return hours >= 1 ? `${hours} hour${hours === 1 ? '' : 's'} ago` : 'less than an hour ago';
};

/**
 * Score one task.
 *
 * Deliberately pure and `now`-injected so the time-relative signals (overdue,
 * last success age) are testable without freezing the clock globally.
 */
export function scoreTask(task: HealthInputTask, now: Date): TaskHealth {
  const signals: HealthSignal[] = [];
  const base = {
    taskId: task.id,
    name: task.name,
    platform: task.platform,
    category: task.category,
    // One definition of "Windows owns this", shared with the dashboard's lens.
    isSystem: TaskService.isSystemTask(task.externalId, task.platform)
  };

  const add = (
    code: string,
    severity: HealthSignal['severity'],
    summary: string,
    evidence: string,
    weight = 0
  ) => signals.push({ code, severity, summary, evidence, weight: severity === 'info' ? 0 : weight });

  // --- states that apply to every platform ---------------------------------

  if (task.status === TaskStatus.MISSING) {
    add(
      'missing',
      'critical',
      'The platform no longer has this task.',
      `TaskHub's last sync did not find ${task.name} on the platform`,
      WEIGHTS.missing
    );
    // Nothing else is worth saying about a task that is gone — every other
    // signal would be describing a snapshot of something that no longer exists.
    return { ...base, tier: 'critical', score: Math.max(0, 100 - WEIGHTS.missing), signals };
  }

  const disabled = task.status === TaskStatus.DISABLED;
  if (disabled) {
    // Explicitly NOT a deduction. Parking a task is the recommended safe action
    // — it is why `set_task_status` ships ungated over MCP — so scoring it as
    // unhealthy would punish the very behavior the product asks for.
    add('disabled', 'info', 'This task is disabled, so it will not run.', 'TaskHub task status is DISABLED');
  }

  if (!task.schedule) {
    add(
      'no-schedule',
      'info',
      'This task has no recurring schedule — it runs on demand or on an event.',
      'No cron-expressible trigger was found on the platform'
    );
  }

  // --- platform-specific evidence ------------------------------------------

  if (task.platform === PlatformType.TASKHUB_NATIVE) {
    scoreNativeExecutions(task, now, add, disabled);
  } else {
    const snapshot = readWindowsSnapshot(task.metadata);

    if (!snapshot.reportsRunResult) {
      // The agent predates run-result reporting. Say so rather than guessing —
      // and note this is *why* it is unknown, so nobody debugs a task that is fine.
      add(
        'no-run-evidence',
        'info',
        'TaskHub has no run results for this task yet.',
        'The connected agent does not report last-run results — republish the agent to enable health checks'
      );
      return { ...base, tier: 'unknown', score: null, signals };
    }

    scoreWindowsSnapshot(task, snapshot, now, add, disabled);
  }

  return finalize(base, signals);
}

function scoreNativeExecutions(
  task: HealthInputTask,
  now: Date,
  add: (c: string, s: HealthSignal['severity'], sum: string, ev: string, w?: number) => void,
  disabled: boolean
) {
  const runs = task.executions;

  if (runs.length === 0) {
    if (!disabled) {
      add(
        'never-run',
        'warn',
        'This task has never run.',
        'TaskHub has no execution records for it',
        WEIGHTS.neverRun
      );
    }
    return;
  }

  const [latest] = runs;
  const failed = (r: HealthExecution) => r.status === 'FAILURE' || r.status === 'TIMEOUT';

  if (failed(latest)) {
    add(
      'recent-failure',
      'critical',
      `The most recent run ${latest.status === 'TIMEOUT' ? 'timed out' : 'failed'}.`,
      `Execution record from ${ago(latest.triggeredAt, now)} has status ${latest.status}`,
      WEIGHTS.recentFailure
    );

    const streak = runs.findIndex(r => !failed(r));
    const streakLength = streak === -1 ? runs.length : streak;
    if (streakLength >= 3) {
      add(
        'failure-streak',
        'critical',
        `The last ${streakLength} runs all failed.`,
        `${streakLength} consecutive failing execution records`,
        WEIGHTS.failureStreak
      );
    }
  }

  // Duration drift, native only: for a Windows task `durationMs` is the time to
  // *ask* the agent to start something, so comparing it would be meaningless.
  const durations = runs.filter(r => typeof r.durationMs === 'number').map(r => r.durationMs as number);
  if (durations.length >= 4 && typeof latest.durationMs === 'number') {
    const baseline = median(durations.slice(1));
    if (baseline > 0 && latest.durationMs >= baseline * DRIFT_MULTIPLE) {
      add(
        'duration-drift',
        'warn',
        'The last run took much longer than usual.',
        `${Math.round(latest.durationMs / 1000)}s against a typical ${Math.round(baseline / 1000)}s`,
        WEIGHTS.durationDrift
      );
    }
  }
}

function scoreWindowsSnapshot(
  task: HealthInputTask,
  snapshot: WindowsSnapshot,
  now: Date,
  add: (c: string, s: HealthSignal['severity'], sum: string, ev: string, w?: number) => void,
  disabled: boolean
) {
  const asOf = `as of the sync at ${task.updatedAt.toISOString()}`;

  if (snapshot.lastRunTime === null) {
    if (!disabled) {
      add(
        'never-run',
        'warn',
        'Windows has no record of this task ever running.',
        `Windows reported no last-run time ${asOf}`,
        WEIGHTS.neverRun
      );
    }
  } else if (snapshot.lastTaskResult !== null && snapshot.lastTaskResult !== 0) {
    const known = SCHED_CODES[snapshot.lastTaskResult];
    if (known === undefined) {
      // A genuine non-zero exit code from whatever the task runs.
      add(
        'last-run-failed',
        'critical',
        'The last run failed.',
        `Windows recorded exit code ${snapshot.lastTaskResult} for the run at ${snapshot.lastRunTime.toISOString()}`,
        WEIGHTS.lastRunFailed
      );
    } else if (known !== null) {
      add(
        known.severity === 'warn' ? 'run-terminated' : `sched-${snapshot.lastTaskResult}`,
        known.severity,
        known.summary,
        `Windows result code ${snapshot.lastTaskResult} for the run at ${snapshot.lastRunTime.toISOString()}`,
        WEIGHTS.terminated
      );
    }
  }

  if (snapshot.numberOfMissedRuns && snapshot.numberOfMissedRuns > 0) {
    add(
      'missed-runs',
      'warn',
      `Windows missed ${snapshot.numberOfMissedRuns} scheduled start${snapshot.numberOfMissedRuns === 1 ? '' : 's'}.`,
      `Windows reported ${snapshot.numberOfMissedRuns} missed runs ${asOf}`,
      WEIGHTS.missedRuns
    );
  }

  // Overdue is judged against the platform's OWN next-run time, and the evidence
  // names the snapshot it came from — otherwise a stale sync would read as a
  // stalled task.
  if (
    !disabled &&
    task.nextRunTime &&
    now.getTime() - task.nextRunTime.getTime() > OVERDUE_GRACE_MS &&
    (snapshot.lastRunTime === null || snapshot.lastRunTime < task.nextRunTime)
  ) {
    add(
      'overdue',
      'warn',
      'This task was due to run and there is no sign that it did.',
      `Windows expected a run at ${task.nextRunTime.toISOString()} (${ago(task.nextRunTime, now)}) and reported no later run ${asOf}`,
      WEIGHTS.overdue
    );
  }
}

function finalize(
  base: Pick<TaskHealth, 'taskId' | 'name' | 'platform' | 'category' | 'isSystem'>,
  signals: HealthSignal[]
): TaskHealth {
  const deduction = signals.reduce((sum, s) => sum + s.weight, 0);
  const score = Math.max(0, Math.min(100, 100 - deduction));

  const tier: HealthTier = signals.some(s => s.severity === 'critical')
    ? 'critical'
    : signals.some(s => s.severity === 'warn')
      ? 'attention'
      : 'ok';

  return { ...base, tier, score, signals };
}

/** Rank a set of tasks worst-first, so "Needs attention" is the top of the list. */
export function rankByHealth(results: TaskHealth[]): TaskHealth[] {
  const tierOrder: Record<HealthTier, number> = { critical: 0, attention: 1, unknown: 2, ok: 3 };
  return [...results].sort(
    (a, b) =>
      tierOrder[a.tier] - tierOrder[b.tier] ||
      (a.score ?? 101) - (b.score ?? 101) ||
      a.name.localeCompare(b.name)
  );
}

/** The counts the dashboard badge and the view header report. */
export function summarizeHealth(results: TaskHealth[]) {
  return {
    tasks: results.length,
    critical: results.filter(r => r.tier === 'critical').length,
    attention: results.filter(r => r.tier === 'attention').length,
    unknown: results.filter(r => r.tier === 'unknown').length,
    ok: results.filter(r => r.tier === 'ok').length
  };
}
