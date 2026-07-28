---
name: taskhub
description: 'Expert knowledge of TaskHub, the unified scheduled-task management system — its architecture, the Windows .NET agent protocol, the template registry/catalog, the MCP server, the testing layers, and the traps that waste hours. Use when working anywhere in the TaskHub repo — adding or debugging templates, touching the agent WebSocket protocol or Windows Task Scheduler integration, editing the catalog (bundled.ts, registry/, catalogSync, normalize.ts), creating or managing scheduled tasks through TaskHub, changing the MCP server or its tools (mcp-server/, list_tasks, run_task, create_task, create_native_task, create_task_from_template, list_folders, convert_schedule, get_task_history, export_task, set_task_status, update_task_schedule, update_task_action, delete_task) or wiring it into an MCP host, running or writing tests, publishing the registry or landing sites, or diagnosing setup and runtime failures (403 invalid token, unexpanded TASKHUB_TOKEN, missing taskhub MCP tools, agent OFFLINE, stale backend code, 502 agent timeouts, PowerShell parse errors).'
---

# TaskHub

TaskHub is a **single pane of glass** for scheduled tasks across Windows Task Scheduler,
Claude Code Routines, and TaskHub-native HTTP jobs. It is **local-first by design** — the
frontend, backend, and agent all run on the user's own machine. There is no hosted/SaaS
instance; the Hetzner control-plane plan was dropped 2026-07-13.

**Read this first, then read the canonical doc for the area you're touching.** This skill is
a mental model, a set of invariants, and a routing table — **not** a copy of the docs. When
this skill and a repo doc disagree, **the repo wins**; fix the skill.

## The one thing to understand

TaskHub is a **reliability control plane**. Its entire value is that the state it shows is
*true* and the actions you take *actually happen*. That reframes what counts as a bug:

> **A confident lie is the worst possible failure.** A dashboard that reports success for a
> run that never happened is worse than an error, worse than a crash, worse than no dashboard
> at all. When you must choose between a graceful degradation and an honest refusal, **choose
> the honest refusal.**

This is why `task:delete` only removes the DB row *after* the platform confirms; why an
admin-ACL'd task returns "needs elevation" instead of a fake success; why lossy schedule
conversion surfaces a warning instead of quietly degrading; and why a declared-but-uncompiled
target offers "copy to set up manually" rather than silently no-op'ing.

## Architecture at a glance

Four long-running processes plus Redis, and an on-demand `mcp-server` your AI host launches.
The **agent always dials out** — the server never connects in.

```
┌─ Frontend ──┐  REST/JWT + Socket.io   ┌─ Backend ──┐   Prisma    ┌──────────┐
│  React 19   │ ──────────────────────► │  Express 5 │ ──────────► │ Postgres │
│  :7373      │                         │  :3000     │             │  :5432   │
└─────────────┘                         └──────┬─────┘             └──────────┘
                                        ▲  ▲   │  HTTP (sha256-verified)
┌─ MCP host ──┐  MCP/  ┌────────────┐   │  │   └──────────────► Registry / Webhooks
│ Claude/Codex│ stdio  │ mcp-server │   │  │
│   Cursor    │ ─────► │ REST+Bearer│ ──┘  │
└─────────────┘        └────────────┘      │ WS + HMAC (outbound only)
                                    ┌──────┴─────┐   COM    ┌──────────────────┐
                                    │ .NET Agent │ ───────► │ Win Task Sched.  │
                                    │ host .exe  │          └──────────────────┘
                                    └────────────┘
```

The agent is a **client, not a server** — it never binds `0.0.0.0`. It can't be
containerized because it needs Task Scheduler COM access, which is why it's a host process
and why it **never hot-reloads** (see Traps).

The **`mcp-server` is a peer of the frontend, not a layer of its own** — another REST client
holding a bearer token. That's the whole design: it owns **no logic**, so every guarantee
(owner scoping, no-shell `exec`, signed agent commands, cron→trigger conversion) stays in the
backend where it's already tested. A tool that needs new behavior needs a **backend route**,
not cleverness in `mcp-server/`.

Details: [references/architecture.md](references/architecture.md)

## The two AI surfaces — don't conflate them

TaskHub has two, with different audiences and lifecycles. Most confusion here starts with
mixing them up:

