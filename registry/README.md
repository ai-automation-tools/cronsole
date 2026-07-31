# Cronsole Template Registry — generated artifact (source of truth)

> [!IMPORTANT]
> **Don't hand-edit anything in this folder.** It's generated from
> [`backend/src/catalog/bundled.ts`](../backend/src/catalog/bundled.ts) and
> content-addressed — a manual edit breaks the `sha256` checksums and the drift
> test fails in CI. Change the catalog in `bundled.ts`, then regenerate.

This directory is the **static template registry**: the decoupled catalog a Cronsole
backend can fetch at runtime instead of reading its compiled-in snapshot. It's this
repo's **source of truth** for the registry artifact, and what gets mirrored to the
separate public repo (see [Publishing](#publishing)).

> [!NOTE]
> **Remote fetching is opt-in.** `TEMPLATE_REGISTRY_URL` now defaults to **unset**, so a
> backend reads the compiled-in `bundled.ts` unless you point it at a hosted registry.
> Nothing reads *this folder* directly — it exists to be served or published. Defaulting to
> the hosted URL made a local template edit invisible until it was published publicly.

```
registry/
├── index.json              # one lightweight entry per template + sha256 integrity
└── templates/
    └── <id>.json           # one Registry v1 template per file
```

- **Schema:** [`docs/reports/templates/Registry_Schema_v1.md`](../docs/reports/templates/Registry_Schema_v1.md)
  (template shape) and the `index.json` shape (`registryVersion`, `updatedAt`,
  `templates[]` with `path` + `sha256`).
- **Decision record:** [`docs/adr/0001-template-registry-schema.md`](../docs/adr/0001-template-registry-schema.md).

## How it's used

Set `TEMPLATE_REGISTRY_URL` on the backend to the URL this directory is served
from. `RegistryCatalogSource`
([`backend/src/catalog/registrySource.ts`](../backend/src/catalog/registrySource.ts)) then:

1. fetches `index.json`,
2. fetches each `templates/<id>.json`,
3. **verifies each file's bytes against the index `sha256`** (a mismatch aborts the
   whole fetch — no partial/unverified seeding),
4. validates each against the v1 schema, caches the result, and
5. **falls back to the compiled-in bundled snapshot** on any failure (offline,
   404, bad checksum), so the app always has a working catalog.

Unset `TEMPLATE_REGISTRY_URL` = use the bundled snapshot directly.
`catalogSync.ts` upserts the catalog into the DB on boot + on an interval, so a
registry change lands with no reseed — favorites and applied tasks are keyed by
template id and untouched.

## Regenerating

The registry is generated from `backend/src/catalog/bundled.ts`. After editing the
catalog, regenerate:

```bash
cd backend
npm run registry:build              # writes ../registry
# or pin the stamp for a reproducible publish:
REGISTRY_UPDATED_AT="2026-07-13T00:00:00Z" npm run registry:build
```

A drift test ([`backend/src/catalog/registry.test.ts`](../backend/src/catalog/registry.test.ts))
fails if this committed artifact is out of sync with the bundled snapshot, so a
catalog edit that forgets `registry:build` is caught in CI.

> [!NOTE]
> **Line endings:** files here are pinned to LF (`.gitattributes`) because each
> `sha256` is computed over exact bytes — a CRLF rewrite would break every checksum.

## Publishing

This artifact is mirrored to a **separate, independent public repo** served over
GitHub Pages:

- **Repo:** https://github.com/michaelschecht/cronsole-registry
- **Local clone:** `D:\AI_Agents\Projects\Mikes_AI_Lab\Repos\Tools\cronsole-registry`
- **Served at:** `https://mikesailab.com/cronsole-registry` → set as `TEMPLATE_REGISTRY_URL`.

This folder is the source of truth; to ship a catalog change:

```bash
cd backend && npm run registry:build     # regenerate this folder
# commit registry/ in the cronsole repo, then mirror it to the public repo:
pwsh scripts/publish-registry.ps1         # copies index.json + templates/ -> the clone, pushes
```

GitHub Pages rebuilds on push (usually < 1 min); the backend picks up the change on
its next catalog fetch (cache TTL) or reseed. Serving `index.json` + `templates/`
over HTTPS with correct (LF) bytes is all that's required, so any static host works
as a drop-in replacement.

> [!NOTE]
> The publish script mirrors **only** `index.json` + `templates/` — it no longer
> copies this README. The public repo **owns its own front-page README** (a
> house-style page for outside readers); this file is the internal developer note.
> The two are meant to differ. (Index signing is the stronger integrity follow-up
> beyond the per-file checksums.)
