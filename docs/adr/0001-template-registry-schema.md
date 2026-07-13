# ADR 0001 — Template registry: a target-agnostic JSON schema, served from a decoupled registry

- **Status:** Accepted (2026-07-13)
- **Deciders:** Mike
- **Related:** [ROADMAP › Template registry](../ROADMAP.md#-p2--product-value) · schema spec [`reports/templates/Registry_Schema_v1.md`](../reports/templates/Registry_Schema_v1.md) · existing catalog spec [`reports/templates/Templates.md`](../reports/templates/Templates.md)

## Context

The template catalog is fast-moving **content**; the TaskHub app is stable **code**. Today
the catalog is baked into `backend/src/seed.ts` and materialized by a Postgres reseed, so
every catalog change is a code change + migration/reseed — friction that grows as the catalog
grows toward the hundreds of templates sketched in the 2026-07-13 strategy pass (now the
*Template & scheduler catalog* appendix in the roadmap).

Two coupled questions had to be answered before writing any of it:

1. **Format** — how is a single template described so it can target Windows, cron, launchd,
   Claude, etc.?
2. **Distribution** — where do templates live so the catalog updates without shipping the app?

An early idea was "make every template an XML file, with parameters inside it deciding whether
it's a Windows job or a cron job." That was explored and rejected (see Alternatives).

## Decision

**1. Format — a versioned, target-agnostic JSON schema on the Trigger → Action → Execution
Target model.** A template describes the automation abstractly; TaskHub *compiles* it to a
target's native config at apply time. Details and examples in the schema spec; the spine:

- `schemaVersion`, stable `id`, `name`/`description`, `runtime`, `os`, `category` + `tags[]`.
- `trigger` (`{ kind: "schedule", cron }` in v1 — a `kind` discriminator leaves room for
  event/manual triggers later).
- `action`, discriminated: `exec` (`{program, args[]}` — the secure, canonical, no-shell form
  that maps straight to the existing structured `ExecAction`), `http` (native HTTP job),
  `prompt` (natural language for AI targets).
- `parameters` — the current `{key,label,type,default,required,options,help}` shape, unchanged.
- `compatibleTargets[]` — declared execution targets, honest: **real only where a compiler
  exists** (`windows`, `taskhub-native` today); others render as "copy to set up manually."
- `execution` — `runLevel`/`workingDir` (real on Windows now), `timeoutSec`/`retries` (declared
  for future).

The current `commandTemplate` string is kept as an **authoring shorthand**, normalized to
structured `exec` on import via the existing tokenizer, so the whole current catalog imports
unchanged while the canonical stored/served form is structured.

**2. Distribution — a decoupled registry the app fetches at runtime, static-first.** MVP is a
separate content source: an `index.json` (rich enough to render the Templates tab) plus
`templates/*.json`, served as static files, with per-template `sha256` integrity in the index.
The app fetches + caches the index and **falls back to a bundled snapshot** so first-run/offline
works. A DB-backed API + admin/submission UI is a later upgrade behind the *same* fetch
contract (this is the one open ROADMAP decision; the schema is identical either way).

**3. Compile discipline stays inside the reliability guardrail.** The abstract *catalog* scales
freely; *execution targets* unlock only when their compiler is reliable. Exactly one real
compiler ships first (Windows, which already exists); everything else is declared-but-manual.

## Alternatives considered

- **XML per template (the original prompt).** Rejected. XML is the native format of *one*
  target (Windows Task Scheduler) — choosing it as the *source* format optimizes for one
  output and fights every other (cron, systemd, GitHub Actions, k8s, REST are all JSON/YAML).
  It also contradicts the model: a template shouldn't *be* a Windows-or-cron job; the target is
  chosen at apply time. XML remains only a *compile output* the agent already generates from a
  structured `TaskDefinition`. The whole stack (Zod, Prisma `Json`, existing payloads) is JSON.
- **Keep templates seeded in the repo.** Rejected as the long-term home — it's the exact
  code-change-per-content-change friction this ADR removes. (The seeded set survives as the
  bundled fallback snapshot.)
- **Store `action` as a command string only.** Rejected as canonical — a re-tokenized string is
  the ambiguity the P0 structured-command work removed. Structured `exec` is canonical; the
  string lives on only as normalized-away shorthand.
- **DB-backed dynamic registry from day one.** Deferred, not rejected — heavier, and unneeded
  until non-git editing or community submissions are wanted. Same schema when it lands.

## Consequences

**Positive**
- Catalog grows by pushing to a content repo — no app change, no reseed.
- Unblocks the dependent roadmap items on one schema: import/export + agent authoring,
  save-as-template, Developer-Pack and AI/CLI packs, and it makes "cosmetic cross-platform
  targets" *real* (a `compatibleTargets` entry compiles or honestly says manual).
- Security posture is preserved and made explicit: fetched templates are untrusted, executable
  content — schema-validated exactly like user input, integrity-checked, never shell-wrapped;
  the structured `exec` action keeps a hostile parameter to a malformed arg to the intended exe.
- Agents can author to a documented schema (feeds the future MCP `create_task_from_template`).

**Costs / risks**
- A remote catalog of executable content is a supply-chain surface. Mitigated by: `sha256` in
  the index (signing as the stronger follow-up), schema validation on fetch, the no-shell exec
  model, and bundled-fallback + reject-on-mismatch.
- A registry ↔ Prisma casing/enum mapping (lowercase-kebab vs UPPER enums) is needed at the
  import boundary — a small lookup table, no DB migration.
- Two representations during transition (seeded fallback + fetched registry) until the seed set
  is fully migrated to registry files.

## Follow-ups (post-approval, in order)

1. Resolve the four open questions in the schema spec §7 (shorthand, casing, hosting, tags).
2. **Step 2:** refactor the app to load templates from a catalog source behind an interface,
   seeded set as bundled fallback (no behavior change).
3. Stand up the static registry (`index.json` + files, checksums) and point the app at it
   (cache + fallback).
4. Keep exactly one real compiler (Windows); add others only as their connectors prove reliable.
