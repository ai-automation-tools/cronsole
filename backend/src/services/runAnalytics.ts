/**
 * Execution analytics — the three questions a per-task history cannot answer:
 * *"what failed this month?"*, *"which tasks are getting slower?"*, and
 * *"what hasn't run lately?"*
 *
 * The bulk read this needs shipped with the health score; this module is the
 * analysis on top of it. Everything here is pure and `now`-injected so the
 * time-relative parts are testable without freezing a clock or standing up a
 * database — the same shape as `taskHealth.ts`, and for the same reason.
 *
 * ## The rule every section here obeys
 *
 * `ExecutionLog` records runs **Cronsole performed**, not runs that *happened*
 * (see `runHistory.ts` for the full statement). That single fact decides the
 * design of all three sections, differently each time:
 *
 * - **Failure trend** reads `ExecutionLog` and is *labelled* as Cronsole-performed
 *   runs. An empty week means Cronsole triggered nothing, not that nothing ran,
 *   and a chart that doesn't say so answers a different question than the one
 *   it was asked.
 * - **Duration trend** reads `ExecutionLog` too, but **only `native-execution`
 *   rows**. For a Windows task `durationMs` times the round trip of *asking the
 *   agent to start something* — ranking those by duration compares handshakes,
 *   not jobs. The rows dropped for this reason are counted out loud.
 * - **Idle tasks** cannot use `ExecutionLog` as the primary source at all: a
 *   Windows task firing on its own schedule writes nothing there, so "no rows in
 *   30 days" would flag every task on the machine. Windows tasks are judged from
 *   **Windows' own `lastRunTime`** in the sync snapshot; native tasks from
 *   `ExecutionLog`, which genuinely is their history.
 *
 * And the rule inherited from the health scorer, which applies hardest here:
 * **absence of evidence is `unknown`, never a verdict.** A task Cronsole has no
 * run evidence for is not idle — it is unmeasured, and the two are reported
 * separately.
 */

import { ExecutionStatus, PlatformType, TaskStatus } from '@prisma/client';
import { TaskService } from './TaskService.js';
import { readWindowsSnapshot } from './taskHealth.js';

// --- failure trend ---------------------------------------------------------

/** One day's runs, in the caller's timezone. */
export interface TrendDay {
  /** `YYYY-MM-DD` in the requested timezone. */
  day: string;
  runs: number;
  succeeded: number;
  failed: number;
  pending: number;
}

export interface TrendInput {
  triggeredAt: Date;
  status: ExecutionStatus;
}

/**
 * The calendar day a timestamp falls on **in a given timezone**.
 *
 * Bucketing in UTC while the reader thinks in local days is a quiet lie: a run
 * at 6pm Pacific lands on tomorrow's bar. Cronsole already stores every schedule
 * in UTC and displays local (CLAUDE.md §9), so the trend follows the same rule
 * — and the response states which zone was used, because a chart whose buckets
 * are unlabelled is not reproducible.
 */
export function dayKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Is this a timezone the platform actually knows?
 *
 * Checked before it reaches a query or a label, so an unknown zone is a 400 that
 * names the problem rather than a silent fall back to UTC — a chart bucketed in
 * the wrong zone looks exactly like a chart bucketed in the right one.
 */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Step one calendar day forward from a `YYYY-MM-DD` key. */
function nextDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return next.toISOString().slice(0, 10);
}

/**
 * Roll runs up into one bar per day, **including the days with no runs**.
 *
 * Zero-filling is not cosmetic. A trend plotted from only the days that have
 * rows draws a continuous line across a two-week gap, which reads as "it kept
 * running" — the exact opposite of what the gap means. The empty days are the
 * signal.
 *
 * The span is given rather than inferred from the rows so an empty period still
 * renders as a period, and so a capped fetch can honestly narrow the span it
 * claims to cover instead of thinning the chart inside it.
 */
export function bucketByDay(
  rows: TrendInput[],
  span: { from: Date; to: Date },
  timeZone: string
): TrendDay[] {
  const buckets = new Map<string, TrendDay>();

  const first = dayKey(span.from, timeZone);
  const last = dayKey(span.to, timeZone);
  for (let day = first; ; day = nextDay(day)) {
    buckets.set(day, { day, runs: 0, succeeded: 0, failed: 0, pending: 0 });
    if (day === last || day > last) break;
  }

  for (const row of rows) {
    const bucket = buckets.get(dayKey(row.triggeredAt, timeZone));
    // A row outside the span can only mean the caller passed rows and a span
    // that disagree; dropping it silently would put a bar nowhere.
    if (!bucket) continue;

    bucket.runs++;
    if (row.status === ExecutionStatus.SUCCESS) bucket.succeeded++;
    else if (row.status === ExecutionStatus.FAILURE || row.status === ExecutionStatus.TIMEOUT) bucket.failed++;
    else if (row.status === ExecutionStatus.PENDING) bucket.pending++;
  }

  return [...buckets.values()].sort((a, b) => a.day.localeCompare(b.day));
}

