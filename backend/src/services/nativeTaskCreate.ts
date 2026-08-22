import { randomBytes } from 'crypto';
import { Prisma, PlatformType, Task, TaskStatus } from '@prisma/client';
import { prisma } from '../db.js';
import { validateJob, NativeJob } from './NativeTaskExecutor.js';
import { buildNativeJob } from './nativeJob.js';
import { recordCapability } from './platformCapabilities.js';
import { notifyTasksChanged } from '../ws/uiChannel.js';
import { computeNextRun } from '../utils/cron-next.js';
import { missingSecretRefs } from './jobSecrets.js';
import { replaceTaskSecrets, TaskSecretError } from './taskSecrets.js';

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
  /**
   * Secret name → value, stored encrypted and never returned (ADR 0003).
   *
   * Accepted **only here**, and only because a create has nothing to preserve:
   * "make this task and give it its credential" is one gesture rather than a
   * create followed by a second write that can fail on its own. Every other way
   * to change a secret is per secret, through its own route, so no client can
   * destroy one by forgetting to resend it.
   *
   * Absent for import and archive-restore, which carry a job that *names* its
   * secrets without holding any — the task is created with them unset and says
   * so through `missingSecrets`.
   */
  secrets?: Record<string, string>;
}

/**
 * What a create produced, plus what it could not supply.
 *
 * `missingSecrets` is **always present**, empty when there is nothing to say —
 * never conditional, for the reason `foldersCreated` is not: a caller has to be
 * able to *read* the answer rather than infer it from an absent key. A task
 * whose job refers to a secret nobody has set is a perfectly legal intermediate
 * state (an import, a restore, an applied template), and the only unacceptable
 * version of it is a silent one.
 */
export interface NativeTaskCreated {
  task: Task;
  missingSecrets: string[];
}

export async function createNativeTask(
  userId: string,
  input: NativeTaskInput
): Promise<NativeTaskCreated> {
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

  // Validated before the row exists, so a bad secret name cannot leave a task
  // behind that the caller believes failed. `replaceTaskSecrets` re-validates —
  // it is the boundary — but doing it here first keeps the create atomic in the
  // direction that matters.
  const secrets = input.secrets ?? {};
  for (const [name, value] of Object.entries(secrets)) {
    if (typeof value !== 'string') {
      throw new NativeTaskCreateError(`Secret "${name}" must be a string value.`);
    }
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

  if (Object.keys(secrets).length) {
    try {
      await replaceTaskSecrets(task.id, secrets);
    } catch (err) {
      // The row is already written, so a refused secret cannot simply 400 and
      // leave the task orphaned with a job that references it. Undo the create
      // and report the refusal — the caller asked for one task with its
      // credential, and half of that is not a smaller version of it.
      await prisma.task.delete({ where: { id: task.id } }).catch(() => {});
      if (err instanceof TaskSecretError) throw new NativeTaskCreateError(err.message);
      throw err;
    }
  }

  await recordCapability(userId, PlatformType.TASKHUB_NATIVE, 'create', true);
  notifyTasksChanged(userId);
  return { task, missingSecrets: missingSecretRefs(nativeJob, Object.keys(secrets)) };
}
