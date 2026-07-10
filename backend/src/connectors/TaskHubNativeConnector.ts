import { randomBytes } from 'crypto';
import { Prisma, PlatformType, HealthState, TaskStatus } from '@prisma/client';
import { prisma } from '../db.js';
import { PlatformConnector, TaskInfo, ConnectorHealth, CreateTaskOptions } from './platform.interface.js';
import { executeJob, NativeJob } from '../services/NativeTaskExecutor.js';
import { computeNextRun } from '../utils/cron-next.js';

/**
 * Connector for tasks that live only in TaskHub: the database is the platform
 * and the backend's NativeScheduler is the execution engine
 * (docs/resources/Native_Tasks.md).
 */
export class TaskHubNativeConnector implements PlatformConnector {
  platform = PlatformType.TASKHUB_NATIVE;

  async syncTasks(_config: any): Promise<TaskInfo[]> {
    // Native tasks already live in the Task table; there is no external
    // system to pull from, and returning [] keeps the generic sync route from
    // duplicating them.
    return [];
  }

  async runTask(externalId: string, _config: any): Promise<{ success: boolean; platformRunId?: string; message?: string }> {
    const task = await prisma.task.findUnique({
      where: { platform_externalId: { platform: this.platform, externalId } }
    });
    if (!task) {
      return { success: false, message: 'Native task not found' };
    }

    const job = (task.metadata as any)?.job as NativeJob | undefined;
    if (!job) {
      return { success: false, message: 'Task has no job spec in metadata.job' };
    }

    const result = await executeJob(job);
    return { success: result.success, message: result.log };
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
    return { state: HealthState.HEALTHY, lastSync: new Date() };
  }

  async createTask(name: string, schedule: string, command: string, config: any, _options?: CreateTaskOptions): Promise<{ success: boolean; externalId?: string; message?: string }> {
    // Template/clone flows hand us a command string; for native tasks a URL
    // command becomes an HTTP GET job. Richer specs go through POST /api/tasks/native.
    if (!/^https?:\/\//i.test(command.trim())) {
      return {
        success: false,
        message: 'Native tasks currently support HTTP jobs only — the command must be a URL (or use POST /api/tasks/native).'
      };
    }

    const job: NativeJob = { jobType: 'HTTP', url: command.trim(), method: 'GET' };
    const externalId = `native_${randomBytes(8).toString('hex')}`;

    await prisma.task.create({
      data: {
        userId: config.userId,
        platform: this.platform,
        externalId,
        name,
        schedule,
        nextRunTime: computeNextRun(schedule),
        status: TaskStatus.ACTIVE,
        metadata: { job } as unknown as Prisma.InputJsonValue
      }
    });

    return { success: true, externalId };
  }
}
