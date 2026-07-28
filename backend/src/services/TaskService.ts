import { PlatformType, TaskStatus } from '@prisma/client';
import { prisma } from '../db.js';

export interface NormalizedTask {
  externalId: string;
  name: string;
  status: 'ACTIVE' | 'DISABLED';
  /** Normalized 5-field cron (UTC) derived from the platform trigger, if any. */
  schedule?: string | null;
  /** Next scheduled run reported by the platform, or null if unset. */
  nextRunTime?: Date | null;
  metadata?: any;
}

// Upserts per $transaction batch: bounds transaction size on large syncs
// (a full Windows sync is hundreds of tasks) while still cutting the
// one-round-trip-per-task chatter of sequential awaits.
const UPSERT_BATCH_SIZE = 100;

// Reconciliation flips absent tasks to MISSING rather than deleting them, but a
// suspicious snapshot is still handled conservatively: a complete Windows
// snapshot is usually hundreds of rows, so if an established platform suddenly
// reports a tiny non-empty subset, treat it as a partial/bad sync and change
// nothing rather than flipping most of the dashboard to MISSING at once. (Even
// though MISSING self-heals on the next good sync, a whole-dashboard flap is
// alarming noise the guard cheaply avoids.)
const STALE_PRUNE_MIN_TRACKED = 20;
const STALE_PRUNE_MIN_RETAIN_RATIO = 0.5;

// Categories owned by the OS rather than the user. Counted separately in the
// un-imported signal (see `summarizeUntracked`) because they are numerous,
// permanent, and not something anyone intends to import — so folding them into
// the headline number would make it constant, and a constant warning is noise.
// Matches the root folder `extractCategory` derives, so `\Microsoft\Windows\…`
// lands here.
const SYSTEM_CATEGORIES = new Set(['Microsoft']);

export class TaskService {
  static async upsertTasks(userId: string, platform: PlatformType, tasks: NormalizedTask[]) {
    const ops = tasks.map(t =>
      prisma.task.upsert({
        where: {
          platform_externalId: {
            platform,
            externalId: t.externalId
          }
        },
        update: {
          name: t.name,
          status: t.status === 'ACTIVE' ? TaskStatus.ACTIVE : TaskStatus.DISABLED,
          metadata: t.metadata,
          // Refresh the platform-derived schedule only when we have a good cron —
          // never wipe an accurate value with a failed conversion.
          ...(t.schedule ? { schedule: t.schedule } : {}),
          // nextRunTime is a live value; update it whenever the caller supplied
          // one (including an explicit null), but don't clobber it when omitted.
          ...(t.nextRunTime !== undefined ? { nextRunTime: t.nextRunTime } : {})
          // Note: We DO NOT update category here to preserve user overrides
        },
        create: {
          userId,
          platform,
          externalId: t.externalId,
          name: t.name,
          // Extracted from the native path; only set on initial import
          category: this.extractCategory(t.externalId, platform),
          status: t.status === 'ACTIVE' ? TaskStatus.ACTIVE : TaskStatus.DISABLED,
          schedule: t.schedule ?? null,
          nextRunTime: t.nextRunTime ?? null,
          metadata: t.metadata
        }
      })
    );

    const results = [];
    for (let i = 0; i < ops.length; i += UPSERT_BATCH_SIZE) {
      results.push(...await prisma.$transaction(ops.slice(i, i + UPSERT_BATCH_SIZE)));
    }
    return results;
  }

