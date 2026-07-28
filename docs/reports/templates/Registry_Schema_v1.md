# TaskHub Template Registry — Schema v1 (draft for review)

> **Status:** Draft for Mike's review. No code has changed. This is step 1 of the
> [Template registry roadmap item](../../ROADMAP.md#-p2--product-value): the versioned,
> **target-agnostic JSON schema** every registry template conforms to, plus real examples
> from the current catalog compiled to the Windows target we already support.
>
> Decision record: [`docs/adr/0001-template-registry-schema.md`](../../adr/0001-template-registry-schema.md).
> Companion catalog spec (the existing tier-A/tier-B model): [`Templates.md`](./Templates.md).

---

## 1. Why this shape

A template is **not** a Windows job, a cron job, or a Claude routine. It describes an
automation abstractly along one model:

> **Trigger → Action → Execution Target**

TaskHub *compiles* that abstract description into a target's native config **at apply
time**, using the compilers it already has (`convertCronToWindowsTrigger`, the structured
`{executable, args[]}` ExecAction path). A target the registry *declares* but can't yet
*compile* renders as the honest "copy this to set up manually" path — the same honesty
pattern already shipped in the "Compatible with" work — so declaring `macos` costs nothing
and lies about nothing.

This is a direct evolution of today's `Template` model (`backend/prisma/schema.prisma`),
not a replacement of the concepts:

| Today (`Template` row) | Registry v1 field | Change |
|---|---|---|
| `commandTemplate` (string w/ `{{}}`) | `action` (structured, discriminated) | **Structured-first** — string form still accepted as shorthand |
| `scheduleExpression` (cron) | `trigger.cron` | Wrapped in a `trigger` object so non-cron kinds can exist later |
| `scriptType` enum | `runtime` | Renamed, lowercased; same values |
| `os` enum | `os` | Lowercased |
| `category` enum | `category` + `tags[]` | Adds free-form tags (the Developer-Pack "tags beyond one category" item) |
| `targetPlatforms[]` | `compatibleTargets[]` | Renamed to match the "Compatible with" honesty framing |
| `isStarter`, `icon`, `name`, `description` | same | unchanged |
| — | `core` | **New (2026-07-14).** Optional `boolean`; absent ⇒ extended. `core: true` = the curated set auto-synced into every install's DB by default (bundled + prune-managed); everything else is **extended** — in the registry/gallery, imported on demand. Only the *auto-sync* is limited; the full registry always contains both. See `catalogSync` prune-on-sync + CLAUDE.md § "Core vs. extended". |
| `upvotes` | — | dropped (already retired as fake) |

---

## 2. The template object

```jsonc
{
  "schemaVersion": "1.0",              // required — pins the reader/compiler contract
  "id": "powershell-script",           // required — stable kebab slug, unique in the registry
  "name": "PowerShell Script",         // required — display name
  "description": "Run a .ps1 PowerShell script file on a schedule.",
  "runtime": "powershell",             // powershell|batch|bash|zsh|python|node|applescript|vbscript|executable|http|ai-prompt
  "os": "windows",                     // windows|macos|linux|cross-platform
  "category": "other",                 // backup|cleanup|monitoring|dev-workflow|ai-agent|other (UI grouping; one primary)
  "tags": ["windows", "script"],       // free-form discovery tags (optional)
  "icon": "Terminal",                  // lucide icon name (optional)
  "isStarter": true,                   // true = curated Tier-A starter; false = use-case pattern

  "trigger": {                         // required — the WHEN
    "kind": "schedule",                // v1 compiles "schedule"; other kinds may be declared, not yet compiled
    "cron": "0 9 * * *"                // 5-field cron, always UTC (matches the domain convention)
  },

  "action": {                          // required — the WHAT (discriminated by "kind")
    "kind": "exec",                    // exec | http | prompt
    "program": "powershell.exe",
    "args": ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "{{scriptPath}}"]
  },

  "parameters": [                      // {{placeholder}} definitions (same shape as today)
    { "key": "scriptPath", "label": "Script file path", "type": "path",
      "required": true, "default": "", "help": "Absolute path to the .ps1 on the target machine." }
  ],

  "compatibleTargets": ["windows"],    // declared execution targets (honest: real only where a compiler exists)

  "execution": {                       // optional — settings the target applies where supported
    "runLevel": "limited",             // limited|highest  (Windows: Principal.RunLevel)
    "workingDir": "",                  // Windows: ExecAction working directory
    "timeoutSec": null,                // declared for future; not all targets honor it
    "retries": 0
  },

  "author": "taskhub",                 // optional provenance (for community submissions later)
  "version": "1.0.0"                   // optional per-template content version
}
```

### 2.1 `action` kinds

| `kind` | Fields | Compiles to | Real today? |
|---|---|---|---|
| `exec` | `program: string`, `args: string[]` | direct no-shell `ExecAction` (Windows), argv (POSIX) | ✅ Windows |
| `http` | `method`, `url`, `headers?`, `body?` | TaskHub-native HTTP job | ✅ TaskHub-native |
| `prompt` | `text: string` | natural-language routine (Claude/ChatGPT) | ❌ compiler pending → manual |

**`exec` is the canonical, secure form.** `program` + each `arg` map straight to the
structured `{executable, args[]}` action the agent registers with per-argument Windows
quoting — no shell, so a hostile parameter can at worst be a malformed arg to the
*intended* program (the P0 guarantee). A placeholder inside an `arg` is always exactly one
argument. Commands that genuinely need a shell name it explicitly (`"program": "cmd.exe"`,
`"args": ["/c", "…full shell line…"]`) — the shell line stays a single arg and the author
is visibly opting in.

**Authoring shorthand (accepted, compiled to `exec`):** a `commandTemplate` string is
still accepted and tokenized server-side via the existing `parseCommandTokens` →
`substituteStructuredCommand` path, so the whole current catalog imports unchanged. It's
documented as shorthand; the canonical stored/served form is structured `exec`.

### 2.2 `parameters`

Unchanged from today's shape (`backend/src/utils/templateCommand.ts`):

```jsonc
{ "key": "method", "label": "HTTP method", "type": "select",
  "options": ["GET", "POST"], "default": "GET", "required": true, "help": "HTTP verb." }
```

`type` ∈ `text | path | url | select | …`. Placeholders `{{key}}` appear in `action`
fields (and in the `commandTemplate` shorthand). Server-side validation is the existing
`resolveTemplateParams`: only declared keys, string values, required non-blank, `select` ∈
`options`.

### 2.3 `compatibleTargets` vocabulary

`windows` · `taskhub-native` · `macos` · `linux` · `claude-code` · `chatgpt`
(extensible). A target is **real** only when a compiler exists for it — `windows` and
`taskhub-native` today. Others are declared-but-manual: the UI shows them muted with the
honest "no agent or API yet — copy the command to set it up manually" note, exactly as the
Apply modal already gates `CREATABLE_PLATFORMS`.

---

## 3. The registry index

The app fetches one `index.json`, then individual template files on demand. The index
carries integrity hashes so a fetched template is verified before it's ever parsed as
executable content.

```jsonc
{
  "registryVersion": "1.0",
  "updatedAt": "2026-07-13T00:00:00Z",   // stamped by the publish step
  "templates": [
    {
      "id": "powershell-script",
      "name": "PowerShell Script",
      "description": "Run a .ps1 PowerShell script file on a schedule.",
      "category": "other",
      "tags": ["windows", "script"],
      "isStarter": true,
      "runtime": "powershell",
      "os": "windows",
      "compatibleTargets": ["windows"],
      "path": "templates/powershell-script.json",
      "sha256": "<hex digest of the template file>"
    }
  ]
}
```

The index holds enough metadata to render the whole Templates tab (search / filter / group)
**without** fetching every template file — the file is pulled only on Apply / detail.
`sha256` is verified against the fetched file; a mismatch = reject, fall back to the bundled
snapshot. (Signing the index is the stronger follow-up; checksum is the v1 integrity floor.)

### 3.1 Packs *(added 2026-07-28)*

A **pack** is a curated set of templates a user can import in one action. The index gained an
**optional** `packs` array, and the artifact gained a `packs/<id>.json` bundle per pack:

```jsonc
{
  "registryVersion": "1.0",
  "templates": [ /* … */ ],
  "packs": [
    {
      "id": "developer",                       // lowercase kebab; also the filename
      "name": "Developer Pack",
      "description": "Keep repos fresh and toolchains healthy…",
      "templateIds": ["dev-git-fetch-prune", "dev-npm-test-run", "…"],
      "path": "packs/developer.json",
      "sha256": "<hex digest of the bundle file>"
    }
  ]
}
```

Each bundle is **self-contained and directly importable** — the same shape
`POST /api/templates/import` already accepts, so downloading a pack is one file and one
import rather than N of each:

```jsonc
{
  "taskhubCatalogVersion": "1.0",
  "pack": { "id": "developer", "name": "Developer Pack", "description": "…" },
  "templates": [ /* full v1 template objects, in declared order */ ]
}
```

Four properties worth stating explicitly, because each is load-bearing:

- **`packs` is optional in both directions.** A registry published before packs existed has no
  `packs` key and still parses; an app built before packs existed parses a registry that has one,
  because `z.object()` strips unknown keys rather than rejecting them. The key rolled out with no
  coordinated release. When no packs are declared the key is **omitted entirely**, so a
  pre-packs registry stays byte-identical.
- **Membership is declared, never derived.** Packs list `templateIds` explicitly
  (`backend/src/catalog/packs.ts`). The gallery previously inferred collections from tags
  (`tags.includes('dev')`), which meant tagging an unrelated template silently changed what a
  collection contained — tolerable for a filtered view, not for a file that lands in someone's
  catalog. `buildRegistry` **throws** on an unknown or duplicated id, so the failure moves from
  silent drift to a broken build.
- **Bundles carry no timestamp.** Registry files are content-addressed by sha256 over exact
  bytes; a clock inside the payload would change the hash every build and make the drift test
  meaningless. (`updatedAt` stays in the index, which is not itself hashed.)
- **Packs may overlap, and every template should be in at least one.** Overlap is legitimate
  (`dev-docker-prune` is both a developer tool and a cleanup job). A template in *no* pack is
  unreachable by browsing collections and makes "download every pack" quietly less than the
  catalog — a test asserts full coverage.

Presentation (icons, colors) stays in the gallery, keyed by pack id with a default, so adding a
pack to the registry needs no site change.

---

## 4. Real examples, compiled

Each example shows the registry JSON (source of truth) → what TaskHub compiles it into for
each target. All four are current catalog entries re-expressed in v1.

### 4.1 PowerShell Script (starter · Windows `exec`)

**Registry JSON**
```json
{
  "schemaVersion": "1.0",
  "id": "powershell-script",
  "name": "PowerShell Script",
  "description": "Run a .ps1 PowerShell script file on a schedule.",
  "runtime": "powershell",
  "os": "windows",
  "category": "other",
  "tags": ["windows", "script"],
  "icon": "Terminal",
  "isStarter": true,
  "trigger": { "kind": "schedule", "cron": "0 9 * * *" },
  "action": {
    "kind": "exec",
    "program": "powershell.exe",
    "args": ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "{{scriptPath}}"]
  },
  "parameters": [
    { "key": "scriptPath", "label": "Script file path", "type": "path",
      "required": true, "default": "", "help": "Absolute path to the .ps1 on the target machine." }
  ],
  "compatibleTargets": ["windows"],
  "execution": { "runLevel": "limited" }
}
```

**Compiled → Windows Task Scheduler** with `scriptPath = C:\Scripts\Nightly Report.ps1`:

- **Trigger** (`convertCronToWindowsTrigger("0 9 * * *")`, confidence 1.0):
  `Daily`, `startBoundary "09:00"`, `daysInterval 1`.
- **Action** (no-shell `ExecAction`, per-arg `CommandLineToArgvW` quoting):
  - executable: `powershell.exe`
  - argument line: `-NoProfile -ExecutionPolicy Bypass -File "C:\Scripts\Nightly Report.ps1"`
    *(the space-bearing path is one quoted argument — it can never split into a second command)*
- **Settings:** `Principal.RunLevel = Limited`.
- HMAC covers executable + args + canonical trigger (unchanged signing path).

### 4.2 Daily Database Backup (pattern · Windows `exec` via explicit shell)

Shows the escape hatch: redirection needs a shell, so `cmd.exe` is named and the whole
pipeline is one argument.

**Registry JSON (action + trigger only)**
```json
{
  "trigger": { "kind": "schedule", "cron": "0 3 * * *" },
  "action": {
    "kind": "exec",
    "program": "cmd.exe",
    "args": ["/c", "pg_dump -U {{dbUser}} {{dbName}} > {{backupPath}}"]
  },
  "compatibleTargets": ["windows"]
}
```

**Compiled → Windows** with `dbUser=postgres`, `dbName=app`, `backupPath=C:\backups\db.sql`:
- executable `cmd.exe`, args: `["/c", "pg_dump -U postgres app > C:\\backups\\db.sql"]`.
- The placeholders substitute *inside* the single `/c` argument — the pipeline is intact
  and the author's shell opt-in is explicit and visible in the JSON.

### 4.3 Morning News Digest (pattern · AI `prompt` · no compiler yet)

**Registry JSON**
```json
{
  "schemaVersion": "1.0",
  "id": "morning-news-digest",
  "name": "Morning News Digest",
  "runtime": "ai-prompt",
  "os": "cross-platform",
  "category": "ai-agent",
  "trigger": { "kind": "schedule", "cron": "0 7 * * *" },
  "action": { "kind": "prompt", "text": "Summarize the top stories from {{feeds}} into a {{length}} digest." },
  "parameters": [
    { "key": "feeds", "label": "News sources / feeds", "type": "text", "required": true },
    { "key": "length", "label": "Digest length", "type": "select", "options": ["short", "detailed"], "default": "short", "required": true }
  ],
  "compatibleTargets": ["claude-code", "chatgpt"]
}
```

**Compiled →** neither `claude-code` nor `chatgpt` has a create-compiler today, so the Apply
modal shows the resolved prompt with the honest "no agent or API yet — copy to set up
manually" note and a disabled Create button. Nothing fabricated; the template is fully valid
and becomes one-click the day a connector lands.

### 4.4 Webhook / HTTP Ping (starter · TaskHub-native `http`)

Same intent as the current Windows `Invoke-WebRequest` starter, expressed as a native HTTP
job so it needs no agent at all.

**Registry JSON (action)**
```json
{
  "trigger": { "kind": "schedule", "cron": "*/15 * * * *" },
  "action": { "kind": "http", "method": "{{method}}", "url": "{{url}}" },
  "parameters": [
    { "key": "method", "label": "HTTP method", "type": "select", "options": ["GET", "POST"], "default": "GET", "required": true },
    { "key": "url", "label": "URL", "type": "url", "required": true }
  ],
  "compatibleTargets": ["taskhub-native", "windows"]
}
```

**Compiled → TaskHub-native:** an HTTP job (`method`, `url`) on cron `*/15 * * * *`, run by
the backend scheduler — no agent required. **Compiled → Windows:** the same intent compiles
to a `powershell.exe -Command "Invoke-WebRequest …"` `exec` action (runtime-specific
lowering), so one template serves both targets.

---

## 5. Formal JSON Schema (draft 2020-12)

For validation on import and in CI. Abbreviated to the required spine; enums list the v1
vocabulary.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://taskhub/registry/template-v1.json",
  "type": "object",
  "required": ["schemaVersion", "id", "name", "trigger", "action", "compatibleTargets"],
  "additionalProperties": false,
  "properties": {
    "schemaVersion": { "const": "1.0" },
    "id": { "type": "string", "pattern": "^[a-z0-9]+(-[a-z0-9]+)*$" },
    "name": { "type": "string", "minLength": 1 },
    "description": { "type": "string" },
    "runtime": { "enum": ["powershell","batch","bash","zsh","python","node","applescript","vbscript","executable","http","ai-prompt"] },
    "os": { "enum": ["windows","macos","linux","cross-platform"] },
    "category": { "enum": ["backup","cleanup","monitoring","dev-workflow","ai-agent","other"] },
    "tags": { "type": "array", "items": { "type": "string" } },
    "icon": { "type": "string" },
    "isStarter": { "type": "boolean" },
    "core": { "type": "boolean" },
    "trigger": {
      "type": "object",
      "required": ["kind"],
      "properties": {
        "kind": { "enum": ["schedule"] },
        "cron": { "type": "string" }
      },
      "allOf": [
        { "if": { "properties": { "kind": { "const": "schedule" } } },
          "then": { "required": ["cron"] } }
      ]
    },
    "action": {
      "type": "object",
      "required": ["kind"],
      "oneOf": [
        { "properties": { "kind": { "const": "exec" }, "program": { "type": "string" },
            "args": { "type": "array", "items": { "type": "string" } } },
          "required": ["kind", "program"] },
        { "properties": { "kind": { "const": "http" }, "method": { "type": "string" },
            "url": { "type": "string" }, "headers": { "type": "object" }, "body": { "type": "string" } },
          "required": ["kind", "url"] },
        { "properties": { "kind": { "const": "prompt" }, "text": { "type": "string" } },
          "required": ["kind", "text"] }
      ]
    },
    "parameters": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["key"],
        "properties": {
          "key": { "type": "string", "pattern": "^\\w+$" },
          "label": { "type": "string" },
          "type": { "type": "string" },
          "default": { "type": "string" },
          "required": { "type": "boolean" },
          "options": { "type": "array", "items": { "type": "string" } },
          "help": { "type": "string" }
        }
      }
    },
    "compatibleTargets": {
      "type": "array", "minItems": 1,
      "items": { "enum": ["windows","taskhub-native","macos","linux","claude-code","chatgpt"] }
    },
    "execution": {
      "type": "object",
      "properties": {
        "runLevel": { "enum": ["limited","highest"] },
        "workingDir": { "type": "string" },
        "timeoutSec": { "type": ["integer","null"] },
        "retries": { "type": "integer", "minimum": 0 }
      }
    },
    "author": { "type": "string" },
    "version": { "type": "string" }
  }
}
```

*(Note: `commandTemplate` shorthand isn't in the strict schema above — it's an authoring
convenience normalized to `action.exec` on import, so the canonical, validated, stored form
is always structured.)*

---

## 6. Compilation contract (per target)

| Target | Trigger | Action | Settings | Status |
|---|---|---|---|---|
| `windows` | `cron → WindowsTrigger` (`convertCronToWindowsTrigger`) | `exec → ExecAction` (per-arg quoting); `http`→PS `Invoke-WebRequest` exec; `prompt`→n/a | `runLevel`, `workingDir` | ✅ exists |
| `taskhub-native` | `cron` stored UTC | `http → native HTTP job`; `exec`→n/a | timeout/retries (partial) | ✅ exists |
| `macos` | `cron → launchd StartCalendarInterval` | `exec → argv` / plist | — | ❌ compiler pending (honest manual) |
| `claude-code` / `chatgpt` | `cron` (routine cadence) | `prompt → routine text` | — | ❌ compiler pending (honest manual) |

A missing compiler is never a silent failure — it's the declared-but-manual path.

---

## 7. Resolved decisions (Mike, 2026-07-13 — all as recommended)

1. **`commandTemplate` shorthand — kept.** Accepted as authoring shorthand and normalized to
   the structured `exec` form on import, so the current catalog imports with zero friction; the
   canonical stored/served form is structured. *(The bundled snapshot in step 2 keeps the exact
   current `commandTemplate` strings — the quote-around-`{{placeholder}}` signal the tokenizer
   relies on must survive byte-for-byte, so shorthand is passed through unchanged there.)*
2. **Vocabulary casing — lowercase-kebab in the registry, mapped at the import boundary.**
   Registry uses `dev-workflow` / `ai-prompt`; a small lookup table maps to the UPPER Prisma
   enums (`DEV_WORKFLOW`, `AI_PROMPT`). No DB migration.
3. **Hosting at launch — static registry first.** `index.json` + files in a separate git repo
   (versioned, free, PR-reviewable), DB-backed API later behind the same fetch contract.
4. **`tags[]` alongside the single `category` — yes.** `category` stays the primary
   chip/lane grouping; `tags[]` carries the Developer-Pack / AI-pack facets (`git`, `ci`,
   `claude-code`, `codex`) without overloading `TemplateCategory`.

> **Note on existing IDs:** the bundled snapshot keeps the current `tpl_*` template IDs
> (e.g. `tpl_starter_powershell_script`) rather than reslugging to kebab, so the DB upsert
> updates the same rows and existing `TemplateFavorite` FKs are never orphaned. The strict
> kebab `id` pattern in §5 applies to *new* registry templates; the code validator is relaxed
> to accept the legacy `tpl_*` form.

---

## 8. Implementation status

- **Step 1 — schema + ADR** (this doc): ✅ done.
- **Step 2 — catalog behind an interface** (2026-07-13): ✅ done. `backend/src/catalog/`
  holds the v1 Zod schema, the bundled snapshot (all 24 templates), a lowercase-kebab →
  Prisma-enum normalizer, and a `TemplateCatalogSource` interface with `BundledCatalogSource`.
  `seed.ts` is now just the materializer. No behavior change — DB content byte-for-byte identical.
- **Step 3 — static registry + remote source** (2026-07-13): ✅ done. `npm run registry:build`
  emits `registry/index.json` + `registry/templates/*.json` with per-file `sha256`;
  `RegistryCatalogSource` fetches + integrity-checks + caches, falling back to the bundled
  snapshot on any failure. Wired via `TEMPLATE_REGISTRY_URL` (unset = bundled). A drift test
  keeps the committed artifact in sync with the snapshot.
- **Step 4 — hosting + runtime refresh** (2026-07-13): ✅ done. The artifact is mirrored to the
  public repo `michaelschecht/taskhub-registry` (GitHub Pages → `https://mikesailab.com/taskhub-registry`,
  set as `TEMPLATE_REGISTRY_URL`) via `scripts/publish-registry.ps1`; the backend syncs the catalog
  into the DB on boot + on an interval (`catalog/catalogSync.ts`), so registry changes land with no
  reseed. Verified live end-to-end.
- **First content pack — Developer Pack** (2026-07-13): 9 dev-workflow templates added to the
  bundled snapshot + published registry (24 → 33 templates), the first entries using the
  plain-kebab id form (`dev-*`) and the free-form tags. A whole-catalog resolvability test now
  guards every bundled `commandTemplate` through the Apply substitution pipeline.
- **Second content pack — AI Pack (Claude Code)** (2026-07-13): 4 `ai-agent` templates that run
  the Claude Code CLI unattended as real, creatable Windows tasks (`ai-claude-headless-run`,
  `-repo-digest`, `-autofix-commit`, `-log-cleanup`), bringing the catalog 33 → **37**
  templates (published to the hosted registry). Headless print mode (`claude -p`) fenced
  by `--permission-mode dontAsk` + a user-scoped `--allowedTools` allowlist + `--bare`, output
  captured through a PowerShell `-Command` wrapper (single-quoted inner args). Clears the roadmap's
  "safe non-interactive execution path" gate for Claude Code; the **Codex** slice shipped later the same day.
- **Third content pack — AI Pack (Codex)** (2026-07-13): 3 `ai-agent` templates that run
  the Codex CLI unattended as real, creatable Windows tasks (`ai-codex-headless-run`,
  `-repo-digest`, `-autofix-workspace`), bringing the catalog 37 → **40** templates.
  Non-interactive mode (`codex exec`) is fenced by `--ask-for-approval never`, an explicit
  `--sandbox` (`read-only` by default, `workspace-write` only for the higher-trust autofix
  template), `--ephemeral`, final-message capture via `-o`, and full log capture through a
  PowerShell `-Command` wrapper (single-quoted inner args). Clears the roadmap's Codex slice.
- **Optional follow-ups** — index signing (beyond per-file checksums) and prune-on-sync (removed
  templates aren't deleted yet). Exactly one real compiler (Windows) stays real; everything else is
  declared-but-manual.
