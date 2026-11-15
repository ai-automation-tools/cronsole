import { PlatformType } from '@prisma/client';
import { summarizeBulk, tallyOutcomes, type BulkItem, type BulkReport } from './bulkOutcome.js';

/**
 * Set or clear a **per-user label** on many tasks — a favorite, or "filed under
 * system tasks" (`TaskHidden`). The bulk form of the per-task star and the
 * modal's *Move to system tasks*, for the dashboard's selection bar.
 *
 * Labels are Cronsole-side joins that touch no platform, so like recategorize
 * and untrack there is no agent, no halt rule and `skipped` is always zero. The
 * per-task answer still matters: a task already labelled is `unchanged`, not
 * `updated`, and a task the label cannot apply to is `refused` with its reason
 * while the rest of the batch goes ahead.
 */

export interface BulkLabelTask {
  id: string;
  name: string;
  platform: PlatformType;
}

/**
 * Decide each task's outcome; the caller writes the rows for `ids`.
 *
 * `refuse` returns a reason for a task the label may not be set on (an OS-owned
 * task is a system task already — there is nothing to move). It is consulted
 * only when setting, because clearing a label that cannot exist is `unchanged`.
 */
export function planBulkLabel(
  tasks: readonly BulkLabelTask[],
  on: boolean,
  labelled: ReadonlySet<string>,
  refuse: (task: BulkLabelTask) => string | undefined = () => undefined
): { report: BulkReport; ids: string[] } {
  const items: BulkItem[] = [];
  const ids: string[] = [];

  for (const task of tasks) {
    const base = { taskId: task.id, name: task.name, platform: task.platform };
    const reason = on ? refuse(task) : undefined;
    if (reason) {
      items.push({ ...base, outcome: 'refused', message: reason });
    } else if (labelled.has(task.id) === on) {
      items.push({ ...base, outcome: 'unchanged', message: on ? 'Already set.' : 'Was not set.' });
    } else {
      items.push({ ...base, outcome: 'updated' });
      ids.push(task.id);
    }
  }

  return { report: { ...tallyOutcomes(items, tasks.length), items }, ids };
}

export function summarizeBulkLabel(report: BulkReport, verb: string): string {
  return summarizeBulk(report, verb, 'already so');
}
