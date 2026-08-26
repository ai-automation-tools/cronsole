import { CronExpressionParser } from 'cron-parser';

/**
 * When does each task fire, over a window?
 *
 * The Schedule view answers "what runs next" from `metadata.nextRunTime` — one
 * instant per task, whatever the platform last reported. A **calendar** cannot
 * be drawn from that: placing a task on the fourteen days of a month it runs on
 * needs the fourteen instants, and only the stored cron knows them.
 *
 * Three rules shape this file, and each one is the difference between a calendar
 * and a calendar-shaped lie.
 *
 * **The expansion is in UTC, because storage is** (CLAUDE.md §9). A 5-field cron
 * in UTC is a fixed sequence of instants; which calendar *day* one of those
 * instants lands on is a question about the reader's zone, and that conversion
 * stays at the browser's edge with every other one. So nothing here takes a
 * timezone, and the range is instants in, instants out.
 *
 * **A task that cannot be placed is reported, not omitted.** A Windows task
 * triggered by logon has no cron and never will; a GitHub workflow whose
 * schedule Cronsole could not read carries its reason in
 * `metadata.scheduleReason`. Dropping either would put them in the same bucket
 * as a task that simply does not run this month — and §9's rule is that a
 * refusal to convert must state why, because declining to answer and answering
 * "nothing here" must never be the same code path.
 *
 * **The cap is announced.** A task that runs every five minutes has 12,096
 * occurrences in a six-week grid, which is neither drawable nor worth sending.
 * The walk stops at `maxPerTask` and reports `truncatedAfter` — the instant it
 * stopped at — so the caller can say "the rest of this month is not shown"
 * rather than rendering an empty second half that reads as "it stops running".
 */

/** The minimum a task needs to be placed on a calendar. */
export interface OccurrenceInput {
  id: string;
  schedule: string | null;
  metadata: unknown;
}

export interface TaskOccurrences {
  taskId: string;
  /** ISO instants, ascending, within the requested range. */
  occurrences: string[];
  /**
   * The last instant enumerated when `maxPerTask` stopped the walk, or null when
   * the list is complete. Never a boolean: the caller has to know *where* the
   * answer stops being complete, or it cannot mark the part of the range it is
   * no longer describing.
   */
  truncatedAfter: string | null;
}

/** A task with no place on a calendar, and why. */
export interface UnplaceableTask {
  taskId: string;
  reason: string;
}

export interface OccurrenceReport {
  tasks: TaskOccurrences[];
  unplaceable: UnplaceableTask[];
  /** How many tasks hit the cap — the number a "not everything is shown" line needs. */
  truncated: number;
}

/** Occurrences per task before the walk is cut short. */
export const DEFAULT_MAX_PER_TASK = 200;

/**
 * A hard ceiling on the walk, independent of `maxPerTask`.
 *
 * cron-parser's `next()` is cheap but not free, and the loop's exit condition is
 * "the next occurrence is past `to`" — which for a malformed-but-parseable
 * expression could be a long way off. This bounds the iteration itself so a bad
 * expression costs a bounded amount of work rather than a request.
 */
const MAX_STEPS = 20_000;

function scheduleReasonOf(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const reason = (metadata as Record<string, unknown>).scheduleReason;
  return typeof reason === 'string' && reason.trim() ? reason.trim() : null;
}

/**
 * The cron this task is stored with.
 *
 * Column first, then `metadata.schedule` — the same order and the same two
 * places `frontend/src/utils/schedule.ts` reads, because a task synced by a
 * connector that only writes metadata is still a scheduled task. A third
 * spelling here would make the calendar disagree with the line on the card.
 */
function cronOf(task: OccurrenceInput): string | null {
  const pick = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const meta = (task.metadata ?? {}) as Record<string, unknown>;
  return pick(task.schedule) ?? pick(meta.schedule) ?? pick(meta.cron);
}