// --- duration trend --------------------------------------------------------

export interface DurationInput {
  taskId: string;
  taskName: string;
  platform: PlatformType;
  triggeredAt: Date;
  durationMs: number | null;
  status: ExecutionStatus;
}

export interface DurationTrend {
  taskId: string;
  name: string;
  /** Median of the most recent runs. Median, not mean — one outlier is not a trend. */
  recentMedianMs: number;
  /** Median of everything before those. */
  baselineMedianMs: number;
  /** `recent / baseline`. 1.0 is unchanged; 2.0 is twice as slow. */
  changeRatio: number;
  recentSamples: number;
  baselineSamples: number;
}

export interface DurationReport {
  /** Rows that could legitimately be measured. */
  considered: number;
  /**
   * Rows dropped because they time a *handshake*, not a job. Named rather than
   * quietly filtered: on a Windows-heavy install this is nearly every row, and a
   * near-empty duration report with no explanation reads as a broken feature.
   */
  excludedManualTriggerRuns: number;
  /** How many runs a task needs on each side before it is worth comparing. */
  minimumSamplesPerSide: number;
  /** Slowest-growing first. Only tasks that met the sample threshold appear. */
  tasks: DurationTrend[];
}

/** How many recent runs form the "now" side of the comparison. */
const RECENT_WINDOW = 5;

/** Below this, a "trend" is two data points and a coincidence. */
const MIN_SAMPLES_PER_SIDE = 2;

/** Median of a non-empty sample. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * "Which tasks are getting slower?" — recent median duration against the earlier
 * baseline, per task.
 *
 * **Cronsole-native rows only.** This is the one place where including Windows
 * would produce numbers that look perfectly reasonable and mean nothing: those
 * durations measure how long the agent took to accept a start request, so a
 * "task" at the top of a slowest-first list would really be a slow WebSocket
 * round trip. `taskHealth.ts` restricts its own duration-drift signal for the
 * same reason; this is that rule applied across tasks instead of within one.
 */
export function analyzeDurations(rows: DurationInput[]): DurationReport {
  const usable = rows.filter(
    r => r.platform === PlatformType.TASKHUB_NATIVE && typeof r.durationMs === 'number'
  );
  const excluded = rows.filter(r => r.platform !== PlatformType.TASKHUB_NATIVE).length;

  const byTask = new Map<string, DurationInput[]>();
  for (const row of usable) {
    const list = byTask.get(row.taskId);
    if (list) list.push(row);
    else byTask.set(row.taskId, [row]);
  }

  const tasks: DurationTrend[] = [];
  for (const [taskId, runs] of byTask) {
    // Newest first, so "recent" is the head of the list regardless of the order
    // the caller fetched them in.
    const ordered = [...runs].sort((a, b) => b.triggeredAt.getTime() - a.triggeredAt.getTime());
    const recent = ordered.slice(0, RECENT_WINDOW);
    const baseline = ordered.slice(RECENT_WINDOW);

    if (recent.length < MIN_SAMPLES_PER_SIDE || baseline.length < MIN_SAMPLES_PER_SIDE) continue;

    const recentMedianMs = median(recent.map(r => r.durationMs as number));
    const baselineMedianMs = median(baseline.map(r => r.durationMs as number));
    // A zero baseline makes the ratio meaningless rather than infinite; a task
    // whose runs used to take no measurable time has nothing to compare against.
    if (baselineMedianMs <= 0) continue;

    tasks.push({
      taskId,
      name: ordered[0].taskName,
      recentMedianMs,
      baselineMedianMs,
      changeRatio: recentMedianMs / baselineMedianMs,
      recentSamples: recent.length,
      baselineSamples: baseline.length
    });
  }

  return {
    considered: usable.length,
    excludedManualTriggerRuns: excluded,
    minimumSamplesPerSide: MIN_SAMPLES_PER_SIDE,
    tasks: tasks.sort((a, b) => b.changeRatio - a.changeRatio || a.name.localeCompare(b.name))
  };
}

// --- idle tasks ------------------------------------------------------------

export interface IdleInputTask {
  id: string;
  name: string;
  platform: PlatformType;
  category: string;
  externalId: string;
  status: TaskStatus;
  schedule: string | null;
  /** When this row was last written by a sync — the "as of" for platform evidence. */
  updatedAt: Date;
  /** The platform snapshot. For Windows: the agent's `task:list` payload. */
  metadata: unknown;
  /** Newest `ExecutionLog.triggeredAt` for this task, or null if it has none. */
  lastExecutionAt: Date | null;
}

