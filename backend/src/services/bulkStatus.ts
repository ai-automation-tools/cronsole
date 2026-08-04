import { PlatformType, TaskStatus } from '@prisma/client';
import type { PlatformConnector } from '../connectors/platform.interface.js';
import {
  isAgentDownMessage,
  summarizeBulk,
  tallyOutcomes,
  MAX_TASKS_PER_BULK,
  type BulkItem,
  type BulkOutcome,
  type BulkReport
} from './bulkOutcome.js';

/**
 * Enable or disable many tasks in one request.
 *
 * The per-task path (`PATCH /api/tasks/:id/status`) already does this correctly,
 * one task at a time. What does not survive being repeated N times is the
 * *reporting*: at dashboard scale a bulk operation is partially successful as
 * the normal case, not the exception — an admin-ACL'd Windows task refuses
 * elevation, a task went MISSING since the last sync, another is already in the
 * state you asked for. Collapsing that into "12 updated" is the confident lie
 * this project treats as the worst failure mode, so the unit of the answer is
 * the task, not the batch.
 *
 * No new agent verb: this drives the same signed `task:set_status` the single
 * toggle does, through the same connector. Nothing here reaches past the
 * connector layer.
 */

/**
 * The five outcomes, the item shape and the report shape now live in
 * `bulkOutcome.ts` — this verb worked them out first, and the later bulk verbs
 * (recategorize, untrack, export-selected) share them rather than each inventing
 * a response body of its own. Re-exported under the original names so nothing
 * that already imports from here has to change.
 */
export type BulkStatusOutcome = BulkOutcome;
export type BulkStatusItem = BulkItem;

export interface BulkStatusReport extends BulkReport {
  /** The status every task was asked to reach. */
  status: TaskStatus;
}

/** The task fields this service needs; a narrow shape so tests need no Prisma. */
export interface BulkStatusTask {
  id: string;
  name: string;
  platform: PlatformType;
  externalId: string;
  status: TaskStatus;
}

/** The shared batch ceiling. Kept under its original name for existing callers. */
export const MAX_TASKS_PER_BULK_STATUS = MAX_TASKS_PER_BULK;

export { isAgentDownMessage };

/**
 * Apply `status` to every task, in order, reporting each one.
 *
 * **It stops at the first sign the agent is gone.** That is the one piece of
 * control flow here worth arguing about, so: a Windows task whose agent is
 * offline fails after the connector's ~15s timeout. Carrying on would spend
 * 15s × the remainder — a 50-task selection becomes a twelve-minute request
 * that ends in fifty copies of the same error. The remaining tasks are reported
 * `skipped` with the reason, which is both faster and more honest than
 * discovering the same fact fifty times. A per-task refusal (elevation, ACL) is
 * the opposite case and does **not** halt: it says nothing about the next task.
 *
 * Sequential, not parallel, for the same reason the agent is a client and not a
 * server: it is one elevated process doing COM work on the user's machine, and
 * fanning 100 concurrent signed commands at it is a load pattern nothing else in
 * this system produces.
 */
export async function applyBulkStatus(
  tasks: BulkStatusTask[],
  status: TaskStatus,
  resolve: (platform: PlatformType) => {
    connector: PlatformConnector | undefined;
    config: unknown;
  }
): Promise<BulkStatusReport> {
  const enabled = status === TaskStatus.ACTIVE;
  const items: BulkStatusItem[] = [];
  let haltedReason: string | undefined;

  for (const task of tasks) {
    const base = { taskId: task.id, name: task.name, platform: task.platform };

    if (haltedReason) {
      items.push({ ...base, outcome: 'skipped', message: haltedReason });
      continue;
    }

    // A MISSING task is refused here rather than attempted, and refused in the
    // BACKEND rather than only greyed out in the UI — the same posture the agent
    // takes toward its own caller. The platform already reported it gone; asking
    // it to toggle something absent can only produce a confusing platform error.
    if (task.status === TaskStatus.MISSING) {
      items.push({
        ...base,
        outcome: 'refused',
        message: 'Not found on its platform at the last sync — re-sync or remove it instead.'
      });
      continue;
    }

    if (task.status === status) {
      items.push({
        ...base,
        outcome: 'unchanged',
        message: `Already ${status.toLowerCase()}.`
      });
      continue;
    }

    const { connector, config } = resolve(task.platform);
    if (!connector) {
      items.push({
        ...base,
        outcome: 'failed',
        message: `No connector for ${task.platform}.`
      });
      continue;
    }

    try {
      const result = await connector.setTaskStatus(task.externalId, enabled, config);
      if (result.success) {
        items.push({ ...base, outcome: 'updated' });
        continue;
      }
      const message = result.message || 'The platform refused the change.';
      items.push({ ...base, outcome: 'failed', message });
      if (isAgentDownMessage(message)) {
        haltedReason = `Stopped after "${task.name}": ${message}`;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      items.push({ ...base, outcome: 'failed', message });
      if (isAgentDownMessage(message)) {
        haltedReason = `Stopped after "${task.name}": ${message}`;
      }
    }
  }

  return {
    status,
    ...tallyOutcomes(items, tasks.length),
    ...(haltedReason ? { haltedReason } : {}),
    items
  };
}

/** One-line summary for a toast, in this verb's vocabulary. */
export function summarizeBulkStatus(report: BulkStatusReport): string {
  const verb = report.status === TaskStatus.ACTIVE ? 'enabled' : 'disabled';
  return summarizeBulk(report, verb, `already ${verb}`);
}
