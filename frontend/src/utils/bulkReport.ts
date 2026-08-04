/**
 * The browser's half of the server's one bulk-reporting convention.
 *
 * Every cross-task route on `/api/tools` answers in the same shape — five
 * per-task outcomes, a tally, a `summary` line and an optional `haltedReason`
 * (`backend/src/services/bulkOutcome.ts` carries the argument for why). This
 * module holds the two decisions the UI makes about that shape, once, rather
 * than four times inside four mutations:
 *
 *   - **which ids the selection should drop**, and
 *   - **whether the result is good news**.
 *
 * Both are easy to get subtly wrong in a way no test would notice — a toast
 * that reads green over three silent failures is the confident lie this project
 * treats as the worst failure mode, and it looks exactly like a working feature.
 */

export type BulkOutcome = 'updated' | 'unchanged' | 'refused' | 'failed' | 'skipped';

export interface BulkReportItem {
  taskId: string;
  name: string;
  outcome: BulkOutcome;
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
  summary: string;
  items: BulkReportItem[];
  /** Ids that matched no task of this user's. */
  notFound?: string[];
}

/**
 * The ids a selection should stop holding.
 *
 * Only successes and no-ops. A task that **failed or was refused stays
 * selected** on purpose: the user's next move is a retry, and making them
 * re-find the three rows that didn't work among two hundred is the same scaling
 * problem bulk actions exist to solve.
 *
 * `notFound` ids are dropped too — they matched no task at all, so keeping them
 * selected would pin a ghost to the toolbar's count forever.
 */
export function resolvedIds(report: BulkReport): string[] {
  const resolved = report.items
    .filter(i => i.outcome === 'updated' || i.outcome === 'unchanged')
    .map(i => i.taskId);
  return report.notFound?.length ? [...resolved, ...report.notFound] : resolved;
}

/**
 * True when some part of the batch did not do what was asked.
 *
 * `refused` counts as bad news even though nothing broke: Cronsole declined to
 * act, and the user asked it to. `unchanged` does not — that is the request
 * already being satisfied.
 */
export function hasBadNews(report: BulkReport): boolean {
  return report.failed + report.skipped + report.refused > 0;
}

/** The line to show, with the halt reason appended when the run stopped early. */
export function bulkToastMessage(report: BulkReport): string {
  return report.haltedReason ? `${report.summary} — ${report.haltedReason}` : report.summary;
}
