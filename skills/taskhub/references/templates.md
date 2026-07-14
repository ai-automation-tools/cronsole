# Templates & the registry

Load when touching the catalog, adding templates, or publishing the registry.

**Canonical:** [`docs/reports/templates/Registry_Schema_v1.md`](../../../docs/reports/templates/Registry_Schema_v1.md),
[`docs/adr/0001-template-registry-schema.md`](../../../docs/adr/0001-template-registry-schema.md),
[`docs/reports/templates/Templates.md`](../../../docs/reports/templates/Templates.md).

## The core idea

**Templates are content, not code.** They used to be inlined in `seed.ts`; now they're a
**decoupled, versioned, hosted registry** the app fetches at runtime. That means *the catalog
updates without redeploying the app* — the entire point of the decoupling.

A template is **target-agnostic** (**Trigger → Action → Execution Target**) and is *compiled*
to a target's native config **at apply time**. Only **Windows** and **TaskHub-native** have
real compilers today. A declared-but-uncompiled `compatibleTargets` entry is the honest
"copy to set up manually" path — **never a silent failure**.

## The pipeline

```
backend/src/catalog/bundled.ts     ← SOURCE OF TRUTH. Edit here.
        │  npm run registry:build  (backend/)
        ▼
registry/                          ← GENERATED. index.json + templates/*.json
        │                            content-addressed (sha256). NEVER hand-edit.
        │  pwsh scripts/publish-registry.ps1
        ▼
github.com/michaelschecht/taskhub-registry  → https://mikesailab.com/taskhub-registry
        │  RegistryCatalogSource (sha256-verified, cached, bundled fallback)
        ▼
catalogSync  → DB (boot + interval)
```

## Core vs. extended — the distribution tiers

Templates carry an optional **`core`** flag. **Current split: 5 core + 50 extended = 55.**

- **`catalogSync` auto-syncs only `core: true`** — it intersects the `core` ids from
  `listRaw()` with the normalized `list()` rows. A fresh install gets a **small curated
  sampler**.
- The **extended long tail is import-only** — users pull those from the gallery via the Import
  route.
