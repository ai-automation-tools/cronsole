import { PlatformType, TaskStatus, type Task } from '@prisma/client';
import { prisma } from '../db.js';
import { computeNextRun } from '../utils/cron-next.js';
import { executeJob, NativeJob, NativeRunResult } from './NativeTaskExecutor.js';
import { notifyTasksChanged } from '../ws/uiChannel.js';
import { queueRunNotification } from './FailureNotificationService.js';
import { readTaskSecrets, TaskSecretDecryptError } from './taskSecrets.js';

const TICK_INTERVAL_MS = 30_000;
// Due times missed by more than this (server downtime) are skipped, not fired —
// unless the task's policy asks for a catch-up (ADR 0004).
export const MISSED_RUN_GRACE_MS = 5 * 60_000;

/**
 * What a run was started by, as it is written at the head of its log line:
 * `scheduled`, `catch-up`, `queued`, or `after "<predecessor>"` for a chained run.
 */
type RunKind = string;

/**
 * What the scheduler can say about itself, for the diagnostics report.
 *
 * `lastTickAt` is stamped when a tick **finishes**, not when one is scheduled —
 * a timer that fires into a wedged tick would otherwise keep writing a fresh
 * timestamp while nothing was actually being evaluated, which is the shape of
 * troubleshooting #40 (a verdict from a precondition) applied to a clock.
 */
export interface SchedulerStatus {
  running: boolean;
  lastTickAt: Date | null;
  lastTickError: string | null;
  tickIntervalMs: number;
}

/**
 * Run one task's job, resolving its stored secrets first (ADR 0003).
 *
 * A store that cannot be decrypted is reported as **this task's** failure, with
 * its own reason, rather than thrown — one task whose `ENCRYPTION_KEY` no longer
 * matches must not stop every other task from running. It is `ran: false`, so it
 * is never retried: it would fail identically on every attempt.
 */
async function runWithSecrets(taskId: string, job: NativeJob): Promise<NativeRunResult> {
  let secrets: Record<string, string>;
  try {
    secrets = await readTaskSecrets(taskId);
  } catch (err) {
    if (err instanceof TaskSecretDecryptError) {
      return { success: false, log: err.message, durationMs: 0, ran: false };
    }
    throw err;
  }
  return executeJob(job, secrets);
}

const jobOf = (task: Task): NativeJob | undefined => (task.metadata as any)?.job as NativeJob | undefined;

/**
 * In-process scheduler for TASKHUB_NATIVE tasks. Single instance.
 *
 * **A tick decides; it does not wait** (ADR 0004). It finds what is due, advances
 * each `nextRunTime` and starts the runs, and returns. Before 2026-11-06 the tick
 * awaited every run in turn, so one slow job held up every native task on the
 * install — not just the ones due beside it, because the next tick could not
 * start either.
 */
export class NativeScheduler {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private lastTickAt: Date | null = null;
  private lastTickError: string | null = null;
  /** Task ids with a run in progress, and whether one more is queued behind it. */
  private running = new Map<string, { queued: boolean }>();
  private inflight = new Set<Promise<void>>();
  /** The wait between retries. A field so a test can make it instant. */
  sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

