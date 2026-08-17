import { randomBytes } from 'crypto';
import { Prisma, PlatformType, Task, TaskStatus } from '@prisma/client';
import { prisma } from '../db.js';
import { validateJob, NativeJob } from './NativeTaskExecutor.js';
import { buildNativeJob } from './nativeJob.js';
import { recordCapability } from './platformCapabilities.js';
import { notifyTasksChanged } from '../ws/uiChannel.js';
import { computeNextRun } from '../utils/cron-next.js';

/**
 * One definition of "write a Cronsole-native task into the database".
 *
 * `buildNativeJob` already guarantees that every write path stores a job shape
 * the executor can read. This is the same argument one layer out, for everything
 * *around* the job: the cron has to be validated before it is stored (a row with
 * no `nextRunTime` is a task the scheduler will never pick up), the capability
 * evidence has to be recorded, and the UI has to be told. Three callers need all
 * of that — `POST /api/tasks/native`, `POST /api/tasks/import`, and restoring a
 * deleted task from its archive — and a rule that each call site has to remember
 * is one the fourth caller forgets.
 *
 * Deliberately NOT used by `CronsoleNativeConnector.createTask`: that path comes
 * through `TaskService.upsertTasks` with a platform-shaped row, and folding it in
 * here would mean one function with two storage models.
 */

/** A refusal the caller should surface as a 400 — bad input, not a bug. */
export class NativeTaskCreateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NativeTaskCreateError';
  }
}

export interface NativeTaskInput {
  name: string;
  /** Cronsole label. Defaults to `Cronsole` — the platform owns neither name nor category. */
  category?: string;
  /** 5-field cron, **UTC** — the storage contract (CLAUDE.md §9 › Data model). */
  schedule: string;
  /** Normalized by `buildNativeJob`, then checked by the executor's own `validateJob`. */
  job: unknown;
}

export async function createNativeTask(userId: string, input: NativeTaskInput): Promise<Task> {
  const nextRunTime = computeNextRun(input.schedule);
  if (!nextRunTime) {
    throw new NativeTaskCreateError('Schedule must be a valid 5-field cron expression (UTC).');
  }

  // Normalize first, then validate **what will actually be stored** rather than
  // what arrived. The two differ for an EXEC job sent as a `command` line, and
  // validating the input would check a shape the executor never sees.
  const nativeJob: NativeJob = buildNativeJob(input.job as Record<string, unknown>);
  const jobError = validateJob(nativeJob);
  if (jobError) {
    throw new NativeTaskCreateError(jobError);
  }

  const task = await prisma.task.create({
    data: {
      userId,
      platform: PlatformType.TASKHUB_NATIVE,
      externalId: `native_${randomBytes(8).toString('hex')}`,
      name: input.name,
      category: input.category ?? 'Cronsole',
      schedule: input.schedule,
      nextRunTime,
      status: TaskStatus.ACTIVE,
      metadata: { job: nativeJob } as unknown as Prisma.InputJsonValue
    }
  });

  await recordCapability(userId, PlatformType.TASKHUB_NATIVE, 'create', true);
  notifyTasksChanged(userId);
  return task;
}
