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
to a target's native config **at apply time**. Only **Windows** and **Cronsole-native** have
real compilers today. A declared-but-uncompiled `compatibleTargets` entry is the honest
"copy to set up manually" path — **never a silent failure**.

## The pipeline

```
backend/src/catalog/bundled.ts     ← SOURCE OF TRUTH (templates). Edit here.
backend/src/catalog/packs.ts       ← SOURCE OF TRUTH (pack membership). Edit here.
        │  npm run registry:build  (backend/)
        ▼
registry/                          ← GENERATED. index.json + templates/*.json + packs/*.json
        │                            content-addressed (sha256). NEVER hand-edit.
        │  pwsh scripts/publish-registry.ps1
        ▼
github.com/michaelschecht/cronsole-registry  → https://mikesailab.com/cronsole-registry
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

## Packs (`index.json` → `packs[]`)

A **pack** is a curated set a user imports in one action. `index.json` carries an optional
`packs[]`; each entry points at a self-contained bundle:

```jsonc
{
  "id": "developer",                              // kebab; also packs/<id>.json
  "name": "Developer Pack",
  "description": "Keep repos fresh and toolchains healthy…",
  "templateIds": ["dev-git-fetch-prune", "…"],    // DECLARED, not derived
  "path": "packs/developer.json",
  "sha256": "61092b23f86f…"                        // over the EXACT bundle bytes
}
```

The bundle is `{ cronsoleCatalogVersion, pack, templates[] }` — **the exact shape
`POST /api/templates/import` accepts**, so a pack download is one file and one import. Import
reads `.templates` and ignores the rest.

| Rule | Why |
|:---|:---|
| **Membership is declared in `packs.ts`, never derived from tags** | The gallery used to infer collections from `tags.includes('dev')`. Tagging an unrelated template then silently changed what the pack contained — fine for a filtered view, **not** for a file that lands in someone's catalog. |
| **`buildRegistry` throws on an unknown or duplicated id** | Turns silent drift into a broken build. That is the whole point of declaring. |
| **`packs` is optional in both directions** | A pre-packs registry has no key and parses; a pre-packs app parses a registry that has one (`z.object()` strips unknown keys). No coordinated release needed. Omitted entirely when empty, so a pre-packs registry stays byte-identical. |
| **No timestamp inside a bundle** | Registry files are hashed over exact bytes; a clock would change the hash every build and make the drift test meaningless. |
| **Every template belongs to ≥1 pack; overlap is fine** | A template in no pack is unreachable by collection and makes "download every pack" less than the catalog. A test asserts 55/55. |
| **The registry owns data; the gallery owns presentation** | Icons/colors are keyed by pack id in the site with a default — adding a pack needs no site change. |

## Adding or changing a template

> [!IMPORTANT]
> **Your dev backend probably syncs from the *public* CDN, not your edit.** `registry/` is a
> **generated artifact** — nothing reads it at runtime. `buildCatalogSource()` picks exactly
> two sources: **unset `TEMPLATE_REGISTRY_URL` → the compiled-in `bundled.ts`**, or **set →
> fetched over HTTP**. `backend/.env.example` ships the hosted URL as the **default**, so out
> of the box a local template change is invisible until it's published *publicly* — you'd have
> to ship a broken template to the world to test its fix. For the authoring loop, comment
> `TEMPLATE_REGISTRY_URL` out of `backend/.env` and `docker compose restart backend`; a healthy
> boot logs `[catalog] synced 5 core templates from "bundled"`. Re-enable it to exercise the
> real fetch + sha256 + cache path.

1. **Edit `backend/src/catalog/bundled.ts`.** Never `seed.ts`. Never `registry/`.
2. Decide the tier: `core: true` only if it earns a slot in the **5**-template fresh-install
   sampler. Default is extended.
3. Tag it (`tags: []`) — free-form, distinct from the single `category` enum.
4. Keep `exec` **no-shell**: `{executable, args[]}`. Opt into a shell explicitly
   (`cmd.exe /c "…"`) only when the template genuinely needs one.
4a. **Put it in at least one pack** — add its id to a pack in `backend/src/catalog/packs.ts`.
   A template in no pack is unreachable by browsing the gallery's collections, and makes
   "download every pack" quietly less than the catalog; a test asserts full coverage, so
   skipping this **fails the build**. Overlap is fine — a template may be in several packs.
5. Rebuild: `cd backend && npm run registry:build`
6. Test: `npm test` — the **whole-catalog resolvability** test pushes every `commandTemplate`
   through the Apply pipeline, and the **drift test** fails if `registry/` doesn't match
   `bundled.ts`.
7. **Commit `registry/` with your `bundled.ts` change** — they must stay in lockstep.
8. Publish: `pwsh scripts/publish-registry.ps1`

> [!WARNING]
> **Resolvability is not correctness.** The sweep in step 6 proves a `commandTemplate`
> *tokenizes and substitutes* — **not that the command works on the target**. A template can
> pass every test and still be broken on a real machine. The only proof is applying it and
> watching the task run. This shipped a broken **core** template: the webhook starter used
> `Invoke-WebRequest` without `-UseBasicParsing`, which Windows PowerShell 5.1 parses with the
> **Internet Explorer engine that Windows 11 no longer ships** — so it died on a
> `NullReferenceException`, and under Task Scheduler **hung forever** instead of exiting (its
> `*/15` default would strand a `powershell.exe` every 15 minutes). See
> [troubleshooting #12](../../../docs/troubleshooting/README.md#12-a-template-passes-every-test-and-still-hangs-on-the-target).
>
> Authoring rules that follow from it:
> - **`Invoke-WebRequest` → always `-UseBasicParsing`.** Prefer `Invoke-RestMethod` for
>   JSON/XML — it parses directly and never touches IE.
> - **`powershell.exe` → always `-NoProfile`.** An unattended run must not depend on the
>   user's profile.
> - **A scheduled run has no console.** A command that merely *errors* interactively can
>   *block* under Task Scheduler, where the task sits `Running` forever and Cronsole reports
>   `lastRunStatus: SUCCESS` — because "started" is all it can observe.

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
| `Tools\cronsole-registry` | `michaelschecht/cronsole-registry` | `mikesailab.com/cronsole-registry` (registry JSON **+** gallery) | `registry/` + `registry-site/` |
| `Tools\cronsole-site` | `michaelschecht/cronsole-site` | `cronsole.mikesailab.com` (the front door — **the same gallery page**, not a landing page) | `registry-site/` |

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
