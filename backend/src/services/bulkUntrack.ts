import { PlatformType } from '@prisma/client';
import {
  summarizeBulk,
  tallyOutcomes,
  type BulkItem,
  type BulkReport
} from './bulkOutcome.js';

/**
 * Untrack many tasks in one request — remove Cronsole's rows while **leaving
 * every real scheduled task running**.
 *
 * This is the bulk verb the removal story was missing, and the argument for it
 * is the same one that produced single-task untrack (2026-07-28), only sharper.
 * An over-import arrives in bulk: the Import modal makes a whole folder one
 * click away, so the mistake it undoes is never one task. Without this, tidying
 * up 40 accidentally-imported rows means 40 modals — or reaching for Delete,
 * which removes the real Task Scheduler entries. **A destructive path that is
 * easier than the safe one is how the safe one stops being used**, which is the
 * same reasoning that keeps `set_task_status` ungated over MCP.
 *
 * Like the single-task route it makes **no platform call at all**, so:
 *   - there is no halt rule, because nothing here can discover the agent is
 *     gone (`skipped` is structurally always zero and stays in the response so
 *     one report shape covers every bulk verb);
 *   - an offline agent is irrelevant — untrack works when Windows does not
 *     answer, which is exactly when a user is most likely to be tidying up.
 *
 * The per-task refusal is the load-bearing part. A `TASKHUB_NATIVE` task lives
 * nowhere but Cronsole's database, so "untrack but keep it" is not a thing that
 * can be true, and doing a delete under a gentler name would be a destructive
 * action wearing a reversible label. The single route 400s; here it is one
 * `refused` item and the other 39 tasks still go — a per-task refusal must never
 * halt a batch, the same discrimination `bulkStatus` makes for an ACL denial.
 */

/** The task fields this service needs; a narrow shape so tests need no Prisma. */
export interface BulkUntrackTask {
  id: string;
  name: string;
  platform: PlatformType;
  externalId: string;
}

export interface BulkUntrackReport extends BulkReport {}

export interface UntrackPlanEntry {
  taskId: string;
  platform: PlatformType;
  externalId: string;
}

/**
 * Decide what happens to each task, and hand back the exclusions to write.
 *
 * Pure: the caller performs the transaction. Splitting it this way is what lets
 * the refusal rule be tested without a database — and the refusal rule is the
 * only thing here that can be wrong in a way that destroys something.
 */
export function planBulkUntrack(tasks: readonly BulkUntrackTask[]): {
  report: BulkUntrackReport;
  /** Tasks to delete, each with the exclusion that must be recorded with it. */
  plan: UntrackPlanEntry[];
} {
  const items: BulkItem[] = [];
  const plan: UntrackPlanEntry[] = [];

  for (const task of tasks) {
    const base = { taskId: task.id, name: task.name, platform: task.platform };

    if (task.platform === PlatformType.TASKHUB_NATIVE) {
      items.push({
        ...base,
        outcome: 'refused',
        message:
          'Cronsole-native tasks exist only inside Cronsole, so there is nothing to keep. ' +
          'Use Delete to remove it, or disable it to stop it running.'
      });
      continue;
    }

    items.push({ ...base, outcome: 'updated' });
    plan.push({ taskId: task.id, platform: task.platform, externalId: task.externalId });
  }

  return {
    report: { ...tallyOutcomes(items, tasks.length), items },
    plan
  };
}

export function summarizeBulkUntrack(report: BulkUntrackReport): string {
  // "removed from Cronsole", never "removed" — the whole point of this verb is
  // that the scheduled tasks are still on the machine and still running, and a
  // toast reading "40 removed" is precisely the wrong thing to believe.
  return summarizeBulk(report, 'removed from Cronsole', 'unchanged');
}
