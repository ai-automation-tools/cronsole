/**
 * Sync the template catalog (from the configured catalog source) into the DB.
 *
 * This is the shared upsert path used by both `npm run seed` and the backend's
 * runtime refresh (index.ts). It's what makes the registry's "update without
 * shipping the app" real: when the catalog source is the remote registry, a
 * periodic sync pulls catalog changes into the DB with no reseed/redeploy.
 *
 * Keyed by stable template id, so favorites (a join on templateId) and applied
 * tasks are keyed the same way and survive an upsert.
 *
 * Core vs. extended: this auto-sync only materializes the curated **core** set
 * (`core: true`). The full registry/gallery contains core + extended, but
 * extended templates enter a DB only when a user imports one (via the Import
 * route). So a fresh install gets a small, high-value default catalog, and the
 * long tail is opt-in — see ROADMAP "Template gallery site + selective-import".
 *
 * Prune-on-sync: auto-synced templates are marked `managed: true` and are
 * reconciled to the current core set on every sync — a template demoted out of
 * core (or removed from the catalog) is deleted, so an *existing* install
 * converges to the curated default, not just fresh ones. Prune is scoped to
 * `managed: true`, so anything the user imported or saved-as-template
 * (`managed: false`) is never touched. Deleting a managed template cascades its
 * favorites (a re-import re-adds it); applied tasks are separate rows and are
 * untouched.
 */

import { prisma } from '../db.js';
import { catalogSource, type TemplateCatalogSource } from './source.js';

// The shared catalog is owned by the MVP placeholder user (see CLAUDE.md — the
// curated library is seeded under this user and read globally).
export const CATALOG_OWNER_ID = 'cli_user_placeholder';
const CATALOG_OWNER_EMAIL = 'mike@example.com';

export interface CatalogSyncResult {
  count: number;
  /** Managed templates deleted because they are no longer `core`. */
  pruned: number;
  source: string;
}

/**
 * Ensure the shared catalog owner exists so a template create's `user` relation
 * resolves, regardless of call order (seed / boot / import). Idempotent.
 */
export async function ensureCatalogOwner(): Promise<void> {
  // Keyed on the immutable `id`, never the email. The single-user login flow lets
  // this row's email change to the user's real address; an email lookup then
  // misses and the upsert falls through to *create* an id that already exists →
  // P2002, which here is swallowed by the caller's catch, so the catalog just
  // silently stops syncing. Identical trap to troubleshooting #19, which fixed
  // the same pattern in src/index.ts but not this second copy.
  await prisma.user.upsert({
    where: { id: CATALOG_OWNER_ID },
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
  const coreIdList = raw.filter((t) => t.core === true).map((t) => t.id);
  const coreIds = new Set(coreIdList);
  const templates = (await source.list()).filter((t) => coreIds.has(t.id));
  // Auto-synced templates are marked `managed: true`, which is what makes them
  // eligible for prune below. User-authored templates (import / save-as-template)
  // leave `managed` at its `false` default and are never touched.
  for (const { id, ...data } of templates) {
    await prisma.template.upsert({
      where: { id },
      update: { ...data, managed: true },
      create: { id, user: { connect: { id: CATALOG_OWNER_ID } }, ...data, managed: true }
    });
  }

  // Prune-on-sync: delete managed templates that are no longer core, so an
  // existing install converges to the curated default (not just fresh ones) and
  // a demoted template disappears without a reseed. Scoped to `managed: true`,
  // so imported/saved templates survive. Guarded: if the source returned no core
  // (e.g. a bad fetch that somehow bypassed the bundled fallback), skip the prune
  // rather than wipe the catalog.
  let pruned = 0;
  if (coreIdList.length > 0) {
    const res = await prisma.template.deleteMany({
      where: { managed: true, id: { notIn: coreIdList } }
    });
    pruned = res.count;
  }

  return { count: templates.length, pruned, source: source.name };
}

// --- Runtime refresh (boot + interval) ---------------------------------------

let refreshTimer: ReturnType<typeof setInterval> | undefined;

/**
 * The outcome of the most recent catalog sync attempt, kept for the diagnostics
 * report.
 *
 * A sync failure is deliberately **non-fatal and logged** — the source falls
 * back to the bundled snapshot, so the app keeps working. That is the right
 * behaviour and it is also why the failure is invisible: the console line
 * scrolls past inside a container, the Templates tab still lists templates, and
 * the only symptom is that the catalog silently stopped updating (troubleshooting
 * #21, #58). Keeping the last result in memory is what lets something ask.
 *
 * `null` means no attempt has completed yet — absence of evidence, which the
 * check reports as `unknown` rather than as a pass.
 */
export interface CatalogSyncAttempt {
  at: Date;
  ok: boolean;
  count?: number;
  pruned?: number;
  source?: string;
  error?: string;
}

let lastAttempt: CatalogSyncAttempt | null = null;

export function getLastCatalogSync(): CatalogSyncAttempt | null {
  return lastAttempt;
}

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
      lastAttempt = { at: new Date(), ok: true, count: r.count, pruned: r.pruned, source: r.source };
      console.log(
        `[catalog] synced ${r.count} core templates from "${r.source}"` +
          (r.pruned > 0 ? `, pruned ${r.pruned} stale managed template(s).` : '.')
      );
    } catch (err) {
      lastAttempt = {
        at: new Date(),
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      };
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
