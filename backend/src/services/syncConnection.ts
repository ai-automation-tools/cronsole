import { TaskStatus, type PlatformConnection } from '@prisma/client';
import { prisma } from '../db.js';
import { syncOutcomeOf } from '../connectors/platform.interface.js';
import { connectorRegistry } from '../connectors/registry.js';
import { deserializeConfig } from '../auth/connectionConfig.js';
import { TaskService } from './TaskService.js';
import { recordCapability } from './platformCapabilities.js';

export interface SyncRequest {
  /** Explicit folders to INCLUDE — the Import flow. Clears exclusions inside them. */
  categories?: string[];
  /** `'tracked'` = refresh only what is already tracked. Never clears an exclusion. */
  scope?: 'tracked';
}

/**
 * Sync ONE connection. The single definition shared by `POST /tasks/sync` and
 * the periodic sync (`AutoSync`) — a second copy is how a timer would end up
 * clearing an exclusion or retiring tasks on a narrowed read, which the route's
 * rules exist to prevent. **Throws** on failure; the caller decides how to
 * report it (the route puts it in the row, the timer stores it).
 *
 * The rules this body carries, and why, live in AGENTS.md §9 › Connectors
 * (refresh vs import, `partial`, `complete`, `lastSync` having one writer).
 */
export async function syncConnection(
  conn: PlatformConnection,
  userId: string,
  { categories, scope }: SyncRequest
) {
  const connector = connectorRegistry.getConnector(conn.platform);
  if (!connector) throw new Error(`No connector for ${conn.platform}`);

  try {
    const connectorConfig = { ...deserializeConfig(conn.config), userId };
    // A connector may return a bare list or a `SyncOutcome` that also says
    // what it *looked at*. Normalized once, here, so nothing downstream has
    // to know which form it got.
    const outcome = syncOutcomeOf(await connector.syncTasks(connectorConfig));
    let tasks = outcome.tasks;
    const allExternalIds = tasks.map(t => t.externalId);

    // Resolve the include-set. `scope: 'tracked'` is computed per platform;
    // an empty set legitimately means "sync nothing here", so it must still
    // filter rather than fall through to "sync everything" — hence the
    // `!== undefined` check, not truthiness.
    //
    // **A connector may declare its own tracked set**, and one does. The
    // default — categories that already hold stored rows — encodes how a
    // folder becomes tracked on Windows: you pick it in the discovery modal,
    // and the rows are the only record that you did. GitHub Actions keeps
    // that record in its config instead (the repositories you watch), so
    // deriving from rows made adding a repository unable to adopt anything:
    // no rows yet, empty include-set, every workflow filtered out, and
    // **Sync reporting success over nothing on every press**. Asking the
    // connector keeps the platform-specific half inside the connector layer,
    // where §9 requires it.
    const include = scope === 'tracked'
      ? connector.trackedCategories?.(connectorConfig)
        ?? await TaskService.trackedCategories(userId, conn.platform)
      : categories;

    if (include !== undefined) {
      tasks = tasks.filter(t =>
        include.includes(TaskService.extractCategory(t.externalId, conn.platform))
      );
    }

    // An explicit `categories` import is the user asking for those folders by
    // name — the same gesture that started tracking them — so it forgets any
    // prior untracks inside them. Doing this BEFORE reading the exclusion set
    // is what makes import the honest way back; if it ran after, the import
    // would clear the fence and still skip the tasks this one time, which
    // reads as "import didn't work" one sync later.
    //
    // `scope: 'tracked'` (the plain Sync) deliberately does NOT clear: it is a
    // refresh, not a request for anything new, and having a routine refresh
    // undo a deliberate removal is the invisible-fence failure exactly.
    let exclusionsCleared = 0;
    if (scope !== 'tracked' && categories !== undefined) {
      exclusionsCleared = await TaskService.clearExclusionsForCategories(
        userId, conn.platform, categories
      );
    }

    const excluded = await TaskService.excludedExternalIds(userId, conn.platform);
    tasks = TaskService.filterExcluded(tasks, excluded);

    // What this sync deliberately left out. Selective import is the design,
    // but its invisibility cost a full debugging session (troubleshooting
    // #20): a plain Sync cannot discover a new folder, so tasks can sit one
    // fence away indefinitely while every sync reports success. Computed
    // from the enumeration we already have — no extra agent round-trip.
    const untracked = TaskService.summarizeUntracked(allExternalIds, include, conn.platform, excluded);

    await TaskService.upsertTasks(userId, conn.platform, tasks);

    // Reconcile tasks absent from the platform: flip them to MISSING (not
    // delete — absence isn't proof they're gone; see reconcileMissingTasks).
    // Upsert ran first, so a task that reappeared this sync is already back
    // to ACTIVE/DISABLED and won't be re-marked. Skip TASKHUB_NATIVE (its
    // connector returns [] — the DB itself is the source of truth) and skip
    // empty lists as a safety net against flipping a whole platform.
    //
    // **And never on a partial view.** A connector that saw less than the
    // whole platform says so (`outcome.partial`), and a task absent from a
    // narrowed enumeration is not evidence the task is gone — it is evidence
    // the reader was narrowed. Retiring on one is how an unelevated agent
    // declared 86 healthy tasks MISSING (#74); the 50%-retention guard does
    // not help, because a plausible-looking partial read is the dangerous
    // kind.
    let missing = 0;
    // A corroborating signal, not a gate (roadmap: "a MISSING set
    // concentrated in whole subtrees vs. scattered attrition") — it never
    // blocks the flip above, it only names a pattern worth a second look:
    // a whole folder disappearing at once reads more like a blocked read
    // than real deletions.
    const clusterWarnings: string[] = [];
    // `outcome.complete` lifts the empty-list net: a connector that vouches
    // for its listing means `[]` is "you deleted them all", not "saw nothing".
    if (conn.platform !== 'TASKHUB_NATIVE' && (allExternalIds.length > 0 || outcome.complete) && !outcome.partial) {
      const reconciliation = await TaskService.reconcileMissingTasks(
        userId, conn.platform, allExternalIds, outcome.complete === true
      );
      missing = reconciliation.count;
      if (reconciliation.concentrated) {
        const top = reconciliation.categories[0];
        clusterWarnings.push(
          `${top.missingCount} of the ${missing} tasks marked missing this sync are in "${top.category}" ` +
          `— a whole folder going missing at once often means a blocked read (permissions, agent scope) ` +
          `rather than real deletions. Worth checking before treating them as gone.`
        );
      }
    }

    // The one place a sync actually happened, so the one place allowed to
    // stamp it. `lastSync` used to be written only by the health probe,
    // from a `new Date()` the probe invented — which made the dashboard's
    // "synced N ago" chip a clock reading rather than a fact. Written here,
    // after the upsert landed, it means what it says.
    //
    // TASKHUB_NATIVE gets `null` for the same reason it is skipped by
    // reconciliation above: its connector returns [] because this database
    // IS the source of truth, so there is no external state to be stale
    // against. It is cleared rather than left alone because the chip takes
    // the newest lastSync across ALL platforms — so the fabricated values
    // the old probe already wrote would keep the whole dashboard reading
    // "synced just now" however stale Windows really was. `null` renders as
    // "Never" in Settings, which is exactly true: it has never synced,
    // because there is nothing for it to sync from.
    await prisma.platformConnection.update({
      where: { id: conn.id },
      data: { lastSync: conn.platform === 'TASKHUB_NATIVE' ? null : new Date() }
    });

    // `missing` is this pass's delta; `missingTotal` is the state. Both are
    // sent because `missing: 0` beside `count: 5` reads as "nothing is
    // missing" while two rows sit MISSING from an earlier sync. Read after
    // reconciliation so it includes what this pass just flipped.
    const missingTotal = await prisma.task.count({
      where: { userId, platform: conn.platform, status: TaskStatus.MISSING }
    });

    await recordCapability(userId, conn.platform, 'sync', true);
    return {
      platform: conn.platform,
      count: tasks.length,
      missing,
      missingTotal,
      untracked,
      exclusionsCleared,
      // What this sync covered, in the connector's own words. Present only
      // where a connector has something to add: "found nothing" and "looked
      // at nothing" are the same on screen otherwise, and that ambiguity has
      // now hidden a real defect once (troubleshooting #75).
      ...(outcome.notes?.length ? { notes: outcome.notes } : {}),
      ...((outcome.warnings?.length || clusterWarnings.length)
        ? { warnings: [...(outcome.warnings ?? []), ...clusterWarnings] }
        : {})
    };
  } catch (err: any) { // ponytail: connector errors are untyped; only .message is read
    await recordCapability(userId, conn.platform, 'sync', false, err?.message);
    throw err;
  }
}