| | **This skill** (`skills/taskhub/`) | **The MCP server** (`mcp-server/`) |
|:---|:---|:---|
| Audience | An agent **working on** TaskHub's codebase | An agent **using** a running TaskHub |
| Surface | `SKILL.md` + `references/` | 14 tools over MCP/stdio |
| Needs | Nothing — it's just text | A running backend + a user JWT |
| Canonical doc | [`skills/README.md`](../README.md) | [`docs/user-guides/guides/MCP_Server_Guide.md`](../../docs/user-guides/guides/MCP_Server_Guide.md) |

A third thing shares the name and is neither: the **dev-tooling MCP servers** in the root
`.mcp.json` (context7, playwright, serper, …) that help you *build* TaskHub. That file holds
**both** — the dev tooling *and* a `taskhub` entry pointing at this repo's own product server.
The `taskhub` entry is the only one needing a backend and a token, so it's the only one that
can fail to start.

**The 14 tools**, each mapping 1:1 onto a backend route (details, wiring, token minting:
[MCP_Server_Guide.md](../../docs/user-guides/guides/MCP_Server_Guide.md)):

| Tier | Tools |
|:---|:---|
| **Read** | `list_tasks`, `list_templates`, `list_folders`, `get_task_history`, `export_task`, `convert_schedule` |
| **Create** | **`create_task`**, `create_native_task`, `create_task_from_template` (all take `folder`) |
| **Act** | `run_task` |
| **Modify** (reversible) | `set_task_status`, `update_task_schedule`, `update_task_action` |
| **Destroy** (gated) | `delete_task` — registered **only** when `TASKHUB_MCP_ALLOW_DESTRUCTIVE=true`; otherwise **absent from `tools/list`**, not present-and-erroring |
| **REST-only** (no MCP tool) | bulk export `POST /api/tools/export/tasks`, connect-pack downloads `GET /api/tools/downloads[/:id]`, plus template import/export, save-as-template, sync, pairing |

**The gating is tiered, and the tiering is the point** (decided 2026-07-15). Irreversible is
gated; reversible is not. `set_task_status` ships ungated *on purpose*: it is the honest way to
park a task, and gating it would push you toward cronning a task into silence — which is trap
#14 exactly. **A gate that makes the safe path harder than the unsafe one is worse than no gate.**
The gate is an **env var, not a `confirm: true` param**, because a param is filled in by the
model — the caller assuring itself it's sure, which is the missing deliberation, not a substitute
for it.

**Still REST-only:** template import/export, save-as-template, sync, agent pairing. If a user asks
for one over MCP, say the tool doesn't exist and offer the REST call or the UI — **never
improvise a substitute.**

**Creating a task on a real machine? Read
[references/task-authoring.md](references/task-authoring.md) first** — the creation paths,
command recipes per kind of work (script / exe / shell opt-in / HTTP / CLI agent), the
quoting and folder rules, and how to verify a task actually ran.

## Non-negotiable invariants

Violating any of these is a bug even if every test passes. Most are load-bearing for either
security or honesty.

