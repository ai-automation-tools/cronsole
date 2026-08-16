import { randomBytes } from 'crypto';
import { Prisma, PlatformType, HealthState, TaskStatus } from '@prisma/client';
import { prisma } from '../db.js';
import { PlatformConnector, TaskInfo, ConnectorHealth, CreateTaskOptions } from './platform.interface.js';
import { executeJob, validateJob, NativeJob } from '../services/NativeTaskExecutor.js';
import { buildNativeJob, nativeJobFromCommand, isUrlCommand } from '../services/nativeJob.js';
import { computeNextRun } from '../utils/cron-next.js';

/**
 * Connector for tasks that live only in Cronsole: the database is the platform
 * and the backend's NativeScheduler is the execution engine
 * (docs/resources/Native_Tasks.md).
 */
export class CronsoleNativeConnector implements PlatformConnector {
  platform = PlatformType.TASKHUB_NATIVE;

  async syncTasks(_config: any): Promise<TaskInfo[]> {
    // Native tasks already live in the Task table; there is no external
    // system to pull from, and returning [] keeps the generic sync route from
    // duplicating them.
    return [];
  }

  async runTask(
    externalId: string,
    _config: any
  ): Promise<{ success: boolean; ran?: boolean; platformRunId?: string; message?: string }> {
    const task = await prisma.task.findUnique({
      where: { platform_externalId: { platform: this.platform, externalId } }
    });
    // Both of these are failures to *start*: nothing executed, so `ran` stays
    // false and the route answers 502. Only the executeJob result below is a
    // verdict about the user's system.
    if (!task) {
      return { success: false, message: 'Native task not found' };
    }

    const job = (task.metadata as any)?.job as NativeJob | undefined;
    if (!job) {
      return { success: false, message: 'Task has no job spec in metadata.job' };
    }

    // `ran` comes from the executor, not from "we got this far": a spec that
    // fails validateJob never executes, and reporting that as a verdict would
    // hand the user a "check failed" for a task that never ran.
    const result = await executeJob(job);
    return { success: result.success, ran: result.ran, message: result.log };
  }

  async setTaskStatus(externalId: string, enabled: boolean, _config: any): Promise<{ success: boolean }> {
    try {
      const task = await prisma.task.update({
        where: { platform_externalId: { platform: this.platform, externalId } },
        data: {
          status: enabled ? TaskStatus.ACTIVE : TaskStatus.DISABLED,
          // Re-arm the schedule on enable; clear it on disable.
          nextRunTime: enabled ? undefined : null
        }
      });
      if (enabled && task.schedule) {
        await prisma.task.update({
          where: { id: task.id },
          data: { nextRunTime: computeNextRun(task.schedule) }
        });
      }
      return { success: true };
    } catch {
      return { success: false };
    }
  }

  async getHealth(_config: any): Promise<ConnectorHealth> {
    // The scheduler runs in-process with this server; if we can answer, it's up.
    // No `lastSync`: native tasks are not synced from anywhere — they live in
    // this database. Stamping `new Date()` here would be a timestamp created by
    // the act of asking, and because the dashboard's "synced N ago" chip takes
    // the newest lastSync across all connections, this one connector would have
    // pinned it to "just now" no matter how stale every other platform was.
    return { state: HealthState.HEALTHY };
  }

  /**
   * Create a native task from a command string (template apply, clone).
   *
   * The connector interface hands every platform one `command`, so the job type
   * is derived from it — a URL is an HTTP job, anything else is a program —
   * through the same `buildNativeJob` + `validateJob` pair `POST /api/tasks/native`
   * and `PATCH /api/tasks/:id/job` use. **One definition, or a template applies
   * cleanly and stores a spec creation would have refused.**
   *
   * Until 2026-08-13 this refused every non-URL command outright ("native tasks
   * support HTTP jobs only"), which was true when native could only ping a URL
   * and false from the day it gained `EXEC` (2026-08-12). The visible cost was
   * that **Cronsole-native could not be a template target at all** — the one
   * source Cronsole fully owns had nothing in the library.
   *
   * The row is written here rather than by the caller because for this platform
   * the row *is* the task: `metadata.job` is the job, and an upsert that
   * replaced it with the `{schedule, command}` shape other platforms carry would
   * leave a task the executor cannot run.
   */
  async createTask(name: string, schedule: string, command: string, config: any, options?: CreateTaskOptions): Promise<{ success: boolean; externalId?: string; message?: string }> {
    // Prefer the structured action the route resolved from raw template
    // parameters over re-tokenizing the display string. They usually agree, and
    // where they do not is exactly the case that matters: a parameter value
    // containing a space is **one argument** in the structured form and two
    // after a round trip through the command line. Same reason the Windows
    // connector takes `options.action`.
    // A full spec outranks both, and must: a SCRIPT body and a CHECK probe have
    // no command-line form at all, so deriving a job from `command` for those
    // would silently turn a template's description string into an EXEC job.
    // Still through `buildNativeJob` + `validateJob` — a template is untrusted
    // content, and this is the same boundary the API and the edit route use.
    const job: NativeJob = options?.nativeJob
      ? buildNativeJob(options.nativeJob as Record<string, unknown>)
      : options?.action && !isUrlCommand(command)
        ? buildNativeJob({
            jobType: 'EXEC',
            executable: options.action.executable,
            args: options.action.args
          })
        : nativeJobFromCommand(command);
    const invalid = validateJob(job);
    if (invalid) {
      return { success: false, message: invalid };
    }

    const nextRunTime = computeNextRun(schedule);
    if (!nextRunTime) {
      return { success: false, message: 'Schedule must be a valid 5-field cron expression (UTC).' };
    }

    const externalId = `native_${randomBytes(8).toString('hex')}`;

    await prisma.task.create({
      data: {
        userId: config.userId,
        platform: this.platform,
        externalId,
        name,
        // Native has no folder to derive a category from, so it takes the
        // caller's label and otherwise files under Cronsole — the same default
        // `POST /api/tasks/native` uses, because two create paths landing tasks
        // in two different categories is a difference the user has to explain.
        category: options?.category ?? 'Cronsole',
        schedule,
        nextRunTime,
        status: TaskStatus.ACTIVE,
        metadata: { job } as unknown as Prisma.InputJsonValue
      }
    });

    return { success: true, externalId };
  }
}