  /**
   * Reconcile DB tasks against the platform's FULL task list. A task tracked in
   * TaskHub but absent from `currentExternalIds` is flipped to MISSING (and its
   * nextRunTime cleared) — NOT deleted.
   *
   * Why not delete: absence from one sync is not proof a task is gone. An
   * offline agent, or a folder the agent can't read (ACL), looks identical to a
   * native delete from here — and deleting a user's tracked task (and its
   * execution history) on that evidence is worse than showing it honestly as
   * MISSING. MISSING self-heals: the next sync that sees the task upserts it
   * back to ACTIVE/DISABLED. A user who truly wants it gone deletes it
   * explicitly (DELETE /api/tasks/:id), which is the only path that removes the
   * row and its logs.
   *
   * `currentExternalIds` must be the connector's FULL list (pre
   * category-filtering) — a task the user simply didn't import into a selected
   * category still exists on the platform and must not be marked MISSING.
   *
   * Returns the number of rows NEWLY flipped to MISSING (already-MISSING rows
   * that stay absent are a no-op, so a quiet sync returns 0).
   */
  static async reconcileMissingTasks(userId: string, platform: PlatformType, currentExternalIds: string[]) {
    // Refuse rather than lie, and check this before anything else: "I cannot do
    // this correctly" is a precondition on the operation, independent of what
    // the snapshot happens to contain. If the generated client lacks MISSING (a
    // stale container client — troubleshooting #22), `TaskStatus.MISSING` is
    // `undefined`, Prisma drops the field from the payload, and updateMany still
    // returns a non-zero count — so this function would report N tasks marked
    // MISSING while marking none and merely clearing their nextRunTime. An error
    // the caller surfaces is strictly better than a confident wrong number.
    if (TaskStatus.MISSING === undefined) {
      throw new Error(
        'Generated Prisma client is stale: TaskStatus.MISSING is undefined, so the status write ' +
        'would be silently dropped. Run: docker compose exec backend npx prisma generate ' +
        '&& docker restart taskhub-backend-1 (see docs/troubleshooting/README.md #22)'
      );
    }

    if (currentExternalIds.length === 0) return 0;

    const trackedCount = await prisma.task.count({ where: { userId, platform } });
    if (
      trackedCount >= STALE_PRUNE_MIN_TRACKED &&
      currentExternalIds.length / trackedCount < STALE_PRUNE_MIN_RETAIN_RATIO
    ) {
      console.warn(
        `[TaskService] skipped MISSING reconciliation for ${platform}: partial snapshot suspected ` +
        `(${currentExternalIds.length}/${trackedCount} IDs returned)`
      );
      return 0;
    }

    // Only flip rows that are absent AND not already MISSING — so the return
    // count is "newly gone this sync", and an already-marked row isn't rewritten
    // (which would also churn updatedAt for no reason).
    const result = await prisma.task.updateMany({
      where: {
        userId,
        platform,
        externalId: { notIn: currentExternalIds },
        status: { not: TaskStatus.MISSING }
      },
      data: { status: TaskStatus.MISSING, nextRunTime: null }
    });
    return result.count;
  }

  /**
   * The categories a `scope: 'tracked'` sync should refresh — derived from the
   * native paths of the tasks the user already tracks, NOT from their stored
   * `category` values.
   *
   * Why derived and not stored: `category` is a user override (renaming it from
   * a task card is supported, and `upsertTasks` deliberately preserves it), but
   * the sync filter matches on `extractCategory(externalId)`. So a caller that
   * echoes stored categories back sends names that no longer correspond to any
   * folder, and that folder silently drops out of the sync — it stops refreshing
   * AND stops picking up new tasks, with no error. Resolving the set here, from
   * the paths, keeps the one definition of "category" (`extractCategory`) on the
   * server and makes the caller immune to renames by construction.
   *
   * An empty result means "you track nothing on this platform", which correctly
   * syncs nothing — never everything.
   */
  static async trackedCategories(userId: string, platform: PlatformType): Promise<string[]> {
    const tracked = await prisma.task.findMany({
      where: { userId, platform },
      select: { externalId: true }
    });
    return Array.from(new Set(tracked.map(t => this.extractCategory(t.externalId, platform))));
  }

  /**
   * What a sync **didn't** import: the tasks the platform reported that fall
   * outside the include-set.
   *
   * Why this exists: selective import is the design, but it was **invisible**.
   * A user created tasks in two new folders, pressed Sync Now repeatedly, and got
   * a cheerful "Tasks synced." every time while 26 tasks sat one fence away — the
   * connector had been reporting them the whole time. The fence is correct; saying
   * nothing about it is the defect (troubleshooting #20). A dashboard that omits
   * what it's withholding is lying by omission, which is §9's register in miniature.
   *
   * Reads the enumeration the caller **already has** (the same full, pre-filter
   * list reconciliation needs), so this costs no extra agent round-trip.
   *
   * `included === undefined` means "no filter, sync everything" — nothing is left
   * out, so the answer is zero rather than "all of it".
   *
   * `systemCount` is reported **separately** rather than folded into `count`, and
   * that split is the whole reason this signal is usable. A real Windows box has
   * hundreds of `\Microsoft\…` tasks nobody intends to import (which is why Import
   * ships them unticked), so counting them would pin the banner permanently at
   * "312 tasks in 47 folders" — a number that never changes trains you to ignore
   * it, and a signal you've learned to ignore is worse than no signal. Excluding
   * them silently would be the other failure, so they are surfaced, just not
   * counted.
   *
   * `excludedCount` is split off for the same reason and one stronger: a task the
   * user **deliberately untracked** is the one case where "you didn't import
   * this" is not news. Counting it would nag someone about a choice they made on
   * purpose, which is the fastest way to teach them to ignore the banner. It is
   * still reported, because an exclusion you cannot see is a fence of its own.
   */
  static summarizeUntracked(
    externalIds: string[],
    included: string[] | undefined,
    platform: PlatformType,
    excluded: Set<string> = new Set()
  ): { count: number; folders: string[]; systemCount: number; excludedCount: number } {
    const empty = { count: 0, folders: [] as string[], systemCount: 0, excludedCount: 0 };
    if (included === undefined || externalIds.length === 0) return empty;

    const includedSet = new Set(included);
    const folders = new Set<string>();
    let count = 0;
    let systemCount = 0;
    let excludedCount = 0;

    for (const externalId of externalIds) {
      const category = this.extractCategory(externalId, platform);
      // Order matters: an untracked task inside an INCLUDED category is exactly
      // the case this counter exists for, so it must be tested before the
      // include-set short-circuit or it would never be counted at all.
      if (excluded.has(externalId)) {
        excludedCount++;
        continue;
      }
      if (includedSet.has(category)) continue;
      if (SYSTEM_CATEGORIES.has(category)) {
        systemCount++;
        continue;
      }
      count++;
      folders.add(category);
    }

    // Not capped: these are the user's own folders, so the list is short in
    // practice — and a silent truncation here would reintroduce exactly the
    // "it didn't tell me" failure this function exists to fix.
    return { count, folders: Array.from(folders).sort(), systemCount, excludedCount };
  }

