import { Prisma, PlatformType, Task } from '@prisma/client';
import { prisma } from '../db.js';

/**
 * Capturing a task's definition so a deleted one can be rebuilt.
 *
 * Two callers share the bundle builder, and that sharing is the point:
 * `GET /api/tasks/:id/export` (the download the user asks for) and the archive
 * written by the native delete route. Two copies of "what a task export looks
 * like" would drift, and the drift would only surface the day someone tried to
 * restore from an archive — which is the day it must not surface.
 */

/** Bumped only when the shape changes incompatibly. */
export const CRONSOLE_TASK_VERSION = '1.0';

/** How many run records ride along with an archived definition. */
export const ARCHIVED_EXECUTION_LIMIT = 20;

export interface NativeTaskBundle {
  cronsoleTaskVersion: string;
  exportedAt: string;
  task: {
    name: string;
    platform: PlatformType;
    category: string;
    schedule: string | null;
    job: unknown;
  };
}

/**
 * The portable definition of a Cronsole-native task.
 *
 * Native tasks are the only ones this can produce, and that is a property of
 * the platform rather than a gap: a native task's DB row *is* the task, so the
 * row round-trips. A Windows task's definition lives on the machine and comes
 * back as Task Scheduler XML through a `task:export` agent round trip, which
 * needs the agent online and so cannot be part of a delete's precondition.
 *
 * **A task's stored secrets are deliberately not here, and must never be added**
 * (ADR 0003). This bundle is written *because* it outlives the row, which makes
 * it the last place a credential should survive a delete — and the same builder
 * produces the file a user downloads, so a value here would travel to whatever
 * machine that file reaches. The job it carries *names* every secret it needs,
 * in plain text, which is what import and restore report back as
 * `missingSecrets`. There is deliberately no `requiredSecrets` field: it would
 * be a second derivation of something the file already states, and this repo has
 * paid for a serialized field nothing reads before (troubleshooting #65).
 */
export function buildNativeTaskBundle(task: Task, now: Date = new Date()): NativeTaskBundle {
  const meta =
    task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
      ? (task.metadata as Record<string, unknown>)
      : {};

  return {
    cronsoleTaskVersion: CRONSOLE_TASK_VERSION,
    exportedAt: now.toISOString(),
    task: {
      name: task.name,
      platform: task.platform,
      category: task.category,
      schedule: task.schedule,
      job: meta.job ?? null
    }
  };
}

export class ArchiveWriteError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'ArchiveWriteError';
  }
}

/**
 * Write the pre-delete archive, and throw if it cannot be written.
 *
 * Throwing is the contract, not a detail. The caller must let the failure
 * abort the delete: a backup that silently no-ops leaves you strictly worse off
 * than having none, because the delete then proceeds under the belief that the
 * task is recoverable. So this never swallows, never returns a boolean the
 * caller can ignore, and is always awaited *before* the delete transaction.
 *
 * Note the deliberate asymmetry with `recordCapability`, which must never throw
 * — an observer may not fail the verb it observes. This is not an observer. It
 * is a precondition, and a precondition that cannot fail is not one.
 */
export async function archiveTaskBeforeDelete(
  task: Task,
  opts: { deletedVia: string }
): Promise<{ archiveId: string; executionsArchived: number }> {
  try {
    // Captured before the delete transaction destroys them. For a native task
    // these are real outcome evidence — exit code, duration, captured output —
    // so without them the archive cannot answer "was it working before I
    // deleted it?". (On a Windows task a SUCCESS only records the agent
    // accepting a start, which is why that judgement lives in Windows.)
    const executions = await prisma.executionLog.findMany({
      where: { taskId: task.id },
      orderBy: { triggeredAt: 'desc' },
      take: ARCHIVED_EXECUTION_LIMIT
    });

    const archive = await prisma.deletedTaskArchive.create({
      data: {
        userId: task.userId,
        taskId: task.id,
        platform: task.platform,
        externalId: task.externalId,
        name: task.name,
        bundle: buildNativeTaskBundle(task) as unknown as Prisma.InputJsonValue,
        executions: executions.map(e => ({
          triggeredAt: e.triggeredAt.toISOString(),
          status: e.status,
          durationMs: e.durationMs,
          log: e.log,
          platformRunId: e.platformRunId
        })) as unknown as Prisma.InputJsonValue,
        deletedVia: opts.deletedVia
      },
      select: { id: true }
    });

    return { archiveId: archive.id, executionsArchived: executions.length };
  } catch (err) {
    throw new ArchiveWriteError(
      'Could not archive the task before deleting it, so the delete was refused. ' +
        'The task is unchanged.',
      err
    );
  }
}
