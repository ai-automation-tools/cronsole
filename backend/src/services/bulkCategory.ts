import { PlatformType } from '@prisma/client';
import {
  summarizeBulk,
  tallyOutcomes,
  type BulkItem,
  type BulkReport
} from './bulkOutcome.js';

/**
 * Recategorize many tasks in one request.
 *
 * The cheapest of the bulk verbs and the one most likely to be misread, so the
 * two things it is *not* are worth stating before the code:
 *
 * **It touches nothing outside Cronsole's database.** `category` is a Cronsole
 * label. There is no agent round-trip, no signed command, and no platform to
 * refuse — which is why the whole operation is one `updateMany` after this
 * planner has decided the items, rather than a loop of connector calls.
 *
 * **It does not move a Windows task on the machine.** A Windows task's category
 * is *derived from its real Task Scheduler folder* at import
 * (`TaskService.extractCategory`), so on the dashboard the two look like the
 * same fact — and after a rename they are not. That is a legitimate thing to
 * want (a folder holding both your backups and your build jobs), and it was
 * already possible one task at a time via `PATCH /api/tasks/:id`; doing twenty
 * at once just makes it easy to end up with a dashboard whose labels no longer
 * describe the machine without ever being told. So the report counts the tasks
 * whose label now disagrees with their folder, and the route says so.
 *
 * Which is the reason this planner takes `folderCategory` rather than deriving
 * it: "which folder is this task in?" has exactly one definition and it lives on
 * `TaskService` (trap #20a — a second copy of a path-derived rule is how a
 * renamed category silently stopped syncing a whole folder). The caller passes
 * the answer in; this file never re-derives it.
 *
 * Renaming is safe for sync for the same reason: `POST /api/tasks/sync` sends
 * `scope: 'tracked'` and the server resolves the include-set from the stored
 * tasks' **native paths**, never from these labels.
 */

/** The task fields this service needs; a narrow shape so tests need no Prisma. */
export interface BulkCategoryTask {
  id: string;
  name: string;
  platform: PlatformType;
  category: string;
  /**
   * The category this task's **native path** implies — `TaskService
   * .extractCategory(externalId, platform)`, computed by the caller. Used only
   * to count how many labels the change detaches from their real folder.
   */
  folderCategory: string;
}

export interface BulkCategoryReport extends BulkReport {
  /** The category every task was asked to move to. */
  category: string;
  /**
   * How many of the tasks that changed now carry a label their real Task
   * Scheduler folder does not match. Reported rather than refused: it is a
   * legitimate thing to do, and an unnamed one is a dashboard quietly drifting
   * from the machine it describes.
   */
  detachedFromFolder: number;
}

/**
 * Decide what happens to each task. Pure — no I/O, no platform, no clock.
 *
 * There is no halt rule here and there cannot be one: nothing in this operation
 * can discover that the agent is gone, because it never asks. `skipped` is
 * therefore structurally always zero, and it stays in the response anyway so a
 * caller can handle one report shape across all four bulk verbs.
 */
export function planBulkCategory(
  tasks: readonly BulkCategoryTask[],
  category: string
): BulkCategoryReport {
  const items: BulkItem[] = [];
  let detachedFromFolder = 0;

  for (const task of tasks) {
    const base = { taskId: task.id, name: task.name, platform: task.platform };

    if (task.category === category) {
      items.push({
        ...base,
        outcome: 'unchanged',
        message: `Already in "${category}".`
      });
      continue;
    }

    items.push({ ...base, outcome: 'updated' });

    // Counted only for platforms whose category means a real folder. A
    // Cronsole-native task's category has never been anything but a label, so
    // there is nothing for it to detach from.
    if (task.platform === PlatformType.WINDOWS_TASK_SCHEDULER && task.folderCategory !== category) {
      detachedFromFolder++;
    }
  }

  return {
    category,
    ...tallyOutcomes(items, tasks.length),
    detachedFromFolder,
    items
  };
}

/** The ids a caller should actually write. */
export function idsToUpdate(report: BulkCategoryReport): string[] {
  return report.items.filter(i => i.outcome === 'updated').map(i => i.taskId);
}

export function summarizeBulkCategory(report: BulkCategoryReport): string {
  const summary = summarizeBulk(report, `moved to "${report.category}"`, 'already there');
  // Appended to the summary rather than left to the response body, because the
  // summary is what reaches the user as a toast — and this is the part of the
  // result they did not ask for.
  return report.detachedFromFolder > 0
    ? `${summary} · ${report.detachedFromFolder} now labelled differently from its Windows folder`
    : summary;
}
