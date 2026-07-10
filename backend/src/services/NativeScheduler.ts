import { PlatformType, TaskStatus } from '@prisma/client';
import { prisma } from '../db.js';
import { computeNextRun } from '../utils/cron-next.js';
import { executeJob, NativeJob } from './NativeTaskExecutor.js';
import { notifyTasksChanged } from '../ws/uiChannel.js';
import { queueFailureNotification } from './FailureNotificationService.js';

const TICK_INTERVAL_MS = 30_000;
// Due times missed by more than this (server downtime) are skipped, not fired.
export const MISSED_RUN_GRACE_MS = 5 * 60_000;

/**
 * In-process scheduler for TASKHUB_NATIVE tasks: fires due tasks, logs each run
 * to ExecutionLog, and advances nextRunTime. Single-instance only for MVP
 * (docs/resources/Native_Tasks.md).
 */
export class NativeScheduler {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  async start() {
    await this.backfillNextRunTimes();
    this.timer = setInterval(() => void this.tick(), TICK_INTERVAL_MS);
    console.log('[NativeScheduler] started (tick every 30s)');
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
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
    if (this.ticking) return; // don't overlap slow ticks
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

        // Advance the schedule first so a crash mid-run can't double-fire.
        await prisma.task.update({ where: { id: task.id }, data: { nextRunTime: next } });
        changedUsers.add(task.userId);

        if (missedBy > MISSED_RUN_GRACE_MS) {
          console.log(`[NativeScheduler] skipping missed run for "${task.name}" (late by ${Math.round(missedBy / 1000)}s)`);
          continue;
        }

        const job = (task.metadata as any)?.job as NativeJob | undefined;
        const result = job
          ? await executeJob(job)
          : { success: false, log: 'Task has no job spec in metadata.job', durationMs: 0 };

        const execution = await prisma.executionLog.create({
          data: {
            taskId: task.id,
            status: result.success ? 'SUCCESS' : 'FAILURE',
            log: `[scheduled] ${result.log}`,
            durationMs: result.durationMs
          }
        });
        if (!result.success) {
          queueFailureNotification({
            task,
            trigger: 'scheduled',
            status: 'FAILURE',
            message: result.log,
            durationMs: result.durationMs,
            executionId: execution.id,
            triggeredAt: execution.triggeredAt
          });
        }
        console.log(`[NativeScheduler] ran "${task.name}": ${result.success ? 'SUCCESS' : 'FAILURE'}`);
      }

      // Push one live update per affected user's open dashboards.
      for (const userId of changedUsers) notifyTasksChanged(userId);
    } catch (error) {
      console.error('[NativeScheduler] tick error:', error);
    } finally {
      this.ticking = false;
    }
  }
}

export const nativeScheduler = new NativeScheduler();
