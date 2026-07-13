# TaskHub Template Registry (static artifact)

This directory is the **static template registry** — the decoupled catalog the
TaskHub backend can fetch at runtime instead of reading its compiled-in snapshot.
It's generated from the bundled catalog; **don't hand-edit it.**

```
registry/
├── index.json              # one lightweight entry per template + sha256 integrity
└── templates/
    └── <id>.json           # one Registry v1 template per file
```

- **Schema:** `docs/reports/templates/Registry_Schema_v1.md` (template shape) and the
  `index.json` shape (`registryVersion`, `updatedAt`, `templates[]` with `path` + `sha256`).
- **Decision record:** `docs/adr/0001-template-registry-schema.md`.

## How it's used

Set `TEMPLATE_REGISTRY_URL` on the backend to the URL this directory is served
from. `RegistryCatalogSource` then:

1. fetches `index.json`,
2. fetches each `templates/<id>.json`,
3. **verifies each file's bytes against the index `sha256`** (a mismatch aborts the
   whole fetch — no partial/unverified seeding),
4. validates each against the v1 schema, caches the result, and
5. **falls back to the compiled-in bundled snapshot** on any failure (offline,
   404, bad checksum), so the app always has a working catalog.

Unset `TEMPLATE_REGISTRY_URL` = use the bundled snapshot directly.

## Regenerating

The registry is generated from `backend/src/catalog/bundled.ts`. After editing the
catalog, regenerate:

```bash
cd backend
npm run registry:build              # writes ../registry
# or pin the stamp for a reproducible publish:
REGISTRY_UPDATED_AT="2026-07-13T00:00:00Z" npm run registry:build
```

A drift test (`backend/src/catalog/registry.test.ts`) fails if this committed
artifact is out of sync with the bundled snapshot, so a catalog edit that forgets
`registry:build` is caught in CI.

> **Line endings:** files here are pinned to LF (`.gitattributes`) because each
> `sha256` is computed over exact bytes — a CRLF rewrite would break every checksum.

## Publishing (future)

This folder is self-contained and host-agnostic: copy it to any static host
(GitHub Pages, a CDN, the VPS) or split it into its own content repo, then point
`TEMPLATE_REGISTRY_URL` at it. Serving `index.json` + `templates/` over HTTPS with
correct bytes is all that's required. (Index signing is the stronger integrity
follow-up beyond per-file checksums.)
