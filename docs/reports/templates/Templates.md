# TaskHub — Template Catalog & Design

> Living spec for the **Template** feature. Templates are how a user creates a new scheduled
> task by clicking a button instead of hand-writing a command + cron + trigger. This doc is the
> source of truth for *which* templates we ship and *what shape* a template has.
>
> **Status:** Catalog drafted + schema migrated + starters seeded (2026-06-10); Apply modal + library UI shipped.
> The new `Template` fields (§2) shipped in migration `20260610000000_add_template_catalog_fields`,
> and all 20 Tier A starters + 4 backfilled patterns are in `backend/src/seed.ts` (24 rows total,
> verified seeded). The **Apply modal** that substitutes `{{placeholders}}` (§7 step 3) shipped, backed by
> `GET /api/templates` + `POST /api/templates/:id/apply`. The **library UI** (2026-07-08) adds search,
> faceted OS + Tags(category) filters, a Starter/Pattern type toggle, and starter-vs-pattern grouping.
> Still open (see `docs/ROADMAP.md`): parameterize the 4 Tier-B patterns; real-vs-removed upvotes; template import/export.

---

## 1. Why templates matter

Templates are the most leveraged surface in TaskHub. A scheduled task is really just three
things — **a runtime**, **a command/script**, and **a schedule**. Most users don't want to
remember PowerShell syntax *and* cron syntax *and* the Windows trigger XML at the same time.
A template collapses all of that into: *pick one → fill a couple of blanks → click Apply.*

We support two complementary tiers in one library:

| Tier | Answers | Example | Who authors it |
|---|---|---|---|
| **A. Script Starters** | "How does this run?" | *PowerShell Script*, *Python Script (cross-platform)* | Shipped by TaskHub (curated) |
| **B. Use-Case Patterns** | "What does this do?" | *Daily Database Backup*, *Morning News Digest* | Shipped + community (`isPublic`, `upvotes`) |

Tier B already exists (see `backend/src/seed.ts`). This doc adds **Tier A** and the metadata
needed to host both cleanly.

---

## 2. Proposed schema additions

The current `Template` model (`backend/prisma/schema.prisma`) has: `name`, `description`,
`sourcePlatform`, `targetPlatforms[]`, `scheduleExpression`, `command`, `isPublic`, `upvotes`.

To support script starters and a richer "fill in the blank" Apply flow, add:

```prisma
model Template {
  // ... existing fields ...

  scriptType      ScriptType   @default(AI_PROMPT)   // runtime this template targets
  os              OsTarget     @default(CROSS_PLATFORM)
  category        TemplateCategory @default(OTHER)   // for filtering/grouping in the UI
  commandTemplate String?      @db.Text              // command with {{placeholders}}
  parameters      Json?        // [{ key, label, default, required, help }] — see §5
  isStarter       Boolean      @default(false)       // true = Tier A curated starter
  icon            String?      // lucide icon name for the card
}

enum ScriptType {
  POWERSHELL      // .ps1   — Windows (and PS Core on macOS/Linux)
  BATCH           // .bat/.cmd — Windows only
  BASH            // .sh    — macOS/Linux
  ZSH             // .sh    — macOS default shell
  PYTHON          // python / python3
  NODE            // node
  APPLESCRIPT     // osascript — macOS only
  VBSCRIPT        // cscript — Windows legacy
  EXECUTABLE      // run an .exe / binary directly
  HTTP            // curl / Invoke-WebRequest — a scheduled webhook call
  AI_PROMPT       // Claude Code routine / ChatGPT automation (natural-language)
}

enum OsTarget {
  WINDOWS
  MACOS
  LINUX
  CROSS_PLATFORM
}

enum TemplateCategory {
  BACKUP
  CLEANUP
  MONITORING
  DEV_WORKFLOW
  DATA_SYNC
  AI_AGENT
  NOTIFICATION
  MEDIA
  SYSTEM
  OTHER
}
```

> `command` stays for backward-compat (the resolved, ready-to-run string). `commandTemplate`
> holds the un-filled version with `{{placeholders}}`; the Apply flow substitutes parameters
> into it to produce the final `command` sent to the connector.

---

## 3. Script-Starter catalog (Tier A)

Each starter ships with a sensible default schedule and a `commandTemplate` containing
placeholders. The user picks a starter, fills the blanks, picks a schedule (or accepts the
default), and Applies. Default schedules are shown as **5-field cron in UTC** (per the
project convention — display is localized).

### 3.1 Windows

