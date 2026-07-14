/**
 * Sync the template catalog (from the configured catalog source) into the DB.
 *
 * This is the shared upsert path used by both `npm run seed` and the backend's
 * runtime refresh (index.ts). It's what makes the registry's "update without
 * shipping the app" real: when the catalog source is the remote registry, a
 * periodic sync pulls catalog changes into the DB with no reseed/redeploy.
 *
 * Upsert-only by design: templates are keyed by their stable id, so favorites
 * (a separate join on templateId) and applied tasks are untouched. Templates
 * removed from the registry are NOT pruned here — deleting shared catalog rows
 * (which may be favorited) is a separate, safety-sensitive decision left as a
 * follow-up.
 *
 * Core vs. extended: this auto-sync only materializes the curated **core** set
 * (`core: true`). The full registry/gallery contains core + extended, but
 * extended templates enter a DB only when a user imports one (via the Import
 * route). So a fresh install gets a small, high-value default catalog, and the
 * long tail is opt-in — see ROADMAP "Template gallery site + selective-import".
 */

import { prisma } from '../db.js';
import { catalogSource, type TemplateCatalogSource } from './source.js';

// The shared catalog is owned by the MVP placeholder user (see CLAUDE.md — the
// curated library is seeded under this user and read globally).
export const CATALOG_OWNER_ID = 'cli_user_placeholder';
const CATALOG_OWNER_EMAIL = 'mike@example.com';

export interface CatalogSyncResult {
  count: number;
  source: string;
}

/**
 * Ensure the shared catalog owner exists so a template create's `user` relation
 * resolves, regardless of call order (seed / boot / import). Idempotent.
 */
export async function ensureCatalogOwner(): Promise<void> {
  await prisma.user.upsert({
    where: { email: CATALOG_OWNER_EMAIL },
    update: {},
    create: { id: CATALOG_OWNER_ID, email: CATALOG_OWNER_EMAIL, name: 'Mike' }
  });
}

export async function syncCatalogToDb(
  source: TemplateCatalogSource = catalogSource
): Promise<CatalogSyncResult> {
  await ensureCatalogOwner();

  // Only the curated core auto-syncs. `listRaw()` carries the `core` flag (the
  // normalized `list()` shape drops it); intersect by id so we upsert the
  // normalized rows for core templates only.
  const raw = await source.listRaw();
  const coreIds = new Set(raw.filter((t) => t.core === true).map((t) => t.id));
  const templates = (await source.list()).filter((t) => coreIds.has(t.id));
  for (const { id, ...data } of templates) {
    await prisma.template.upsert({
      where: { id },
      update: data,
      create: { id, user: { connect: { id: CATALOG_OWNER_ID } }, ...data }
    });
  }

  return { count: templates.length, source: source.name };
}

// --- Runtime refresh (boot + interval) ---------------------------------------

let refreshTimer: ReturnType<typeof setInterval> | undefined;

function defaultIntervalMs(): number {
  const explicit = Number(process.env.TEMPLATE_REGISTRY_SYNC_INTERVAL_MS);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  // Only poll on an interval when pointed at a remote registry (the bundled
  // snapshot never changes at runtime). Default: 30 minutes.
  return process.env.TEMPLATE_REGISTRY_URL?.trim() ? 30 * 60 * 1000 : 0;
}

/**
 * Start the runtime catalog refresh: an immediate sync (awaited so a fresh DB
 * has templates before the API serves) plus, when a remote registry is
 * configured, a periodic re-sync. Sync failures are logged, not fatal — the
 * source already falls back to the bundled snapshot on fetch/verify errors.
 */
export async function startCatalogRefresh(): Promise<void> {
  const run = async () => {
    try {
      const r = await syncCatalogToDb();
      console.log(`[catalog] synced ${r.count} templates from "${r.source}".`);
    } catch (err) {
      console.error('[catalog] sync failed:', err);
    }
  };

  await run();

  const intervalMs = defaultIntervalMs();
  if (intervalMs > 0) {
    refreshTimer = setInterval(run, intervalMs);
    // Don't keep the process alive just for the refresh timer.
    refreshTimer.unref?.();
    console.log(`[catalog] runtime refresh every ${Math.round(intervalMs / 1000)}s.`);
  }
}

export function stopCatalogRefresh(): void {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = undefined;
}