- The **registry/gallery always contains both** (it's built from the full `bundledCatalog`).
  Only the *auto-sync* is limited. The gallery reads `core` from `index.json` and shows an
  **Availability** facet (Built-in / Import) plus a "Built-in" card badge.
- **No DB column.** `normalize.ts` whitelists Prisma fields, so `core` **never reaches the
  DB**. To reclassify: flip `core: true/false` in `bundled.ts` and rebuild.

### Prune-on-sync

Auto-synced rows are marked **`Template.managed = true`**. After upserting core, `catalogSync`
**deletes managed rows outside the core set** — so **existing** installs converge to core too,
not just fresh ones.

Two guardrails that must never break:

1. **Imported / saved-as-template rows are `managed: false` and are NEVER pruned.** They're the
   user's. Pruning them is data loss.
2. **An empty core cannot wipe the catalog.** A bad sync must not nuke everything.

## The files

| File | Role |
|:---|:---|
| `bundled.ts` | **Source of truth** — the full catalog, compiled in. Edit this. |
| `schema.ts` | Registry v1 Zod schema |
| `source.ts` | `TemplateCatalogSource` interface — `BundledCatalogSource` \| `RegistryCatalogSource`. Selected by `TEMPLATE_REGISTRY_URL`. |
| `registrySource.ts` | Remote fetch: integrity-checked per-file sha256, cached, **falls back to bundled** |
| `catalogSync.ts` | Upserts into the DB on boot + interval. Favorites and applied tasks are keyed by template id and **untouched**. |
| `normalize.ts` | Registry shape → Prisma shape. **Whitelists fields** — the reason `core` never leaks. |
| `denormalize.ts` | Prisma → registry shape (export) |
| `importCatalog.ts` / `exportCatalog.ts` | `POST /api/templates/import` / `GET /api/templates/export` |
| `templateFromTask.ts` | `POST /api/tasks/:id/save-as-template` |
| `generate-registry.ts` / `registryBuild.ts` | `npm run registry:build` |

## `index.json` entry shape

```jsonc
{
  "id": "tpl_daily_database_backup",
  "name": "Daily Database Backup",
  "description": "Back up a PostgreSQL database on a schedule with pg_dump.",
  "category": "backup",
  "tags": ["windows", "backup", "database", "postgres"],
  "core": true,                     // ← distribution tier; never reaches the DB
  "runtime": "executable",
  "os": "windows",
  "compatibleTargets": ["windows"], // honest: uncompiled targets → manual-copy path
  "path": "templates/tpl_daily_database_backup.json",
  "sha256": "3a8caeca781b4fe36…"    // over the EXACT bytes of that file
}
```

## Adding or changing a template

1. **Edit `backend/src/catalog/bundled.ts`.** Never `seed.ts`. Never `registry/`.
2. Decide the tier: `core: true` only if it earns a slot in the **5**-template fresh-install
   sampler. Default is extended.
3. Tag it (`tags: []`) — free-form, distinct from the single `category` enum.
4. Keep `exec` **no-shell**: `{executable, args[]}`. Opt into a shell explicitly
   (`cmd.exe /c "…"`) only when the template genuinely needs one.
5. Rebuild: `cd backend && npm run registry:build`
6. Test: `npm test` — the **whole-catalog resolvability** test pushes every `commandTemplate`
   through the Apply pipeline, and the **drift test** fails if `registry/` doesn't match
   `bundled.ts`.
7. **Commit `registry/` with your `bundled.ts` change** — they must stay in lockstep.
8. Publish: `pwsh scripts/publish-registry.ps1`

## Publishing

```powershell
cd backend; npm run registry:build   # regenerate
cd ..;      npm test                 # drift + resolvability
git add registry backend/src/catalog/bundled.ts
git commit -m "feat(catalog): …"
pwsh scripts/publish-registry.ps1    # mirror to the public repo
```

**`publish-registry.ps1` does NOT regenerate** — it only mirrors `registry/`. Build and commit
first, or you'll publish stale JSON that disagrees with the repo.

### The two public site repos

Local clones live side by side under `D:\AI_Agents\Projects\Mikes_AI_Lab\Repos\Tools\`:

| Clone | Remote | Serves | Source in this repo |
|:---|:---|:---|:---|
| `Tools\taskhub-registry` | `michaelschecht/taskhub-registry` | `mikesailab.com/taskhub-registry` (registry JSON **+** gallery) | `registry/` + `registry-site/` |
| `Tools\taskhub-site` | `michaelschecht/taskhub-site` | `taskhub.mikesailab.com` (landing) | `landing-site/` |

- They are **separate, independent git repos — NOT submodules.**
- **These clones double as the publish working clones.** The scripts default `-WorkDir` to
  them (falling back to `%TEMP%` elsewhere), `git reset --hard origin/main`, copy, commit,
  push. **Never keep manual work in them** — the reset will eat it.
- **The public repos own their own `README.md`** (house-style front pages). Both publish
  scripts **exclude `README.md`** from the mirror, so the clones' READMEs are safe. The
  in-repo folder READMEs are dev notes and diverge on purpose.

## Content-addressing rules

- Registry files are **sha256 over exact bytes**. Keep them **LF** (`.gitattributes`).
- **Never hand-edit `registry/`.** The drift test will catch you, but only after you've wasted
  the time.
- A CRLF flip silently breaks every hash → `RegistryCatalogSource` rejects the registry →
  falls back to bundled. The app still boots (good), but your registry is dead (bad, and
  quiet).

## Growing the catalog without a reseed

Three non-reseed paths, all first-class:

| Path | Endpoint / file | Result |
|:---|:---|:---|
| **Import** | `POST /api/templates/import` (`importCatalog.ts`) | `managed: false` — never pruned |
| **Export** | `GET /api/templates/export` (`exportCatalog.ts`) | Registry-shaped JSON |
| **Save as template** | `POST /api/tasks/:id/save-as-template` (`templateFromTask.ts`) | A real task → a reusable template, `managed: false` |