/**
 * Every firing of `cron` inside `(from, to]`, ascending.
 *
 * Exported for its own tests: this is the arithmetic the whole feature rests on,
 * and it is worth pinning without a database or a route in the way.
 */
export function expandCron(
  cron: string,
  from: Date,
  to: Date,
  maxPerTask: number = DEFAULT_MAX_PER_TASK
): { occurrences: Date[]; truncatedAfter: Date | null } {
  const occurrences: Date[] = [];
  // The project's convention is 5 fields; cron-parser accepts 6 (with seconds)
  // and would happily read a stray field as something else entirely. Refusing
  // here rather than parsing generously keeps one meaning for a stored string.
  if (cron.trim().split(/\s+/).length !== 5 || maxPerTask <= 0) {
    return { occurrences, truncatedAfter: null };
  }

  try {
    const expression = CronExpressionParser.parse(cron.trim(), {
      currentDate: from,
      tz: 'UTC'
    });
    for (let step = 0; step < MAX_STEPS; step++) {
      const next = expression.next().toDate();
      if (next.getTime() > to.getTime()) break;
      occurrences.push(next);
      if (occurrences.length >= maxPerTask) {
        // Peek at whether there IS more. A task whose last run happens to be the
        // 200th is complete, and reporting it as truncated would put a "not
        // everything is shown" warning over a list that shows everything.
        try {
          const beyond = expression.next().toDate();
          if (beyond.getTime() <= to.getTime()) {
            return { occurrences, truncatedAfter: next };
          }
        } catch {
          // Exhausted immediately after the cap — the list is complete.
        }
        break;
      }
    }
  } catch {
    // Unparseable (nothing collected) or exhausted mid-walk (partial). Both
    // return what was found: "it stops after these three" is a real answer, and
    // an unparseable expression is caught by the caller, which has the task id
    // and can say which task it was about.
  }

  return { occurrences, truncatedAfter: null };
}

/**
 * Place every task on the window `(from, to]`.
 *
 * A task with a valid cron that simply does not fire in the window is **absent
 * from both lists** — that is not a refusal, it is the answer. `unplaceable` is
 * only for tasks that could never be placed on any window.
 */
export function expandOccurrences(
  tasks: OccurrenceInput[],
  from: Date,
  to: Date,
  maxPerTask: number = DEFAULT_MAX_PER_TASK
): OccurrenceReport {
  const placed: TaskOccurrences[] = [];
  const unplaceable: UnplaceableTask[] = [];
  let truncated = 0;

  for (const task of tasks) {
    const cron = cronOf(task);
    if (!cron) {
      unplaceable.push({
        taskId: task.id,
        // The connector's own words when it has them: "could not read the
        // schedule" and "there is no schedule" are different facts, and the
        // second is not a defect.
        reason:
          scheduleReasonOf(task.metadata) ??
          'No cron schedule — this task runs on a trigger Cronsole cannot express as cron (boot, logon, an event, or on demand only).'
      });
      continue;
    }

    const { occurrences, truncatedAfter } = expandCron(cron, from, to, maxPerTask);
    if (occurrences.length === 0) {
      // Told apart by re-parsing rather than by guessing: a cron that fires
      // nowhere in this window is a normal, correct answer, and one Cronsole
      // cannot read is a fact the user needs in order to fix it.
      if (!isParseable(cron)) {
        unplaceable.push({
          taskId: task.id,
          reason: `Cronsole cannot read the stored expression "${cron}", so it has no place on a calendar.`
        });
      }
      continue;
    }

    if (truncatedAfter) truncated++;
    placed.push({
      taskId: task.id,
      occurrences: occurrences.map(d => d.toISOString()),
      truncatedAfter: truncatedAfter ? truncatedAfter.toISOString() : null
    });
  }

  return { tasks: placed, unplaceable, truncated };
}

function isParseable(cron: string): boolean {
  if (cron.trim().split(/\s+/).length !== 5) return false;
  try {
    CronExpressionParser.parse(cron.trim(), { tz: 'UTC' });
    return true;
  } catch {
    return false;
  }
}
