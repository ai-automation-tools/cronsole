import { PlatformType, TaskStatus } from '@prisma/client';
import type { PlatformConnector } from '../connectors/platform.interface.js';

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
 * What happened to one task. Five states rather than a boolean, because three of
 * them are neither success nor failure and collapsing them misleads in both
 * directions:
 *   - `updated`  — the platform confirmed the change.
 *   - `unchanged`— already in the requested state. Nothing went wrong and
 *                  nothing was done; counting it as `updated` inflates the
 *                  number, counting it as `failed` invents an error.
 *   - `refused`  — Cronsole declined before touching the platform (a MISSING
 *                  task has nothing to toggle).
 *   - `failed`   — the platform was asked and said no (elevation, ACL).
 *   - `skipped`  — never attempted, because the batch stopped early. See below.
 */
export type BulkStatusOutcome = 'updated' | 'unchanged' | 'refused' | 'failed' | 'skipped';

export interface BulkStatusItem {
  taskId: string;
  name: string;
  platform: PlatformType;
  outcome: BulkStatusOutcome;
  /** Why, for every outcome that isn't `updated`. Never absent on those. */
  message?: string;
}

export interface BulkStatusReport {
  /** The status every task was asked to reach. */
  status: TaskStatus;
  requested: number;
  updated: number;
  unchanged: number;
  refused: number;
  failed: number;
  skipped: number;
  /**
   * Set when the run stopped early, naming the reason. Present exactly when
   * `skipped > 0` — a caller must never have to infer a halt from arithmetic.
   */
  haltedReason?: string;
  items: BulkStatusItem[];
}

/** The task fields this service needs; a narrow shape so tests need no Prisma. */
export interface BulkStatusTask {
  id: string;
  name: string;
  platform: PlatformType;
  externalId: string;
  status: TaskStatus;
}

/**
 * Upper bound on one batch.
 *
 * Not a performance guard — a correctness one. Each Windows task is a round trip
 * to an elevated agent that can take up to its 15s timeout, so an unbounded list
 * turns one HTTP request into an arbitrarily long hang holding a connection. 100
 * is well above the size of any real selection and far below the point where
 * that matters.
 */
export const MAX_TASKS_PER_BULK_STATUS = 100;

/**
 * Errors that mean "the agent is not there", as opposed to "this particular task
 * could not be changed". The distinction decides whether the batch continues.
 */
const AGENT_DOWN = /agent offline|agent .*timeout|not connected|econnrefused/i;

export function isAgentDownMessage(message: string | undefined): boolean {
  return !!message && AGENT_DOWN.test(message);
}

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

  const count = (outcome: BulkStatusOutcome) => items.filter(i => i.outcome === outcome).length;

  return {
    status,
    requested: tasks.length,
    updated: count('updated'),
    unchanged: count('unchanged'),
    refused: count('refused'),
    failed: count('failed'),
    skipped: count('skipped'),
    ...(haltedReason ? { haltedReason } : {}),
    items
  };
}

/**
 * One-line summary for a toast. Names every non-zero outcome — a bulk result
 * that reports only its successes is the same omission as a dashboard that
 * hides 110 rows without saying so.
 */
export function summarizeBulkStatus(report: BulkStatusReport): string {
  const verb = report.status === TaskStatus.ACTIVE ? 'enabled' : 'disabled';
  const parts = [`${report.updated} ${verb}`];
  if (report.unchanged) parts.push(`${report.unchanged} already ${verb}`);
  if (report.refused) parts.push(`${report.refused} refused`);
  if (report.failed) parts.push(`${report.failed} failed`);
  if (report.skipped) parts.push(`${report.skipped} not attempted`);
  return parts.join(' · ');
}