| # | Template | `scriptType` | Default cron | `commandTemplate` (starter) |
|---|---|---|---|---|
| 1 | **PowerShell Script** | `POWERSHELL` | `0 9 * * *` | `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "{{scriptPath}}"` |
| 2 | **PowerShell Inline Command** | `POWERSHELL` | `0 * * * *` | `powershell.exe -NoProfile -Command "{{command}}"` |
| 3 | **Batch / CMD Script** | `BATCH` | `0 0 * * *` | `cmd.exe /c "{{scriptPath}}"` |
| 4 | **Python Script (Windows)** | `PYTHON` | `0 8 * * *` | `python "{{scriptPath}}" {{args}}` |
| 5 | **Node.js Script (Windows)** | `NODE` | `*/30 * * * *` | `node "{{scriptPath}}" {{args}}` |
| 6 | **Run a Program / .exe** | `EXECUTABLE` | `0 7 * * 1` | `"{{exePath}}" {{args}}` |
| 7 | **Webhook / HTTP Ping** | `HTTP` | `*/15 * * * *` | `powershell.exe -Command "Invoke-WebRequest -Uri '{{url}}' -Method {{method}}"` |
| 8 | **VBScript (legacy)** | `VBSCRIPT` | `0 6 * * *` | `cscript //nologo "{{scriptPath}}"` |

### 3.2 macOS

| # | Template | `scriptType` | Default cron | `commandTemplate` (starter) |
|---|---|---|---|---|
| 9 | **Shell Script (zsh)** | `ZSH` | `0 9 * * *` | `/bin/zsh "{{scriptPath}}" {{args}}` |
| 10 | **Shell Script (bash)** | `BASH` | `0 9 * * *` | `/bin/bash "{{scriptPath}}" {{args}}` |
| 11 | **Python Script (macOS)** | `PYTHON` | `0 8 * * *` | `python3 "{{scriptPath}}" {{args}}` |
| 12 | **Node.js Script (macOS)** | `NODE` | `*/30 * * * *` | `node "{{scriptPath}}" {{args}}` |
| 13 | **AppleScript** | `APPLESCRIPT` | `0 18 * * *` | `osascript "{{scriptPath}}"` |
| 14 | **Inline Shell Command** | `ZSH` | `0 * * * *` | `/bin/zsh -c "{{command}}"` |
| 15 | **Webhook / HTTP Ping** | `HTTP` | `*/15 * * * *` | `curl -fsS -X {{method}} "{{url}}"` |

> macOS scheduling is delivered via `launchd` / `cron` by a future macOS agent (not yet built —
> the current agent is Windows-only). Until then, macOS starters are **catalog + copyable
> command** only. Tracked in §7.

### 3.3 Cross-platform / platform-native

| # | Template | `scriptType` | Default cron | Notes |
|---|---|---|---|---|
| 16 | **Python Script (cross-platform)** | `PYTHON` | `0 8 * * *` | Resolves to `python` on Win, `python3` on macOS at apply-time. |
| 17 | **Node.js Script (cross-platform)** | `NODE` | `0 8 * * *` | Same `node` invocation everywhere. |
| 18 | **Git Pull / Repo Sync** | `BASH`/`POWERSHELL` | `0 */6 * * *` | `git -C "{{repoPath}}" pull` — OS-resolved shell wrapper. |
| 19 | **Claude Code Routine** | `AI_PROMPT` | `0 7 * * *` | Natural-language prompt; runs via Claude connector, not a shell. |
| 20 | **ChatGPT Automation (link)** | `AI_PROMPT` | n/a | Quick-link only — no public API; opens native UI. |

---

## 4. Use-Case Pattern catalog (Tier B)

These are the higher-level, "what does it do" templates. The four already seeded stay; this is
the target set to grow toward (community-contributed ones land here too via `isPublic`).

| Template | Category | Built on starter | Default cron |
|---|---|---|---|
| Daily Database Backup *(seeded)* | `BACKUP` | PowerShell / Bash | `0 3 * * *` |
| Weekly System Cleanup *(seeded)* | `CLEANUP` | Batch / Bash | `0 0 * * 0` |
| Morning News Digest *(seeded)* | `AI_AGENT` | Claude Routine | `0 7 * * *` |
| GitHub PR Triage *(seeded)* | `DEV_WORKFLOW` | Claude Routine | `*/30 * * * *` |
| Disk Space Alert | `MONITORING` | PowerShell + HTTP | `0 */4 * * *` |
| Log Rotation / Archive | `CLEANUP` | Bash | `0 1 * * *` |
| Folder → Cloud Sync | `DATA_SYNC` | PowerShell / rsync | `*/30 * * * *` |
| Certificate Expiry Check | `MONITORING` | PowerShell | `0 6 * * 1` |
| Nightly Build & Test | `DEV_WORKFLOW` | Node / Python | `0 2 * * *` |
| Screenshot / Site Snapshot | `MEDIA` | Node (Playwright) | `0 12 * * *` |

---

## 5. Parameter / placeholder convention

