import { PlatformType } from '@prisma/client';
import { prisma } from '../db.js';
import type { NativeJob } from './NativeTaskExecutor.js';

/** How far up a chain the cycle check walks before giving up and refusing. */
const MAX_CHAIN_DEPTH = 50;

const runAfterOf = (metadata: unknown): string | undefined =>
  (metadata as { job?: NativeJob } | null)?.job?.policy?.runAfter?.taskId;

/**
 * Can this job run after the task it names? (ROADMAP › native scheduler
 * reliability, Tier 2.) `validateJob` checks the shape; only the database can
 * say whether the predecessor exists, belongs to this user, is a native task,
 * and does not lead back to the task being saved. Returns the refusal, or null.
 *
 * `selfId` is null on create: a new task cannot be anyone's predecessor yet, so
 * only the self-reference and the predecessor's existence can fail.
 */
export async function runAfterError(userId: string, selfId: string | null, job: NativeJob): Promise<string | null> {
  const target = job.policy?.runAfter?.taskId;
  if (!target) return null;
  if (target === selfId) return 'A task cannot run after itself.';

  const predecessor = await prisma.task.findFirst({ where: { id: target, userId } });
  if (!predecessor) return `There is no task with id ${target} to run after.`;
  if (predecessor.platform !== PlatformType.TASKHUB_NATIVE) {
    return `"${predecessor.name}" is not a Cronsole-native task. A task can only run after a native task, because only those runs are Cronsole's to see finish.`;
  }

  if (!selfId) return null;
  // Walk up from the predecessor. Reaching the task being saved means the new
  // link would close a loop, and a loop fires forever.
  let cursor: string | undefined = runAfterOf(predecessor.metadata);
  for (let depth = 0; cursor && depth < MAX_CHAIN_DEPTH; depth++) {
    if (cursor === selfId) {
      return `"${predecessor.name}" already runs after this task (directly or further up), so this would make a loop.`;
    }
    const next = await prisma.task.findFirst({ where: { id: cursor, userId }, select: { metadata: true } });
    cursor = next ? runAfterOf(next.metadata) : undefined;
  }
  return cursor ? `This chain is more than ${MAX_CHAIN_DEPTH} tasks long.` : null;
}