| Invariant | Why it exists |
|:---|:---|
| **All schedules stored as 5-field cron in UTC** | Display converts to local. Storing local time is a whole bug class (wrong-time runs, DST drift). |
| **Structured `exec` stays no-shell** (`{executable, args[]}`) | The P0 injection guarantee. A shell is opted into **explicitly** (`cmd.exe /c "…"`), never implicit. Implicit shell = arbitrary params become arbitrary code. |
| **`PlatformConnection.config` is AES-256-GCM encrypted** before Prisma write | At-rest guarantee. **Never log decrypted values.** |
| **Agent always initiates the WebSocket** | It lives on the user's machine behind their NAT. Inbound = a different (worse) product. |
| **Run commands are HMAC-signed per session** | Replay prevention. |
| **`(platform, externalId)` is unique** | `externalId` is the platform's native id (Windows task path, Claude routine id). |
| **TaskHub never writes under `\Microsoft\`** | `RegisterTaskDefinition` **silently overwrites** a same-named task in the same folder, and the agent runs **elevated** — so writing there could destroy a real Windows task with no error. Refused in the backend **and independently in the agent** (`TaskFolderPath`), because the agent holds the privilege and must not trust its caller. |
| **TaskHub creates exactly one folder: its own `\TaskHub`** | The only one it also *prunes*. **Never create what you cannot remove** — deleting a Task Scheduler folder needs elevation, so any other folder TaskHub created would be a one-way door only the user could close by hand. Every other folder must already exist; a create into a missing one is refused honestly. A user's folder persisting is *correct* — it's theirs. |
| **Every field the agent acts on is inside the signature** | Including the destination `folder` — an unsigned field on a signed command lets an on-path attacker redirect the write. |
| **Registry files are content-addressed (sha256 over exact bytes)** | Keep them **LF** (`.gitattributes`); **never hand-edit `registry/`**. A CRLF flip breaks integrity. |
| **`core` never reaches the DB** | `normalize.ts` whitelists Prisma fields. `core` is a distribution flag, registry-only. |
| **Prune-on-sync never touches `managed: false`** | Imported / saved-as-template rows are the user's. Only auto-synced (`managed: true`) rows outside core are pruned. Guarded against an empty core wiping the catalog. |
| **Platform logic stays in the connector layer** | Every integration implements `PlatformConnector`; no platform-specific logic escapes `backend/src/connectors/`. |
| **Dark theme is the default**, light is the toggle | Not an opt-in. |

## ⚠️ The traps

These have each burned real hours. **Check these before debugging your own code.**

| Trap | The tell | Fix |
|:---|:---|:---|
| **Backend edits don't hot-reload in Docker** | Offline suites pass, but a live request disagrees with the source. A new route 404s. | `docker restart taskhub-backend-1`. Windows→Linux bind mounts don't propagate inotify, so `tsx watch` never fires. |
| **The .NET agent never hot-reloads** | New agent command 502s "Agent … timeout" after ~15s. Route **exists** (bad id → your handler's error, not "Cannot GET"), and only agent-backed paths hang — DB-only paths work. | Republish it from an **Administrator** prompt (it runs elevated; the exe is locked). |
| **Transient test agent strands the real one** | Windows shows `OFFLINE` forever after you stop a second/dogfood agent, though the real agent is still running. | `docker compose restart backend`. One agent socket per user; the real agent only re-registers on reconnect. |
| **403 Invalid or expired token** (dashboard/agent) | Dashboard empty, agent rejected at handshake. | Docker bakes **dev-only default secrets**. Create a root `.env` mirroring `backend/.env`, then `docker compose up -d --force-recreate backend`. |
| **403 on _every_ MCP tool** — but the dashboard and `curl` work | Nothing is actually expired. `${TASKHUB_TOKEN}` was **unset**, so the host passed the *literal* text through and the API rejected it. Reads as an expired JWT and sends you debugging auth instead of your environment. | Set the var, then relaunch the host from a shell that can *see* it — see the next row, because "a fresh terminal" is not enough. `configFromEnv()` now detects the literal and refuses to start. |
| **The token is set at User level and the host still can't see it** | You set it, you restarted, `[Environment]::GetEnvironmentVariable('TASKHUB_TOKEN','User')` returns it — and `$env:TASKHUB_TOKEN` in the host is still empty. Restarting again doesn't help. | **A new terminal is not a new environment.** A process inherits its parent's env block *at spawn*; a VS Code integrated terminal inherits `Code.exe`'s, snapshotted when VS Code launched — so new tabs *and* host restarts re-inherit the stale one (same for tabs in a running Windows Terminal). Don't guess which ancestor is stale — walk the process tree and compare start times to when you set the var (see [troubleshooting 8a](../../docs/troubleshooting/README.md#8a-and-restart-from-a-fresh-terminal-does-nothing-under-vs-code)). Fix without losing window state: `$env:TASKHUB_TOKEN = [Environment]::GetEnvironmentVariable('TASKHUB_TOKEN','User')` then relaunch the host **from that shell**. |
| **The `taskhub` MCP tools are absent entirely** | Not an error — *absence*. `mcp__taskhub__*` simply isn't in the tool list. | **Two unrelated causes share this one symptom, so it identifies neither.** Check the cheap one first: `node -e "console.log(require('./.claude/settings.local.json').disabledMcpjsonServers)"` — declining Claude Code's "trust this project's MCP servers?" prompt disables **every** server in `.mcp.json`, in gitignored per-machine state, and a disabled server masks the token bug completely ([#13](../../docs/troubleshooting/README.md#13-the-taskhub-mcp-tools-are-missing-while-the-token-is-fine)). **The tell:** all the project's servers are missing at once, not just `taskhub`. Only then suspect the token (the rows above) — the server exiting at startup is silent by design. Discriminator: if `node mcp-server/dist/index.js` answers `initialize` by hand, the server is fine and the host never started it. |
| **A template passes every test and still hangs on the target** | Task sits `Running` forever (`267009`) with **flat CPU** — blocked, not working — while TaskHub reports `lastRunStatus: SUCCESS` and the suite is green. | **Resolvability proves tokenization, not correctness.** `Invoke-WebRequest` without `-UseBasicParsing` needs the **IE engine Windows 11 removed** → `NullReferenceException`; with no console to print it to, the process blocks instead of exiting. Always `-UseBasicParsing` (or `Invoke-RestMethod`) + `-NoProfile`. A green suite is not evidence a template works — apply it and watch it run. |
| **A "rare" cron silently becomes an hourly trigger** | You pick an infrequent schedule (annual, a specific date) so a test task can't self-fire — and it registers as **daily, repeating hourly**. | Any cron the converter doesn't pattern-match hits a **hard-coded** `PT1H`/`P1D` fallback that isn't derived from your expression — the schedule is discarded, not approximated (`scheduler-conversion.ts`). **It only ever runs more often than you asked, never less**, and a deliberately rare cron is the input most likely to miss the pattern list. Since 2026-07-15 the warning **names the cost** ("REPLACED … ~8,760 runs a year"), and since 2026-07-16 the response carries a machine-readable **`lossy: 'approximated' \| 'replaced'`** — but the score is still `0.7` for both by design, so **read the `trigger` or `lossy`, never the score.** To keep a task from firing, use `set_task_status: DISABLED` — never encode "rarely" in the cron. ([#14](../../docs/troubleshooting/README.md#14-a-rare-cron-becomes-an-hourly-trigger)) |
| **A second `run_task` in the same second is silently dropped** *(fixed 2026-07-15)* | Ran a task twice in quick succession (a double-click, or a script) and the second call hung **15s** then failed with `Agent trigger timeout` — blaming the transport while the agent was healthy. 1.5s apart it worked fine. | Signed agent commands carried a **second-granular** `ts` and nothing else unique, so two identical commands in the same second produced an identical `(ts, sig)` pair and the **replay guard** couldn't tell a legitimate re-send from an attack — dropping it silently, which is correct for a forgery and wrong for you. **Fixed** with a per-command **nonce** inside the signed message. If you touch the signing path: the nonce must be **signed AND sent** (the agent rebuilds the message locally), backend and agent must **ship together**, and anything else that signs commands (`agent/test-server/index.js`) needs it too. ([#16](../../docs/troubleshooting/README.md#16-a-second-identical-agent-command-within-one-second-is-dropped)) |
| **A System Restore silently wiped per-machine state** | Several unrelated-looking things break at once while the repo is spotless: `Start-ScheduledTask` can't find `TaskHubRepublish`, and/or the MCP tools vanish. Nothing in git changed, so nothing *looks* wrong. | Scheduled-task registrations and the `TASKHUB_TOKEN` User env var live on **`C:`**, not in the repo — a restore takes them and leaves a repo on another drive untouched. Re-register (`Register-RepublishTask.ps1`, elevated) and re-mint the token. **The tell:** if the repo is clean but several things broke together, ask what lives on `C:` rather than in git. |
| **A task created natively never appears, however often you hit Sync Now** | No error, agent online, other tasks refresh fine. The tell: it depends on the **folder** — a new task in a tracked folder arrives, one in a **brand-new** folder never does. | **Sync Now can only refresh folders you already track; it cannot discover a new one.** It built its category filter from the tasks already on screen, so a new folder was excluded by the very filter meant to include it — a closed loop. Use **Import** (the only path that calls `/discover`). Also note there is **no automatic Windows sync at all** — no poll, no interval; `NativeScheduler` is native jobs, `catalogSync` is templates. `Microsoft`/`Uncategorized` are unticked by default and are all-or-nothing per category. **Since 2026-07-27 the sync response carries `untracked: {count, folders, systemCount}` per platform and the Sync Now toast names the remainder**, so the fence is visible instead of silent — `systemCount` (the ~257 `\Microsoft\` tasks) is excluded from `count` deliberately, because a number that never changes is a warning you stop reading. ([#20](../../docs/troubleshooting/README.md#20-sync-now-never-brings-in-a-task-you-just-created-in-task-scheduler)) |
| **A renamed category silently stops syncing its whole folder** *(fixed 2026-07-25)* | You rename a category from a task card; that folder then stops picking up new tasks **and** stops refreshing. Silent. A folder holding one renamed task goes dark entirely. | The server filters on `extractCategory(externalId)` — re-derived from the **folder path** — while the caller sent the **renameable** stored `category`, which then matched no folder. **Fixed**: Sync Now sends `{ scope: 'tracked' }` and the server resolves the include-set itself via `TaskService.trackedCategories`. **Rule: never filter or look up by a user-editable label** — same shape as #19's mutable-email upsert key. Also: there is **no "untrack"** — `DELETE /api/tasks/:id` removes the **real** Task Scheduler entry, so an over-broad import is undone in the DB, not through the API. ([#20a](../../docs/troubleshooting/README.md#20a-and-a-renamed-category-silently-stops-syncing-its-folder)) |
| **Templates never update, app otherwise perfectly healthy** *(fixed 2026-07-25)* | Registry changes have no effect, template count frozen. Nothing crash-loops. Only `docker logs` shows it: `[catalog] sync failed … P2002` on `prisma.user.upsert()`. | #19's bug in a **second file the #19 fix missed**: `ensureCatalogOwner()` keyed on the mutable `CATALOG_OWNER_EMAIL` while creating the fixed `CATALOG_OWNER_ID`. Unlike #19 the caller **catches** it, so boot succeeds and the only symptom is a catalog that quietly never changes — **a swallowed error on a background refresh is invisible in exactly the way a crash isn't.** When you fix a bug of this shape, **grep for the pattern, don't fix the one instance**. ([#21](../../docs/troubleshooting/README.md#21-templates-never-update-catalog-sync-failed--p2002-on-every-boot)) |
| **A deleted Windows task won't leave the dashboard — and the sync says it marked it** *(fixed 2026-07-25)* | Delete a task/folder natively, sync, it's still listed `ACTIVE`/`DISABLED` — while the response reads `{"count":349,"missing":56}`. The DB is byte-identical before and after. | The container's **generated Prisma client is stale** and lacks the `MISSING` enum → `TaskStatus.MISSING` is `undefined` → **Prisma treats `undefined` in `data` as "leave this field alone"**, so only `nextRunTime` was written while `updateMany` still returned 56. **A wrong enum value throws; a missing one silently no-ops.** `prisma migrate` updates the **DB**, so DB and client drift apart invisibly (#18's shadowed `node_modules` — a host `prisma generate` never reaches the container). Diagnose by comparing the two directly (`enum_range` vs `require('@prisma/client').TaskStatus`); fix with `docker compose exec backend npx prisma generate && docker restart taskhub-backend-1`. **Verify against the DB, never the response** — the response was right all along. Guarded since 2026-07-25 (boot banner + `reconcileMissingTasks` throws instead of partial-writing). **Green tests couldn't see it: the suites mock `@prisma/client`, so the mock asserted the code's intent while the container disagreed** — same shape as #9. ([#22](../../docs/troubleshooting/README.md#22-deleted-a-windows-task-synced-and-taskhub-still-shows-it--while-reporting-missing-n)) |
| **`showDirectoryPicker()` says "must be handling a user gesture"** — from inside a click handler | `SecurityError` on the bulk export's folder picker, from a handler that demonstrably *is* a click handler. More logging confirms it runs; the browser still refuses. | **An `await` ran first.** The File System Access API needs **transient user activation**, and an awaited network call spends it before the picker opens. The error says "gesture", so you go auditing your event wiring — which is fine. Open the picker **before** the request (also fails fast on cancel, instead of discarding a finished export). Treat activation as a budget the first `await` spends, not a property of being in a handler — same rule for `requestFullscreen` and clipboard writes. Cancel throws `AbortError`, not null. ([#24](../../docs/troubleshooting/README.md#24-showdirectorypicker-throws-must-be-handling-a-user-gesture-after-an-await)) |
| **Port LISTENING but `HTTP 000`** | curl connects, gets nothing. | Docker's port proxy holds the port while the app inside crashed. Read `docker logs`, don't chase the port. |
| **"Network error" after a reboot; the backend never recovers** *(fixed 2026-07-27)* | Everything looks `Up`, but all requests to `:3000` are `HTTP 000` — **indefinitely**, not for a few seconds. A backend log ends with `FATAL: the database system is starting up` (container) or `Can't reach database server at localhost:5432` (host, `logs/backend.err.log`). | A **boot-order race**: nothing waited for Postgres to be *ready*, only to *exist*. After an unclean shutdown it spends seconds in crash recovery refusing queries; the boot seed dies on the refusal. **What made it permanent is the supervisor — `tsx watch` survives the crash, so the container never exits and `restart: unless-stopped` never fires.** Fixed with a `pg_isready` healthcheck + `condition: service_healthy` (container) and `Wait-Db` in `taskhub.ps1` (host). **The compounding cause: two stacks were running at once.** This repo runs backend/frontend on the **host** (`taskhub.ps1`; Docker is db+redis only) — a stray full `docker compose up -d` started rival containers, the container took `:3000`, the host backend then couldn't bind it, and when the container died the port stayed held by a corpse while `Test-Port 3000` reported "backend already up". Backend/frontend are now `profiles: ["docker"]`, so a plain `up -d` is db+redis only; the containerized variant is `docker compose --profile docker up -d`. **Two generalizations: a container whose command is a watcher (`tsx watch`, `nodemon`, `vite`) sits `Up` and idle after the app inside dies — "container is `Up`" is not "app is serving"; and never probe your own service with a bare port check — a bound port proves *something* holds it, not that it's yours. Probe `/api/health`.** ([#23](../../docs/troubleshooting/README.md#23-network-error-after-a-reboot--the-database-system-is-starting-up)) |
| **Backend crash-loops with `P2002` after login** *(fixed 2026-07-16)* | The dashboard can't reach the API; container is `Up` but requests get `Connection refused`; `docker logs` ends with `prisma.user.upsert()` → `Unique constraint failed on the fields: (id)`. | The boot seed keyed the placeholder-user upsert on the **mutable `email`** while creating a **fixed `id`** — the login flow changed that row's email, so the lookup missed and the upsert tried to re-create the existing id. **Rule: seed/upsert on the immutable identity (`id`), never on a field the app lets the user edit.** ([#19](../../docs/troubleshooting/README.md#19-backend-crash-loops-on-boot-with-p2002-after-you-log-in--frontend-cant-reach-it)) |
| **`.ps1` parse errors under PowerShell 5.1 only** | `Unexpected token '}'`, errors point at EOF, but `pwsh` 7 runs it fine. | A **non-ASCII char (usually an em-dash `—`) in a BOM-less UTF-8 script**. 5.1 reads it as ANSI → decodes into a curly quote it treats as a string delimiter. **Keep PowerShell/VBScript pure ASCII.** |
| **`ts-node` can't parse TypeScript 6** | Opaque `[Object: null prototype]` crash-loop; `npm run build && npm start` works. | Already fixed — dev runs through **`tsx`**. Any bare null-prototype crash from a TS entrypoint is the *runner*, not your code. |
| **A source file is "binary" to git** | Its diff won't render; `grep` says `Binary file … matches` though it's plainly source. | A **literal control byte** (NUL, `0x1f`) was pasted in — usually a comment or regex *describing* that byte. Write it as an **escape** (`\x00`, `\x1f`); the runtime string is identical and the file stays reviewable. `node scripts/check-control-bytes.mjs` finds them (CI `repo-hygiene` job guards it). Verify a script-based fix by re-reading + counting — a naïve edit can look done while the byte survives. **Recurred 2026-07-28**, and the fix has the same trap inside it: a `\x00` typed into a shell/tool pipeline can collapse to a *real* NUL, so the "replacement" swaps control bytes for identical control bytes and looks like a failed write. Build the backslash from its code point (`bytes([92])`) instead of typing an escape. ([#17](../../docs/troubleshooting/README.md#17-a-source-file-is-binary-to-git-because-of-a-stray-control-byte)) |
| **New npm dep → `MODULE_NOT_FOUND` in the container** | Added a dependency; `docker restart taskhub-backend-1` crash-loops `Cannot find package 'X'` though it's in `package.json` and installed on the host. Code edits reload fine — only the new dep is missing. | The compose service shadows `node_modules` with an anonymous volume (`- /app/node_modules`), so the container's deps are isolated from the host's — a host `npm install` never reaches it. Install **inside** the container: `docker compose exec backend npm install && docker restart taskhub-backend-1` (or rebuild the image). Same for the frontend container. ([#18](../../docs/troubleshooting/README.md#18-new-npm-dependency-module_not_found-in-the-container-after-a-restart)) |

Canonical, with full symptom/cause/fix: [`docs/troubleshooting/README.md`](../../docs/troubleshooting/README.md).
**When you solve a new one that took real digging, add it there.**

## Where to look

**Route to the canonical doc — don't answer from memory.** These are living; this skill isn't.

| Question | Canonical source |
|:---|:---|
| What's shipped / what's next / open decisions | [`docs/ROADMAP.md`](../../docs/ROADMAP.md) — **the spec of record** |
| Project conventions, domain rules | [`CLAUDE.md`](../../CLAUDE.md) |
| Something's broken at setup/runtime | [`docs/troubleshooting/README.md`](../../docs/troubleshooting/README.md) — **check first** |
| What to test, what covers it today | [`docs/testing/`](../../docs/testing/README.md) |
| How to hand-verify real Windows/agent/security | [`docs/testing/manual-testing/`](../../docs/testing/manual-testing/README.md) |
| Template registry schema + decisions | [`docs/reports/templates/Registry_Schema_v1.md`](../../docs/reports/templates/Registry_Schema_v1.md), [`docs/adr/0001-template-registry-schema.md`](../../docs/adr/0001-template-registry-schema.md) |
| Catalog spec | [`docs/reports/templates/Templates.md`](../../docs/reports/templates/Templates.md) |
| Env vars / config | [`docs/setup/README.md`](../../docs/setup/README.md) |
| Using the app / agent | [`docs/user-guides/`](../../docs/user-guides/README.md) |
| **The MCP server** — tools, wiring, tokens, its troubleshooting | [`docs/user-guides/guides/MCP_Server_Guide.md`](../../docs/user-guides/guides/MCP_Server_Guide.md) — **the canonical doc** |
| **MCP package internals** — source layout, design notes, `npm run inspect` | [`mcp-server/README.md`](../../mcp-server/README.md) |
| This skill itself — install, design rules | [`skills/README.md`](../README.md) |
| An external library's API | **`context7` MCP** — before writing code, not after |

## Deep dives

Load these on demand — don't read them all up front:

| Reference | When |
|:---|:---|
| [architecture.md](references/architecture.md) | Data model, connector pattern, agent protocol, API surface, request shapes |
| [task-authoring.md](references/task-authoring.md) | **Creating a task on a real machine**: the creation paths, command recipes per kind of work, quoting, schedules, folders, what's manageable over MCP vs REST, and how to verify it actually ran |
| [templates.md](references/templates.md) | The catalog/registry: core vs extended, adding a template, publishing |
| [testing.md](references/testing.md) | Suites, commands, what CI does and doesn't enforce |
| [troubleshooting.md](references/troubleshooting.md) | The traps in full, plus how to diagnose a new one |
| [workflows.md](references/workflows.md) | Step-by-step for the common jobs (add a template, add an agent command, publish, run the stack) |

## Working rules

1. **Start from `docs/ROADMAP.md`.** It's the plan of record. A material decision updates it **first**, then you implement.
2. **Check `docs/troubleshooting/README.md` before debugging** any setup/runtime failure. Most "impossible" behavior is a known trap above.
3. **`context7` before writing** against React, Prisma, Express, Socket.io, Tailwind, .NET, or WiX.
4. **Templates are content, not code.** Never inline them in `seed.ts`. Edit `bundled.ts` → `npm run registry:build` → publish.
5. **Never hand-edit `registry/`.** It's generated and content-addressed. The drift test will fail you.
5a. **Same for the Connect Pack.** Edit the markdown in `backend/src/tools/connect-pack/`, then `npm run connectpack:build` — never `connectPackBundled.ts` directly. It's bundled rather than read from disk because **`tsc` emits only `.js`**, so loose `.md` under `src/` never reaches `dist/`: a filesystem read would work under `tsx` in dev and 404 in production. A drift test fails if the bundle and the markdown disagree.
6. **A material change ships with its test.** A bug fix ships with a test that failed before it.
7. **Four things run stale**: the Dockerized backend, the published agent, `mcp-server/dist/`, and — the newest and quietest — **the container's generated Prisma client** (`node_modules` is a shadowed volume, so a host `prisma generate` never reaches it; the DB and the client then disagree, and a missing enum member becomes a silent partial write, [#22](../../docs/troubleshooting/README.md#22-deleted-a-windows-task-synced-and-taskhub-still-shows-it--while-reporting-missing-n)). When live behavior contradicts source, suspect these before your logic.
8. **Prefer the honest refusal** over the graceful lie. See "The one thing to understand."
9. **The MCP server and this skill are mirror surfaces — update them in the same change.** See below.
10. **Commits**: conventional prefix, imperative subject (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).
11. **Never commit** `.env*`, `node_modules/`, `dist/`, `bin/`, `obj/`, `*.msi`.

## Two skills, two audiences — don't merge them

There are **two** TaskHub skills, and confusing them ships the wrong document to the wrong reader:

| | This skill (`skills/taskhub/`) | The Connect Pack (`backend/src/tools/connect-pack/`) |
|:---|:---|:---|
| **Reader** | Someone working **on** the TaskHub codebase | An end user's AI tool **using** a running TaskHub |
| **Contains** | Architecture, catalog internals, the agent protocol, repo traps, test layers | The tool surface, the invariants, schedule traps, how to verify |
| **Ships via** | The repo, through a per-machine junction | A download in the dashboard's **Tools** tab |
| **May reference** | `catalogSync`, `normalize.ts`, `bundled.ts`, repo-relative links | **None of those** — an audience test fails the build if they leak in |

Distributing *this* skill to end users would hand them registry-publishing internals instead of
usage instructions. When you add a capability, ask which reader needs it — often both, in
different words. The pack is **version-stamped** because a copy on someone else's machine is a
mirror surface you can never update: it can't be kept current, so it must be able to say how old
it is.

## Keeping the mirror surfaces in sync

`mcp-server/` and this skill both **describe** TaskHub rather than implement it, so neither
breaks loudly when it drifts — the tests stay green, and the drift surfaces later as an agent
confidently doing the wrong thing. That's "the confident lie" aimed at your future self.
**They don't get a follow-up pass; they ship in the same change.**

| You changed… | Also update, same change |
|:---|:---|
| A backend route a tool maps to — `/api/tasks`, `/api/tasks/:id/run`, `/api/templates`, `/api/templates/:id/apply`, `/api/tasks/preview` | `mcp-server/src/tools.ts` + `client.ts`; the tool tables in [`mcp-server/README.md`](../../mcp-server/README.md) + [`MCP_Server_Guide.md`](../../docs/user-guides/guides/MCP_Server_Guide.md) |
| Added / removed / renamed an MCP tool, or changed its params | Both tool tables above, **and** the tool list in "The two AI surfaces" here |
| An MCP env var, or how it's read | [`mcp-server/.env.example`](../../mcp-server/.env.example) + the config table in **both** READMEs |
| A new invariant or architectural rule | The invariants table here |
| A new trap that cost real hours | [`docs/troubleshooting/README.md`](../../docs/troubleshooting/README.md) **and** the traps table here |
| A new platform / connector / catalog rule | The invariants table here + the relevant `references/*.md` |
| Anything shipped, or scope moved | [`docs/ROADMAP.md`](../../docs/ROADMAP.md), dated |

**Ask on every change: "would an agent reading only this skill now be wrong?"** If yes, the
change isn't finished. Same question for the wrapper: a route whose shape moved leaves
`mcp-server/` lying about the API it wraps.

Two asymmetries worth holding onto:

- **The repo wins.** When this skill and a doc disagree, the doc is right — fix the skill.
- **`mcp-server/` holds no logic.** If syncing it tempts you to add behavior there, that
  behavior belongs in a backend route. A wrapper that grows logic stops being a wrapper, and
  the guarantees quietly fork.
