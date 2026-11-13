import { api } from '../api';
import type { Task } from '../types';
import { chunk, eligibleFor, type MassVerb } from './massActions';

/**
 * The one client for the `/api/tools/tasks/*` bulk routes, shared by the Mass
 * Actions console (scope-first) and the dashboard's selection bar
 * (selection-first). Both speak the server's five-outcome report, chunk at its
 * 100-task ceiling and stop at a halt — so two surfaces cannot disagree about
 * what a bulk run did.
 */

export interface BulkItem {
  taskId: string;
  name: string;
  platform: string;
  outcome: 'updated' | 'unchanged' | 'refused' | 'failed' | 'skipped';
  message?: string;
}

export interface BulkReport {
  requested: number;
  updated: number;
  unchanged: number;
  refused: number;
  failed: number;
  skipped: number;
  haltedReason?: string;
  items: BulkItem[];
}

export const EMPTY_REPORT: BulkReport = {
  requested: 0,
  updated: 0,
  unchanged: 0,
  refused: 0,
  failed: 0,
  skipped: 0,
  items: []
};

/** Fold one batch's report into the run's running total. */
export function mergeReports(a: BulkReport, b: BulkReport): BulkReport {
  return {
    requested: a.requested + b.requested,
    updated: a.updated + b.updated,
    unchanged: a.unchanged + b.unchanged,
    refused: a.refused + b.refused,
    failed: a.failed + b.failed,
    skipped: a.skipped + b.skipped,
    haltedReason: a.haltedReason ?? b.haltedReason,
    items: [...a.items, ...b.items]
  };
}

export const OUTCOME_STYLE: Record<BulkItem['outcome'], { label: string; className: string }> = {
  updated: { label: 'Done', className: 'text-success-text' },
  unchanged: { label: 'No change', className: 'text-subtle-foreground' },
  refused: { label: 'Refused', className: 'text-warning-text' },
  failed: { label: 'Failed', className: 'text-danger-text' },
  skipped: { label: 'Not attempted', className: 'text-neutral-text' }
};

/** Every verb a bulk route runs: the console's, plus the per-user labels. */
export type BulkVerb = Exclude<MassVerb, 'export'> | 'favorite' | 'unfavorite' | 'hide' | 'unhide';

function request(verb: BulkVerb, taskIds: string[], category?: string) {
  switch (verb) {
    case 'enable':
    case 'disable':
      return api.post('/tools/tasks/status', { taskIds, status: verb === 'enable' ? 'ACTIVE' : 'DISABLED' });
    case 'categorize':
      return api.post('/tools/tasks/category', { taskIds, category });
    case 'untrack':
      return api.post('/tools/tasks/untrack', { taskIds });
    case 'favorite':
    case 'unfavorite':
      return api.post('/tools/tasks/favorite', { taskIds, on: verb === 'favorite' });
    case 'hide':
    case 'unhide':
      return api.post('/tools/tasks/hidden', { taskIds, on: verb === 'hide' });
  }
}

/**
 * Run one verb over a list of tasks, batch by batch.
 *
 * Halts the whole run when a batch reports a halt: the server stops a batch at
 * the first sign the agent is gone, and continuing would collect the same error
 * 100 more times at ~15s each. Everything not attempted is reported as such
 * rather than quietly omitted.
 */
export async function runBulk(
  verb: BulkVerb,
  targets: Task[],
  opts: { category?: string; onBatch?: (total: BulkReport, done: number) => void } = {}
): Promise<BulkReport> {
  let total: BulkReport = { ...EMPTY_REPORT };
  let done = 0;

  for (const batch of chunk(targets)) {
    const res: BulkReport = (await request(verb, batch.map(t => t.id), opts.category)).data;
    total = mergeReports(total, res);
    done += batch.length;
    opts.onBatch?.(total, done);

    if (res.haltedReason) {
      const attempted = new Set(total.items.map(i => i.taskId));
      const remaining = targets.filter(t => !attempted.has(t.id));
      total = mergeReports(total, {
        ...EMPTY_REPORT,
        requested: remaining.length,
        skipped: remaining.length,
        items: remaining.map(t => ({
          taskId: t.id,
          name: t.name,
          platform: t.platform,
          outcome: 'skipped' as const,
          message: res.haltedReason
        }))
      });
      opts.onBatch?.(total, targets.length);
      break;
    }
  }
  return total;
}

/** Which selected tasks a verb would change. Server re-decides per task. */
export function eligibleForSelection(tasks: Task[], verb: BulkVerb): Task[] {
  switch (verb) {
    case 'favorite':
      return tasks.filter(t => !t.isFavorite);
    case 'unfavorite':
      return tasks.filter(t => t.isFavorite);
    case 'hide':
      return tasks.filter(t => !t.isSystem);
    case 'unhide':
      return tasks.filter(t => t.hiddenByUser);
    default:
      return eligibleFor(tasks, verb);
  }
}

/** The selection in words — the part a bare count cannot say. */
export function describeSelection(tasks: Task[]): string {
  const names = tasks.slice(0, 3).map(t => `“${t.name}”`);
  const rest = tasks.length - names.length;
  const list = rest > 0 ? `${names.join(', ')} and ${rest} more` : names.join(', ');
  return `the ${tasks.length} task${tasks.length === 1 ? '' : 's'} you selected: ${list}`;
}
