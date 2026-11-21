import { prisma } from '../db.js';

const DAY_MS = 86_400_000;
const PRUNE_INTERVAL_MS = DAY_MS;

/** Default keep window. A per-minute job writes ~1,440 rows a day, so "forever" is not a default. */
export const DEFAULT_RETENTION_DAYS = 90;

/**
 * Days of `ExecutionLog` to keep, from `EXECUTION_LOG_RETENTION_DAYS`. `0` keeps
 * everything. Anything that is not a non-negative whole number falls back to the
 * default rather than to "keep forever": a typo must not silently turn the
 * prune off, which is the failure this exists to prevent.
 */
export function retentionDays(raw: string | undefined = process.env.EXECUTION_LOG_RETENTION_DAYS): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_RETENTION_DAYS;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_RETENTION_DAYS;
}

/**
 * Delete runs older than the window. Returns how many went (0 when retention is
 * off). Only `ExecutionLog` is touched: health reads the newest rows, and the
 * pre-delete task archive is a separate table with its own lifetime.
 */
export async function pruneExecutionLogs(now: Date = new Date(), days: number = retentionDays()): Promise<number> {
  if (days === 0) return 0;
  const cutoff = new Date(now.getTime() - days * DAY_MS);
  const { count } = await prisma.executionLog.deleteMany({ where: { triggeredAt: { lt: cutoff } } });
  return count;
}

/** Daily prune, once at boot and then every 24 h. Single-instance, like `NativeScheduler`. */
export class RunRetention {
  private timer: NodeJS.Timeout | null = null;

  start() {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), PRUNE_INTERVAL_MS);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(now: Date = new Date()) {
    try {
      const count = await pruneExecutionLogs(now);
      if (count > 0) console.log(`[RunRetention] pruned ${count} run record(s) older than ${retentionDays()} days`);
    } catch (error) {
      console.error('[RunRetention] prune error:', error);
    }
  }
}

export const runRetention = new RunRetention();