export interface IdleTask {
  taskId: string;
  name: string;
  platform: PlatformType;
  category: string;
  isSystem: boolean;
  lastRunAt: Date;
  daysSinceLastRun: number;
  /** **Where that date came from.** Never omitted — the two sources are not interchangeable. */
  evidence: string;
}

/** A task that could not be judged, and why. Not idle; unmeasured. */
export interface UnassessedTask {
  taskId: string;
  name: string;
  platform: PlatformType;
  isSystem: boolean;
  reason: 'disabled' | 'no-schedule' | 'never-run' | 'no-run-evidence';
  evidence: string;
}

export interface IdleReport {
  thresholdDays: number;
  /** Longest-idle first. */
  tasks: IdleTask[];
  /** Everything deliberately not judged, with its reason. */
  unassessed: UnassessedTask[];
}

const DAY_MS = 86400000;

/**
 * "What hasn't run lately?"
 *
 * Four groups come out of this rather than two, because three different things
 * all look like silence and only one of them is a problem:
 *
 * - **Idle** — evidence of a last run, and it is older than the threshold.
 * - **Never run** — evidence that it has *never* run. A different fact from
 *   "ran, but a while ago", and a different fix.
 * - **No run evidence** — the agent has never reported a last-run time for it.
 *   Reporting this as idle would flag the whole machine the moment an agent is
 *   a version behind, which is precisely the mistake the health score was
 *   redesigned to avoid.
 * - **Disabled / unscheduled** — not running is what these are *supposed* to do.
 *   Parking a task is the recommended safe action, and an on-demand task has no
 *   schedule to be late for. Listing either as a problem punishes correct use.
 *
 * System tasks are scored like any other and carry `isSystem`, so the caller
 * applies the same personal/system lens the dashboard and the health card do —
 * hidden by default, count named. Filtering them here would leave the caller
 * unable to say how many were hidden.
 */
export function findIdleTasks(tasks: IdleInputTask[], now: Date, thresholdDays: number): IdleReport {
  const idle: IdleTask[] = [];
  const unassessed: UnassessedTask[] = [];

  for (const task of tasks) {
    const base = {
      taskId: task.id,
      name: task.name,
      platform: task.platform,
      isSystem: TaskService.isSystemTask(task.externalId, task.platform)
    };

    if (task.status === TaskStatus.DISABLED) {
      unassessed.push({
        ...base,
        reason: 'disabled',
        evidence: 'Cronsole task status is DISABLED — not running is the point'
      });
      continue;
    }

    if (!task.schedule) {
      unassessed.push({
        ...base,
        reason: 'no-schedule',
        evidence: 'No cron-expressible trigger — this task runs on demand or on an event'
      });
      continue;
    }

    // Two platforms, two sources of truth. Getting this backwards is what would
    // make the whole feature wrong at dashboard scale.
    let lastRunAt: Date | null;
    let evidence: string;

    if (task.platform === PlatformType.TASKHUB_NATIVE) {
      lastRunAt = task.lastExecutionAt;
      evidence = lastRunAt
        ? `Cronsole's own execution record from ${lastRunAt.toISOString()}`
        : 'Cronsole has no execution records for this task';
      if (!lastRunAt) {
        unassessed.push({ ...base, reason: 'never-run', evidence });
        continue;
      }
    } else {
      const snapshot = readWindowsSnapshot(task.metadata);
      if (!snapshot.reportsLastRun) {
        unassessed.push({
          ...base,
          reason: 'no-run-evidence',
          evidence: 'The connected agent has not reported a last-run time for this task'
        });
        continue;
      }
      lastRunAt = snapshot.lastRunTime;
      if (!lastRunAt) {
        unassessed.push({
          ...base,
          reason: 'never-run',
          evidence: `Windows reported no last-run time as of the sync at ${task.updatedAt.toISOString()}`
        });
        continue;
      }
      evidence = `Windows reported a last run at ${lastRunAt.toISOString()}, as of the sync at ${task.updatedAt.toISOString()}`;
    }

    const days = Math.floor((now.getTime() - lastRunAt.getTime()) / DAY_MS);
    if (days >= thresholdDays) {
      idle.push({
        ...base,
        category: task.category,
        lastRunAt,
        daysSinceLastRun: days,
        evidence
      });
    }
  }

  return {
    thresholdDays,
    tasks: idle.sort((a, b) => b.daysSinceLastRun - a.daysSinceLastRun || a.name.localeCompare(b.name)),
    unassessed
  };
}