`parameters` is a JSON array describing each `{{placeholder}}` in `commandTemplate`. The Apply
modal renders one input per entry; the resolved string becomes the task's `command`.

```jsonc
[
  {
    "key": "scriptPath",          // matches {{scriptPath}} in commandTemplate
    "label": "Script file path",
    "type": "path",               // text | path | url | number | select | enum
    "default": "",
    "required": true,
    "help": "Absolute path to the .ps1 file on the target machine."
  },
  {
    "key": "method",
    "label": "HTTP method",
    "type": "select",
    "options": ["GET", "POST"],
    "default": "GET",
    "required": true
  }
]
```

Rules:
- Substitution is literal `{{key}}` → value. Unfilled **required** params block Apply.
- Values are shell-escaped per target OS at apply-time (never string-concatenated raw).
- `scriptPath` / `exePath` / `repoPath` refer to paths **on the user's machine**, validated by
  the agent before the task is registered.

---

## 6. How a template applies per platform

The Apply flow (`POST /api/templates/:id/apply { platform }`) resolves the template to a concrete
task and hands it to the matching `PlatformConnector.createTask()`:

| `targetPlatform` | What gets created | Connector |
|---|---|---|
| `WINDOWS_TASK_SCHEDULER` | A real Task Scheduler entry (action = resolved `command`, trigger = cron→Windows trigger) | `WindowsAgentConnector` (via WebSocket to the .NET agent) |
| `CLAUDE_CODE` | A Claude Code routine (prompt = `command`, schedule = cron) | Claude connector *(scaffold)* |
| `CHATGPT` / `JULES` | Quick-link only — opens native UI | none (link) |
| macOS (future) | `launchd`/cron job via macOS agent | *not built — §7* |

**Cron → trigger conversion** is the bridge layer: the stored 5-field UTC cron is translated to
a Windows Task Scheduler trigger on apply, and rendered back to cron for display. This is the
"conversion confidence score" item from the original project plan (archived locally under `docs/archive/`).

---

## 7. Build order / next steps

1. ~~**Schema migration**~~ ✅ *Done* — `scriptType`, `os`, `category`, `commandTemplate`,
   `parameters`, `isStarter`, `icon` added (migration `20260610000000_add_template_catalog_fields`).
   Also added `MACOS_LAUNCHD` to `PlatformType` for the future macOS agent. 4 patterns backfilled.
2. ~~**Seed the Tier A starters**~~ ✅ *Done* — all 20 §3 starters seeded with `isStarter: true`
   in `backend/src/seed.ts` (24 rows total).
3. ~~**Wire the dead "Apply Template" button**~~ ✅ *Done* — `ApplyTemplateModal` in
   `Dashboard.tsx` renders `parameters`, lets the user pick the target platform + confirm the
   cron schedule, live-substitutes `{{placeholders}}` into a previewed command, and
   `POST`s `{ platform, command, scheduleExpression, name }` to `/templates/:id/apply`
   (which now accepts those overrides and rejects unfilled placeholders). Invalidates `tasks`
   on success. Demo mode simulates the apply.
4. **Card UI** — `scriptType` badge is shown; still to add: `os` badge, `category` filter chips,
   and grouping starters vs patterns. Reuse the existing dark card style.
5. ~~**Cron ↔ Windows trigger conversion** with confidence score~~ ✅ *Done (2026-07-07)* —
   `POST /templates/:id/apply` now converts the cron via `convertCronToWindowsTrigger` and sends a
   structured `trigger` object in the `task:create` payload; the agent's `TriggerBuilder` registers
   real Daily/Weekly/interval triggers (UTC→local) instead of the old two-case cron parser.
   A new `POST /templates/:id/preview` endpoint returns `{ score, warnings, trigger }`
   (`getTemplateConfidence` + conversion), and the Apply modal shows the warnings live
   (debounced) under the schedule field. Interval schedules are registered as daily triggers
   with repetition so they recur past the first 24h window. The apply route also now accepts
   the modal's `schedule` body key (previously only `scheduleExpression`, so user edits to the
   cron were silently ignored) and rejects non-5-field crons.
6. **macOS agent** — unblocks templates #9–15 as real tasks (currently catalog-only).
7. **Community submission** — UI to save a configured task back as an `isPublic` Tier B template.

### Out of scope for now
- Two-way edit of a live task back into its template.
- MCP-driven template creation (Phase 6 — `create_task` / `convert_schedule` tools).
- ChatGPT API automation (quick-links only until a public API exists).

---

*Cross-references: `Project_Plan.md` and `Phase3.md` (archived locally under `docs/archive/`) ·
schema at `backend/prisma/schema.prisma` · seed at `backend/src/seed.ts` ·
UI at `frontend/src/Dashboard.tsx` (`TemplatesScreen`).*