  async start() {
    await this.backfillNextRunTimes();
    this.timer = setInterval(() => void this.tick(), TICK_INTERVAL_MS);
    console.log('[NativeScheduler] started (tick every 30s)');
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Read-only self-report. `running` is the timer's existence, which is a real
   * fact about this process — but on its own it is exactly the "socket object
   * exists" evidence #40 rejected, so `lastTickAt` travels with it and the
   * diagnostics check reads both.
   */
  status(): SchedulerStatus {
    return {
      running: this.timer !== null,
      lastTickAt: this.lastTickAt,
      lastTickError: this.lastTickError,
      tickIntervalMs: TICK_INTERVAL_MS
    };
  }

  isRunning(taskId: string): boolean {
    return this.running.has(taskId);
  }

  /**
   * Mark a task as running, for a run started outside the tick (Run now), so the
   * scheduler's overlap rule sees it. False when one is already going.
   */
  claim(taskId: string): boolean {
    if (this.running.has(taskId)) return false;
    this.running.set(taskId, { queued: false });
    return true;
  }

  /** End a claimed run, starting the queued one if the overlap rule held one. */
  async release(taskId: string): Promise<void> {
    const entry = this.running.get(taskId);
    this.running.delete(taskId);
    if (!entry?.queued) return;
    // Re-read rather than reuse the row the first run started from: the job may
    // have been edited, or the task paused, while it ran.
    const fresh = await prisma.task.findUnique({ where: { id: taskId } });
    if (fresh && fresh.status === TaskStatus.ACTIVE) this.launch(fresh, 'queued');
  }

  /**
   * Start the tasks that run after this one, if this outcome is the one they
   * wait for (ROADMAP › Tier 2). Called once per finished run — the last attempt
   * of a scheduled run, or a Run now — never per retry, so a chain moves on the
   * verdict, not on a failure that a retry later fixed.
   *
   * Each dependent goes through `launch`, so its own overlap rule, retries and
   * dependents apply. A loop cannot form: `runAfterError` refuses one at save.
   */
  async afterRun(task: Task, result: NativeRunResult): Promise<void> {
    const dependents = await prisma.task.findMany({
      where: {
        userId: task.userId,
        platform: PlatformType.TASKHUB_NATIVE,
        status: TaskStatus.ACTIVE,
        metadata: { path: ['job', 'policy', 'runAfter', 'taskId'], equals: task.id }
      }
    });
    for (const dependent of dependents) {
      const runAfter = jobOf(dependent)?.policy?.runAfter;
      if (runAfter?.taskId !== task.id) continue; // the JSON filter is the index; this is the rule
      const when = runAfter.when ?? 'success';
      if (when === 'always' || (when === 'success') === result.success) {
        this.launch(dependent, `after "${task.name}"`);
      }
    }
  }

  /** Resolves once every run started so far — and any run they queued — has ended. */
  async idle(): Promise<void> {
    while (this.inflight.size) await Promise.all([...this.inflight]);
  }

  /** Ensure every active native task has a nextRunTime (new deploys, crashed writes). */
  private async backfillNextRunTimes() {
    const missing = await prisma.task.findMany({
      where: { platform: PlatformType.TASKHUB_NATIVE, status: TaskStatus.ACTIVE, nextRunTime: null }
    });
    for (const task of missing) {
      const next = task.schedule ? computeNextRun(task.schedule) : null;
      await prisma.task.update({ where: { id: task.id }, data: { nextRunTime: next } });
    }
    if (missing.length > 0) {
      console.log(`[NativeScheduler] backfilled nextRunTime for ${missing.length} task(s)`);
    }
  }

  async tick(now: Date = new Date()) {
    if (this.ticking) return; // a tick is DB work only now, but two must still not interleave
    this.ticking = true;
    try {
      const due = await prisma.task.findMany({
        where: {
          platform: PlatformType.TASKHUB_NATIVE,
          status: TaskStatus.ACTIVE,
          nextRunTime: { lte: now }
        }
      });

      // Collect users whose tasks changed this tick, so open dashboards get one
      // live push per user instead of one per task.
      const changedUsers = new Set<string>();

      for (const task of due) {
        const next = task.schedule ? computeNextRun(task.schedule, now) : null;
        const missedBy = now.getTime() - (task.nextRunTime?.getTime() ?? now.getTime());

        // Advance the schedule first so a crash mid-run can't double-fire. It is
        // advanced from *now*, which is also what makes a catch-up run once
        // rather than once per slot missed.
        await prisma.task.update({ where: { id: task.id }, data: { nextRunTime: next } });
        changedUsers.add(task.userId);

        let kind: RunKind = 'scheduled';
        if (missedBy > MISSED_RUN_GRACE_MS) {
          if (!jobOf(task)?.policy?.catchUp) {
            console.log(`[NativeScheduler] skipping missed run for "${task.name}" (late by ${Math.round(missedBy / 1000)}s)`);
            continue;
          }
          kind = 'catch-up';
        }
        this.launch(task, kind);
      }

      // Push one live update per affected user's open dashboards.
      for (const userId of changedUsers) notifyTasksChanged(userId);
      this.lastTickError = null;
    } catch (error) {
      console.error('[NativeScheduler] tick error:', error);
      // Kept rather than only logged: a scheduler that is running and failing
      // every tick is indistinguishable from a healthy one in the console of a
      // container nobody is watching, and it is the exact state in which native
      // tasks silently stop firing.
      this.lastTickError = error instanceof Error ? error.message : String(error);
    } finally {
      // Stamped in `finally` so a failed tick still counts as a tick. The
      // question this answers is "is the loop alive", and a tick that threw is
      // evidence that it is — the error is reported separately, beside it.
      this.lastTickAt = new Date();
      this.ticking = false;
    }
  }

  /**
   * Start a run without waiting for it, applying the task's overlap rule.
   *
   * ponytail: no global concurrency cap (ADR 0004 rejects one: it brings back the
   * head-of-line blocking this replaced). Add one here if an install ever runs
   * hundreds of native jobs at the same minute.
   */
  private launch(task: Task, kind: RunKind) {
    const current = this.running.get(task.id);
    if (current) {
      if (jobOf(task)?.policy?.overlap === 'queue' && !current.queued) {
        current.queued = true;
        console.log(`[NativeScheduler] "${task.name}" is still running; one run queued behind it`);
      } else {
        console.log(`[NativeScheduler] "${task.name}" is still running; this run was skipped`);
      }
      return;
    }
    this.running.set(task.id, { queued: false });
    const run: Promise<void> = this.runWithRetries(task, kind)
      .catch(error => console.error(`[NativeScheduler] run of "${task.name}" failed to record:`, error))
      .finally(async () => {
        this.inflight.delete(run);
        await this.release(task.id);
      });
    this.inflight.add(run);
  }

  /**
   * One scheduled run, plus its retries (ADR 0004 §3).
   *
   * A retry follows only a run that **ran and failed**. A run that could not
   * start (`ran: false`) fails the same way every time, and a CHECK's failure is
   * a measurement — `validateJob` refuses retries on one, and this guards a row
   * stored before that rule. Every attempt is its own `ExecutionLog` row; only
   * the last one notifies, or one failure would send an alert per attempt.
   */
  private async runWithRetries(task: Task, kind: RunKind) {
    const job = jobOf(task);
    const policy = job?.policy;
    const attempts = 1 + (job && job.jobType !== 'CHECK' ? policy?.retries ?? 0 : 0);
    const delayMs = (policy?.retryDelayMinutes ?? 1) * 60_000;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      // The row is written after the run ends, so its default `now()` would be
      // the finish time — a 24-hour job would be listed a day after it started.
      const triggeredAt = new Date();
      const result: NativeRunResult = job
        ? await runWithSecrets(task.id, job)
        : { success: false, log: 'Task has no job spec in metadata.job', durationMs: 0, ran: false };
      const last = result.success || !result.ran || attempt === attempts;
      const label = attempts > 1 ? `[${kind} · attempt ${attempt} of ${attempts}]` : `[${kind}]`;
      const status = result.success ? 'SUCCESS' : 'FAILURE';

      const execution = await prisma.executionLog.create({
        data: { taskId: task.id, status, log: `${label} ${result.log}`, durationMs: result.durationMs, triggeredAt }
      });
      console.log(`[NativeScheduler] ran "${task.name}" ${label}: ${status}`);
      notifyTasksChanged(task.userId);

      if (last) {
        queueRunNotification({
          task,
          trigger: 'scheduled',
          status,
          message: result.log,
          durationMs: result.durationMs,
          executionId: execution.id,
          triggeredAt: execution.triggeredAt
        });
        await this.afterRun(task, result);
        return;
      }
      await this.sleep(delayMs);
    }
  }
}

export const nativeScheduler = new NativeScheduler();