  /**
   * The platform-native ids this user has explicitly untracked on `platform`.
   *
   * Untrack removes TaskHub's row while leaving the real scheduler entry alone,
   * so without this the next sync including that category re-imports it — right
   * by the sync's logic, and identical from the outside to "untrack is broken".
   */
  static async excludedExternalIds(userId: string, platform: PlatformType): Promise<Set<string>> {
    const rows = await prisma.taskExclusion.findMany({
      where: { userId, platform },
      select: { externalId: true }
    });
    return new Set(rows.map(r => r.externalId));
  }

  /**
   * Drop excluded tasks from a sync batch.
   *
   * Deliberately applied at the sync boundary and nowhere else: an exclusion
   * must never block a task the user is explicitly asking for. Creating a task,
   * applying a template, and importing a category are all direct requests, and
   * a fence that silently swallowed one of those would be the same
   * invisible-fence failure pointing the other way.
   */
  static filterExcluded<T extends { externalId: string }>(tasks: T[], excluded: Set<string>): T[] {
    return excluded.size === 0 ? tasks : tasks.filter(t => !excluded.has(t.externalId));
  }

  /**
   * Forget exclusions for whole categories — the way back.
   *
   * Called when the user explicitly imports those categories, which is the same
   * gesture that started tracking them in the first place. An exclusion that
   * could only ever be added would be a one-way door, and this project's rule is
   * to never create what you cannot remove.
   *
   * Returns the number of exclusions cleared, so the caller can *say* what it
   * did rather than quietly resurrecting rows the user removed on purpose.
   */
  static async clearExclusionsForCategories(
    userId: string,
    platform: PlatformType,
    categories: string[]
  ): Promise<number> {
    if (categories.length === 0) return 0;

    // Filtered in JS rather than SQL because "which category is this?" is
    // `extractCategory`'s answer alone — deriving it a second time in a query
    // would be the second definition that #20a punished.
    const rows = await prisma.taskExclusion.findMany({
      where: { userId, platform },
      select: { id: true, externalId: true }
    });
    const wanted = new Set(categories);
    const ids = rows
      .filter(r => wanted.has(this.extractCategory(r.externalId, platform)))
      .map(r => r.id);

    if (ids.length === 0) return 0;
    const result = await prisma.taskExclusion.deleteMany({ where: { id: { in: ids } } });
    return result.count;
  }

  /**
   * Is this task owned by the OS rather than the user?
   *
   * One definition, on the server, deliberately: the dashboard needs the same
   * answer `summarizeUntracked` already uses, and re-deriving it in the browser
   * would be a second definition of a rule that decides what a user sees — the
   * shape of #20a. Callers get the verdict, never the predicate.
   */
  static isSystemTask(externalId: string, platform: PlatformType): boolean {
    return SYSTEM_CATEGORIES.has(this.extractCategory(externalId, platform));
  }

  public static extractCategory(externalId: string, platform: PlatformType): string {
    if (platform === PlatformType.WINDOWS_TASK_SCHEDULER) {
      // Windows paths: \Folder\Subfolder\TaskName or \TaskName
      // Use regex to split by both backslash and forward slash to handle different environments
      const parts = externalId.split(/[\\\/]/).filter(p => p.length > 0);
      
      // If parts.length > 1, the task is in a folder. 
      // The first part of the filtered list is the ROOT folder.
      if (parts.length > 1) {
        return parts[0];
      }
    }
    return 'Uncategorized';
  }
}
