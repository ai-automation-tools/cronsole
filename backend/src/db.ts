import { PrismaClient, TaskStatus } from '@prisma/client';

/**
 * Shared Prisma client. Every module must import this instance instead of
 * constructing its own — each PrismaClient owns a connection pool, so the old
 * one-client-per-file pattern multiplied idle Postgres connections and made
 * transaction/middleware behavior inconsistent across the app.
 */
export const prisma = new PrismaClient();

/**
 * Enum members the code writes and therefore cannot function without. Kept as
 * plain strings on purpose: reading them off the generated client would make the
 * check tautological.
 */
const REQUIRED_TASK_STATUSES = ['ACTIVE', 'DISABLED', 'UNKNOWN', 'DELETED', 'MISSING'] as const;

/**
 * Names the enum members missing from the *generated* Prisma client, or [] when
 * it's current.
 *
 * Why this exists — a bug that shipped silently for nine days. The generated
 * client lives in `node_modules`, which the compose stack shadows with an
 * anonymous volume (see troubleshooting #18), so a host `prisma generate` never
 * reaches the container. `prisma migrate` still updates the *database*, so the
 * DB enum gained `MISSING` while the container's client did not — and
 * `TaskStatus.MISSING` evaluated to `undefined`.
 *
 * That degrades far worse than it sounds: **Prisma treats `undefined` in a
 * `data` payload as "leave this field alone"**, so
 * `{ status: undefined, nextRunTime: null }` quietly wrote only `nextRunTime` —
 * while `updateMany` still returned a non-zero count, which the sync route
 * reported as `missing: 56`. The API confidently claimed 56 tasks had been
 * marked MISSING while marking none, which is the exact failure mode §9 ranks
 * worst. No error, no warning, green tests: the unit suite mocks Prisma, so
 * `TaskStatus.MISSING` was whatever the mock said.
 *
 * A wrong enum value would throw. A *missing* one silently no-ops. That
 * asymmetry is why this needs an explicit check rather than trusting types —
 * TypeScript validates against the host's client, not the container's.
 */
export function missingTaskStatusMembers(): string[] {
  return REQUIRED_TASK_STATUSES.filter(s => (TaskStatus as Record<string, string>)[s] === undefined);
}

/**
 * Loud, non-fatal boot check. Non-fatal deliberately: a stale enum breaks the
 * features that write it, not the whole app, and taking the stack down over it
 * would be a worse trade than a banner plus an honest refusal at the write site
 * (see `TaskService.reconcileMissingTasks`).
 */
export function warnOnStaleGeneratedClient(): void {
  const absent = missingTaskStatusMembers();
  if (absent.length === 0) return;

  console.error(
    `\n!!! STALE GENERATED PRISMA CLIENT !!!\n` +
    `  TaskStatus is missing: ${absent.join(', ')}\n` +
    `  Writes to those values will be SILENTLY DROPPED (Prisma ignores undefined fields).\n` +
    `  Fix: docker compose exec backend npx prisma generate && docker restart taskhub-backend-1\n` +
    `  See docs/troubleshooting/README.md #22\n`
  );
}
