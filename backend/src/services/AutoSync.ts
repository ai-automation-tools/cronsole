import { PlatformType, type PlatformConnection } from '@prisma/client';
import { prisma } from '../db.js';
import { notifyTasksChanged } from '../ws/uiChannel.js';
import { syncConnection } from './syncConnection.js';

const TICK_INTERVAL_MS = 60_000;

/** Intervals a user may pick, in minutes. The floor is 5: a sync can ask a hosted API for everything. */
export const AUTO_SYNC_INTERVALS_MIN = [5, 15, 30, 60, 360, 1440] as const;

/**
 * Is this connection due? `autoSyncAt` is the last *attempt*, success or not, so
 * a failing platform is retried once per interval instead of every tick. A
 * manual sync does not postpone it — the timer is independent of `lastSync`.
 */
export function isAutoSyncDue(
  conn: Pick<PlatformConnection, 'syncIntervalMin' | 'autoSyncAt' | 'platform' | 'isActive'>,
  now: Date
): boolean {
  if (!conn.isActive || !conn.syncIntervalMin) return false;
  // Native has nothing external to be stale against (its row is the source of truth).
  if (conn.platform === PlatformType.TASKHUB_NATIVE) return false;
  if (!conn.autoSyncAt) return true;
  return now.getTime() - conn.autoSyncAt.getTime() >= conn.syncIntervalMin * 60_000;
}

/**
 * Refresh timer, per connection (on by default at 30 min; NULL = off). **Refresh only**: it always syncs with
 * `scope: 'tracked'`, so it never clears an untrack exclusion and never adopts a
 * new folder (that would be 257 Microsoft tasks arriving unasked). A newly
 * appeared folder is still surfaced by the `untracked` count on the next manual
 * sync. Single-instance, like `NativeScheduler`.
 */
export class AutoSync {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  start() {
    this.timer = setInterval(() => void this.tick(), TICK_INTERVAL_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(now: Date = new Date()) {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const candidates = await prisma.platformConnection.findMany({
        where: { isActive: true, syncIntervalMin: { not: null } }
      });
      const changedUsers = new Set<string>();
      for (const conn of candidates) {
        if (!isAutoSyncDue(conn, now)) continue;
        // One platform failing must not stop the others, and the failure is kept
        // on the row — a timer failing in a console nobody reads is the silent
        // version of "sync reported success over nothing".
        let error: string | null = null;
        try {
          await syncConnection(conn, conn.userId, { scope: 'tracked' });
          changedUsers.add(conn.userId);
        } catch (err: any) { // ponytail: connector errors are untyped; only .message is read
          error = err?.message ?? String(err);
        }
        await prisma.platformConnection.update({
          where: { id: conn.id },
          data: { autoSyncAt: now, autoSyncError: error }
        });
      }
      for (const userId of changedUsers) notifyTasksChanged(userId);
    } catch (error) {
      console.error('[AutoSync] tick error:', error);
    } finally {
      this.ticking = false;
    }
  }
}

export const autoSync = new AutoSync();
