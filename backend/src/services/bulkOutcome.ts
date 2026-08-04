import { PlatformType } from '@prisma/client';

/**
 * The one reporting convention every bulk verb speaks.
 *
 * `bulkStatus.ts` worked this out first and argued it at length: at dashboard
 * scale a bulk operation is *partially* successful as the normal case, so the
 * unit of the answer is the task, not the batch. The rest of the bulk verbs
 * (recategorize, untrack, export-selected) landed afterwards, and the cheap
 * thing would have been for each to invent the shape that suited it — three
 * response bodies with three different ideas of what "it didn't work" means, so
 * a caller handling one learns nothing about the others.
 *
 * This module exists so there is exactly one definition. It holds no verb
 * logic: the shape, the tally, and the halt *predicate* — never a halt policy,
 * because whether a verb can halt at all depends on whether it talks to the
 * agent. Recategorize and untrack are pure DB work, so `skipped` is
 * structurally impossible for them and stays zero rather than being quietly
 * dropped from the response. A caller reading four zeros learns something; a
 * caller reading four different response shapes learns nothing.
 */

/**
 * What happened to one task. Five states rather than a boolean, because three
 * of them are neither success nor failure and collapsing them misleads in both
 * directions:
 *   - `updated`   — the operation was performed. (Each verb names it in its own
 *                   summary line: "enabled", "recategorized", "untracked".)
 *   - `unchanged` — already in the requested state. Nothing went wrong and
 *                   nothing was done; counting it as `updated` inflates the
 *                   number, counting it as `failed` invents an error.
 *   - `refused`   — Cronsole declined *before* touching the platform (a MISSING
 *                   task has nothing to toggle; a native task has nothing to
 *                   untrack). A verdict Cronsole owns, not one it was given.
 *   - `failed`    — the thing was asked and said no (elevation, ACL, a write
 *                   that threw).
 *   - `skipped`   — never attempted, because the batch stopped early.
 */
export type BulkOutcome = 'updated' | 'unchanged' | 'refused' | 'failed' | 'skipped';

export interface BulkItem {
  taskId: string;
  name: string;
  platform: PlatformType;
  outcome: BulkOutcome;
  /** Why, for every outcome that isn't `updated`. Never absent on those. */
  message?: string;
}

export interface BulkCounts {
  requested: number;
  updated: number;
  unchanged: number;
  refused: number;
  failed: number;
  skipped: number;
}

export interface BulkReport extends BulkCounts {
  /**
   * Set when the run stopped early, naming the reason. Present exactly when
   * `skipped > 0` — a caller must never have to infer a halt from arithmetic.
   */
  haltedReason?: string;
  items: BulkItem[];
}

/**
 * Upper bound on one batch.
 *
 * Not a performance guard — a correctness one. Each Windows task can be a round
 * trip to an elevated agent that takes up to its 15s timeout, so an unbounded
 * list turns one HTTP request into an arbitrarily long hang holding a
 * connection. 100 is well above the size of any real selection and far below
 * the point where that matters.
 *
 * The DB-only verbs inherit the same ceiling on purpose. They could afford more,
 * but a limit that varies per verb is a limit the UI cannot state once — and the
 * UI states it before the click.
 */
export const MAX_TASKS_PER_BULK = 100;

/**
 * Errors that mean "the agent is not there", as opposed to "this particular
 * task could not be changed". The distinction decides whether a batch continues:
 * a per-task refusal says nothing about the next task, while an absent agent
 * guarantees the same failure N more times at ~15s each.
 *
 * A predicate, not a policy. The verbs that never touch the agent don't call it.
 */
const AGENT_DOWN = /agent offline|agent .*timeout|not connected|econnrefused/i;

export function isAgentDownMessage(message: string | undefined): boolean {
  return !!message && AGENT_DOWN.test(message);
}

/** Count the outcomes, so no verb hand-rolls (and mis-sums) its own totals. */
export function tallyOutcomes(items: readonly BulkItem[], requested: number): BulkCounts {
  const count = (outcome: BulkOutcome) => items.filter(i => i.outcome === outcome).length;
  return {
    requested,
    updated: count('updated'),
    unchanged: count('unchanged'),
    refused: count('refused'),
    failed: count('failed'),
    skipped: count('skipped')
  };
}

/**
 * One-line summary for a toast, in the caller's own vocabulary.
 *
 * **Names every non-zero outcome.** A bulk result that reports only its
 * successes is the same omission as a dashboard that hides 110 rows without
 * saying so — and it is the outcome the user most needs, because the failures
 * are what they have to do something about.
 *
 * `verb` is the past participle for the thing that happened ("enabled",
 * "recategorized", "untracked", "exported"); `unchangedNote` describes the
 * no-op, which reads differently per verb ("already enabled" vs "already in
 * that category").
 */
export function summarizeBulk(
  counts: BulkCounts,
  verb: string,
  unchangedNote: string
): string {
  const parts = [`${counts.updated} ${verb}`];
  if (counts.unchanged) parts.push(`${counts.unchanged} ${unchangedNote}`);
  if (counts.refused) parts.push(`${counts.refused} refused`);
  if (counts.failed) parts.push(`${counts.failed} failed`);
  if (counts.skipped) parts.push(`${counts.skipped} not attempted`);
  return parts.join(' · ');
}
