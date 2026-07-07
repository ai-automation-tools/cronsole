# TaskHub — Full Project Analysis

**Date:** 2026-07-07
**Method:** Codebase deep-dive (backend, frontend, .NET agent, docs/templates) + live run of the local app (Postgres/Redis via Docker, backend on :3000, frontend on :5173) with a hands-on UI walkthrough of every screen and view mode.

> **Progress update — 2026-07-07 (end of day).** Since this analysis was written, the following
> shipped (all tested, verified live, and committed):
>
> - ✅ **P1 #4 — cron→Windows-trigger conversion wired end-to-end.** Apply route converts via
>   `convertCronToWindowsTrigger`, sends a structured `trigger` in `task:create`; agent
>   `TriggerBuilder` registers real Daily/Weekly/interval triggers (UTC→local). New
>   `POST /templates/:id/preview` endpoint + live confidence warnings in the Apply modal.
>   Also fixed: apply route ignored the modal's edited cron (`schedule` vs `scheduleExpression`).
> - ✅ **New feature — TaskHub-native tasks** (`TASKHUB_NATIVE` platform; design in
>   `docs/resources/Native_Tasks.md`): backend `NativeScheduler` (30s tick, missed-run grace,
>   `ExecutionLog` writes), HTTP job executor, `TaskHubNativeConnector`,
>   `POST /api/tasks/native`, New Task modal with cron presets, violet TaskHub badge identity,
>   and a **dashboard platform filter** for one-click isolation of native vs. Windows tasks.
> - ✅ **P2 #8 (execution history) — Run History tab** in the task modal
>   (`GET /api/tasks/:id/executions`), with per-run status pills, timestamps, log snippets, and
>   **durations** (`ExecutionLog.durationMs`).
> - ✅ **P2 #8 (failure surfacing, partial) — red "Run failed" indicator** on grid cards and the
>   list view, driven by flattened `lastRunStatus`/`lastRunAt` on `GET /api/tasks`.
>   (Webhook/notification alerts remain open.)
> - ✅ **Delete for native tasks** (`DELETE /api/tasks/:id`, native-only guard + modal button).
> - ✅ Shared `frontend/src/platform.ts` — fixed §3.13 (every non-Windows platform labeled "Claude").
> - ✅ **Stale-task cleanup on sync** — `TaskService.removeStaleTasks` deletes DB rows (and their
>   execution logs) for tasks removed natively from the platform; wired into `POST /tasks/sync`
>   using the connector's full pre-filter list. Verified live: 22 deleted Windows tasks purged.
> - ✅ **Agent reconnect resilience** — root cause of "agent shows offline": SocketIOClient's
>   `ReconnectionAttempts` defaults to 10, so a backend restart longer than ~10 quick retries made
>   the agent give up forever. Added a `Connected` property + 30s watchdog loop in `Program.cs`
>   that re-calls `ConnectAsync` whenever disconnected (also covers agent-starts-before-backend at
>   boot). Note: do NOT set `ReconnectionAttempts = int.MaxValue` — the library's delay math
>   overflows and every connect throws `millisecondsDelay` out-of-range.
> - ✅ Import modal now shows an honest empty state ("agent may be offline") instead of a blank
>   body when discovery returns nothing — this was why "Sync Now" appeared to do nothing.
> - Item statuses below are annotated: ✅ done · 🟡 partial · ⬜ open.

---

## 1. Executive Summary

TaskHub is in genuinely good shape for a Phase-4 MVP. The core loop works end-to-end: the app came up cleanly, synced **77 real Windows tasks**, and the dashboard, category chips, four view modes (Grid/List/Kanban/Schedule), template library, and Apply modal all function. The architecture (connector registry, agent-over-WebSocket, template catalog with `{{placeholder}}` parameters) is the right shape.

The gap is between **what the docs promise and what the code does**. Three findings matter most:

1. **Security is documented but not implemented.** The WebSocket has no authentication at all — any process that can reach port 3000 is auto-registered as the placeholder user and can create/run arbitrary Windows scheduled tasks (i.e., arbitrary command execution, and the agent runs with highest privileges). `PlatformConnection.config` is stored as **plaintext** despite the AES-256-GCM helpers existing and being tested; JWT falls back to a hardcoded `'fallback-secret'`; a real dev bearer token is committed in `frontend/src/api.ts`. None of this blocks local use today, but **all of it blocks Phase 5 hosting**. Do not put the backend on the Hetzner VPS until §4 items are done.
2. **The cron→Windows-trigger conversion doesn't actually exist in the execution path.** The agent special-cases exactly two cron strings and silently falls back to "daily at now+1h" for everything else — so most templates create tasks that run at the *wrong time*. The real conversion code exists in `backend/src/utils/scheduler-conversion.ts`, fully tested, but **no route or agent code calls it**. This is the single highest-impact functional bug.
3. **The template system is a strong skeleton that needs ~1 more sprint of product work** — categories/search in the UI, a task-name field and cron helper in the Apply modal, "save existing task as template," and a coding-focused template expansion (detailed catalog proposal in §7).

---

## 2. What's Working Well (verified live)

- **End-to-end sync**: .NET agent → Socket.io → Prisma → dashboard. 77 tasks with correct category extraction from Task Scheduler folder paths (Edge-Radar, PaxAI, Git-Repos, AI-Automation-Library…).
- **Dashboard UX**: category filter chips with counts, Active Only toggle, 4 view modes, clone, run-now, Help Center. The dark UI is clean and consistent.
- **Template Apply flow**: platform picker → editable cron → dynamic parameter fields → live resolved-command preview with amber "fill required fields" warning and a disabled submit until valid. Double validation (client + server rejects leftover `{{`).
- **Clean separation in the agent**: `ISocketClient` / `ITaskScheduler` interfaces with real unit tests (xUnit/Moq).
- **Testing discipline exists**: ~50 backend Vitest tests + ~22 frontend component tests + agent unit tests. The pure logic (encryption, cron conversion, category extraction) is well covered.
- **Docs are a real spec**: phase docs, Templates.md, and Project_Plan.md are detailed and mostly accurate about what remains.

---

## 3. Live Walkthrough — Bugs & Paper Cuts Observed in the UI

| # | Observation | Root cause / location |
|---|---|---|
| 1 | Schedule view shows **"No direct schedule"** on nearly every task | `Task.schedule` is never normalized to cron on sync; agent only sends state + run times. The "all schedules stored as 5-field cron UTC" convention (CLAUDE.md §9) is not honored for synced tasks. |
| 2 | **"1/1/1, 12:00:00 AM"** next-run times | .NET `DateTime.MinValue` (`0001-01-01T00:00:00`) leaks from `Win32TaskScheduler.ListTasks()` through metadata to the UI unfiltered. |
| 3 | Stale data (Last updated 6/23/2026) presented without any staleness cue | No auto-sync on load, no WebSocket push to the browser, no "last synced X days ago" warning. |
| 4 | Sidebar "System Status: Windows Agent Online / Claude API Healthy" is **hardcoded fake** | `Sidebar.tsx:52-66`. The agent wasn't even running during my session and it still said Online. Misleading — worse than no status. |
| 5 | "Sync Now" button actually opens the Import modal, not a sync | `Dashboard.tsx:1078` — `refetch={() => setShowImport(true)}`. |
| 6 | Task modal "Edit Schedule" button is a no-op | `TaskModal.tsx:105`. |
| 7 | Settings page is a stub ("coming soon in Sprint 2") | `Dashboard.tsx:1088`. |
| 8 | Apply modal has **no task name field** — templates create tasks with the template's default name; applying the same template twice collides | `ApplyTemplateModal.tsx` (name override is supported by the API but not exposed in UI). |
| 9 | Raw JSON dump as "Platform Metadata" in the task modal | Fine for dev, not a product surface. Render friendly fields (last run, next run, path, state) instead. |
| 10 | Invalid Tailwind classes (`slate-855`, `slate-955`, `slate-450`…) silently render unstyled; `custom-scrollbar` class referenced 4+ times but defined nowhere | ~10 occurrences in `Dashboard.tsx`. |
| 11 | All confirmations via `window.confirm`/`alert` | Blocks thread, unstyleable, inaccessible. Replace with a toast + confirm dialog component. |
| 12 | Modals: no Escape-to-close, no focus trap, no `role="dialog"`, backdrop click doesn't close | All modals. |
| 13 | Non-Windows platforms are all labeled "Claude" in list/kanban views | Repeated ternary `platform === 'WINDOWS_TASK_SCHEDULER' ? 'Windows' : 'Claude'` in ~6 places. |
| 14 | Sidebar is fixed `w-64` with no mobile drawer — the "<375px viewport" requirement (CLAUDE.md §9) currently fails | `Sidebar.tsx:15`. |

---

## 4. Critical Security Findings (fix before any public hosting)

Ranked. Items 1–4 are **Phase 5 blockers**.

1. **Unauthenticated WebSocket = remote command execution.** `backend/src/index.ts:39-52` registers *every* connecting socket as `cli_user_placeholder`; Socket.io CORS is `origin: "*"`. Anyone reaching port 3000 can emit `task:create` → the agent runs `cmd.exe /c <anything>` as highest-privilege. The agent (`AgentService.cs`) has zero auth: no pairing secret, no HMAC, no token — despite Phase4.md:76-78 specifying all three. **Fix:** pairing-secret handshake on `agent:hello`, per-session HMAC on `task:run`/`task:create`, reject unauthenticated sockets, restrict CORS.
2. **Plaintext platform configs.** `encryptConfig`/`decryptConfig` (`auth/encryption.ts`) are implemented and tested but never called; `PlatformConnection.config` (Claude routine tokens, future API keys) is plaintext JSON, contradicting the schema comment and CLAUDE.md §9. **Fix:** wire encryption into every config write/read (tasks.ts:172, 270-273; templates.ts:75).
3. **Multi-tenancy is absent + IDOR.** All routes hardcode `userId = 'cli_user_placeholder'`; `GET /api/tasks` returns *all* users' tasks (`findMany` with no `where`); `PATCH /tasks/:id` and `POST /tasks/:id/run` don't check ownership. Fine single-user-local, fatal hosted. **Fix:** scope every query to `req.user.id`.
4. **Secret hygiene.** `JWT_SECRET` silently falls back to `'fallback-secret'` (`auth/auth.ts:7`) — make it fail-fast like `ENCRYPTION_KEY` does. A live dev JWT is committed in `frontend/src/api.ts:10` — remove and rotate. Committed `coverage/` and `agent/publish/` artifacts should be gitignored/removed.
5. **No command validation anywhere.** The agent executes server-supplied strings verbatim via `cmd.exe /c` regardless of the template's declared `scriptType`; the shell-escaping promised in Templates.md §5 exists in neither backend nor agent. Template parameter values are raw string-replaced into commands (a `"` in a path breaks/injects). **Fix:** escape per-OS at apply time; have the agent build the Task Scheduler action from structured `{executable, args[]}` instead of one shell string.
6. **Plain HTTP, hardcoded server URL** in the agent (`Program.cs:16-17`). Needs config (env/appsettings) + WSS for remote.

---

## 5. Functional & Architectural Improvements

### Backend
- **Wire up `scheduler-conversion.ts`.** Call `convertCronToWindowsTrigger` + `getTemplateConfidence` in the apply route; send the *structured trigger* to the agent instead of the raw cron string; surface the confidence score in the Apply modal ("This schedule converts cleanly" / "Approximated as…"). This kills the biggest functional bug (agent's 2-case cron parser, `Win32TaskScheduler.cs:62-79`).
- **Shared Prisma singleton.** 6 separate `new PrismaClient()` instances (index.ts, auth.ts, both routes, TaskService, seed) → one `src/db.ts`.
- **Batch upserts.** `TaskService.upsertTasks` does 77 sequential awaited upserts per sync. Use `$transaction` with batched upserts (or delete+`createMany` per platform).
- **Zod at boundaries** (CLAUDE.md §10 already mandates this): request schemas for tasks/templates/auth; stop casting `as PlatformType`; stop leaking `error.message` in 500s — add one error middleware.
- **Populate the dead schema fields** or drop them: `Task.nextRunTime` (agent already sends it — normalize `DateTime.MinValue` → null), `quickLink`, `apiVersion`, `fallbackActive`.
- **Request/response correlation on the socket.** Connector calls match responses by task *name* with per-call `socket.on` — concurrent ops can cross wires. Add a `requestId` to the message envelope (also enables the `noun:verb` + envelope convention from CLAUDE.md §9 which the code half-follows).
- **ExecutionLog is unused.** Start writing a row per `task:executed` — you already have the table and it unlocks the history UI (§6).

### Agent
- **Config file / env for server URL**; structured logging to file + EventLog instead of `Console.WriteLine`.
- **Report failures back**: `task:run` and `task:set_status` failures are currently logged locally and silently swallowed from the UI's perspective.
- **Add `task:delete`** (interface + impl + server route). Delete is the one CRUD op fully missing.
- **App-level heartbeat** (30s per spec) so the server's `getHealth` means something and the frontend status panel can be real.
- **Reconnect with backoff** — currently relies on SocketIOClient defaults with no `OnReconnected` handling.
- ✅ **Target `net8.0` or update the docs** — csproj targets `net10.0` while every doc says .NET 8. *(Resolved 2026-07-07: living docs updated to .NET 10; historical phase/research docs left as written. Stale post-reorg doc links in README/CLAUDE/CONTRIBUTING also fixed in the same pass.)*

### Frontend
- **Split `Dashboard.tsx` (1,117 lines)** into `screens/` + `views/` + `demo/` fixtures. Extract shared `platformLabel` and the mutation-error pattern.
- **Real system status**: a `/api/health` poll (or better, Socket.io in the browser) driving the sidebar panel; add "last synced N ago" chip near Sync.
- **Live updates**: connect the browser to Socket.io and invalidate `['tasks']` on `task:updated` — the CLAUDE.md convention already specifies exactly this; today the frontend has *no* WebSocket at all.
- **Error states**: `['tasks']` query has no error UI (failures masquerade as "Dashboard is empty"); templates query swallows errors to `[]`.
- **Fix the paper cuts** from §3 (invalid Tailwind shades, `custom-scrollbar`, Sync Now semantics, alert()→toasts, modal a11y, mobile drawer).
- **Add react-router** (or TanStack Router) — tab-state "routing" means no deep links; you'll want `/templates/:id` and `/tasks/:id` shareable soon.
- Delete dead `App.tsx`/`App.css`, unused `clsx`/`tailwind-merge`, unused CSS vars.

---

## 6. Feature Additions (ranked by value/effort)

**Near-term (Phase 4/5 window)**
1. **Execution history** — persist `ExecutionLog` on every run; task modal gets a "Runs" tab (status, duration, timestamp). This is the #1 thing a "single pane of glass" is missing: *did my stuff run last night?*
2. **Failure surfacing** — red status on tasks whose last run failed (`lastTaskResult` from Task Scheduler is already available to the agent); a "Needs attention" chip/filter on the dashboard.
3. **Task name + folder in Apply modal**, and create TaskHub-made tasks under a `\TaskHub\` scheduler folder so they're identifiable and cleanly removable.
4. **Cron helper** — human-readable preview ("Every day at 8:00 AM UTC / 1:00 AM your time") + 6–8 preset chips (hourly, daily 9am, weekdays, Sunday night…). Cheap to build, transforms usability. Show local-time conversion — the UTC-only field is a footgun.
5. **Save task as template** — "Create template from this task" on the task modal. This is how the catalog grows organically from Mike's real 77 tasks.
6. **Settings page** — replace the stub: backend URL, theme, timezone display preference, agent pairing management.

**Medium-term**
7. **Notifications** — on task failure, push via ntfy/Discord webhook/email. Scheduled tasks failing silently is the core pain TaskHub should solve.
8. **Schedule timeline view upgrade** — a real "next 24h" agenda computed from cron expressions (once schedules are normalized), not the current last-updated ordering.
9. **Two-way basics** — enable/disable already works; add edit schedule (the button exists!) and delete.
10. **macOS agent** (launchd) — 7 catalog templates are already waiting for it; the `ITaskScheduler` abstraction ports cleanly.

**Phase 6 (keep as planned, but re-sequence)**
11. **MCP server first, ChatGPT connector last.** The MCP server (`list_tasks`, `run_task`, `create_task_from_template`, `convert_schedule`) is the highest-leverage Phase 6 item for *your actual workflow* — it lets Claude Code sessions create scheduled automations conversationally. It's also a thin wrapper over routes that already exist. ChatGPT has no public automations API; leave it quick-links forever unless that changes.

---

## 7. Template Section — Deep Dive & Recommendations

### Current state (verified in UI + seed)
24 templates: 4 "use-case patterns" (Tier B, with fake upvotes, *not parameterized*) + 20 "script starters" (Tier A, parameterized). Solid runtime coverage (PowerShell/Batch/Python/Node/EXE/HTTP/VBScript/zsh/bash/AppleScript/Claude/ChatGPT). Reusable parameter defs (`P` object in `seed.ts`), types `text|path|url|select` rendered; `number|enum` declared in spec but no distinct UI.

### Structural problems to fix first
1. **Flat list, no organization.** `Template.category` exists in the data but the page shows one unordered wall of 24 cards. Add: category filter chips (reuse the dashboard chip component), OS filter (Windows/macOS/Cross/AI), starter-vs-pattern grouping, and a search box. At 40+ templates the current page becomes unusable.
2. **Tier B patterns aren't parameterized** — "Daily Database Backup" ships a literal `pg_dump -U postgres my_db > backup.sql` with no placeholders. Convert all four to `commandTemplate` + parameters like the starters.
3. **No name field / duplicate handling** in Apply (see §3.8).
4. **Placeholder substitution is raw string-replace** — no escaping (§4.5), unknown `{{keys}}` left literal. Also support a `{{key:default}}` or make defaults visible in the input placeholder consistently.
5. **Confidence scoring not surfaced** (§5-backend). The Apply modal should warn when a cron won't convert cleanly to a Windows trigger.
6. **Fake upvotes** — either remove the counts or make them real (one click, localStorage-dedup is fine for now).

### Recommended new templates — Coding & Dev Workflow tier
This is where TaskHub can be genuinely differentiated: **templates for developers who automate their machine**. Grouped, with suggested parameters:

**Git & repo hygiene**
| Template | Command sketch | Params |
|---|---|---|
| Git Auto-Commit & Push (WIP backup) | `git -C "{{repoPath}}" add -A && git commit -m "auto: {{message}}" && git push` | repoPath, message, branch |
| Multi-Repo Pull Sweep | `powershell -File sweep.ps1 -Root "{{reposRoot}}"` (loop `git pull` over subdirs) | reposRoot |
| Stale Branch Report | `git -C "{{repoPath}}" for-each-ref --sort=-committerdate refs/heads/ > "{{outFile}}"` | repoPath, outFile |
| Repo Backup (zip to date-stamped archive) | `powershell Compress-Archive "{{repoPath}}" "{{backupDir}}\repo-$(Get-Date -f yyyyMMdd).zip"` | repoPath, backupDir |

**Claude Code / AI-agent automation** *(your highest-value niche — your own 77 tasks are full of these)*
| Template | Command sketch | Params |
|---|---|---|
| **Claude Code Headless Run** | `claude -p "{{prompt}}" --cwd "{{projectPath}}" {{extraFlags}}` | prompt, projectPath, extraFlags |
| Claude Code Skill/Slash-Command Run | `claude -p "/{{skill}} {{args}}" --cwd "{{projectPath}}"` | skill, args, projectPath |
| Nightly AI Code Review | `claude -p "Review yesterday's commits and write findings to REVIEW.md" --cwd "{{repoPath}}"` | repoPath |
| AI Daily Standup Digest | `claude -p "Summarize git log --since=yesterday across {{reposRoot}} into {{outFile}}"` | reposRoot, outFile |
| Scheduled Doc Sync | `claude -p "/update-docs" --cwd "{{repoPath}}"` | repoPath |

**Build / test / quality**
| Template | Command sketch | Params |
|---|---|---|
| Nightly Test Suite | `cmd /c cd /d "{{projectPath}}" && {{testCommand}} > "{{logFile}}" 2>&1` | projectPath, testCommand (default `npm test`), logFile |
| Scheduled Build | `cmd /c cd /d "{{projectPath}}" && {{buildCommand}}` | projectPath, buildCommand |
| Dependency Audit | `cmd /c cd /d "{{projectPath}}" && npm audit --json > "{{outFile}}"` | projectPath, outFile |
| Outdated Dependencies Report | `npm outdated --prefix "{{projectPath}}" > "{{outFile}}"` | projectPath, outFile |
| Lint Sweep | `cmd /c cd /d "{{projectPath}}" && npm run lint` | projectPath |

**Dev environment maintenance**
| Template | Command sketch | Params |
|---|---|---|
| Docker Cleanup | `docker system prune -f --volumes` (params: aggressive y/n) | — |
| node_modules Reaper | PS script deleting `node_modules` older than N days under a root | reposRoot, ageDays |
| Build Artifact Cleanup | delete `dist/`, `bin/`, `obj/`, `.next/` under root older than N days | reposRoot, ageDays |
| Postgres Backup (parameterized properly) | `pg_dump -h {{host}} -U {{user}} -d {{db}} -f "{{backupDir}}\{{db}}-%DATE%.sql"` | host, user, db, backupDir |
| SQLite/Folder Backup to Cloud | `rclone sync "{{srcPath}}" "{{remote}}:{{bucket}}"` | srcPath, remote, bucket |

**Monitoring / glue**
| Template | Command sketch | Params |
|---|---|---|
| Health-Check Ping with Alert | PS: `try { iwr {{url}} } catch { iwr {{ntfyUrl}} -Method POST -Body "DOWN: {{url}}" }` | url, ntfyUrl |
| Dead Man's Switch (healthchecks.io ping) | `curl -fsS {{checkUrl}}` | checkUrl |
| Webhook Trigger (n8n/Zapier) | `curl -X POST "{{webhookUrl}}" -d "{{payload}}"` | webhookUrl, payload |
| Disk Space Alert | PS one-liner: alert if free < N GB | thresholdGb, ntfyUrl |

Notes on the coding tier:
- The **Claude Code Headless Run** template alone probably covers 30% of your real Task Scheduler entries (Edge-Radar, PaxAI, AI-Automation-Library tasks look exactly like this pattern). Make it the flagship.
- Templates that produce output files should default `{{outFile}}`/`{{logFile}}` into a known folder (e.g. `%USERPROFILE%\TaskHub\logs\`) so the future execution-history UI can link to them.
- Consider a `workingDirectory` as a *first-class parameter type* — nearly every dev template needs `cd /d` gymnastics today because the agent runs everything via `cmd.exe /c` from an unspecified cwd. Better: extend `task:create` payload with `{command, args, workingDirectory}` and set it on the Task Scheduler action properly.
- Add a **"multi-line script" parameter type** (textarea) so inline PowerShell/Python templates aren't limited to one-liners.

### Template system — bigger ideas
- **Template packs**: ship the coding tier as a "Developer Pack," keep an "AI Agents Pack," "Backup Pack," "Home Server Pack." Packs give the library structure and a marketing story.
- **Create-from-task** (see §6.5) then **export/import as JSON** → the community-contribution path in Templates.md becomes "share a JSON file / PR to a `templates/` folder" with zero backend work.
- **Post-apply verification**: after `task:created`, immediately query the created task back and show its *actual* Windows trigger next to the requested cron — honest feedback loop until conversion confidence is fully wired.

---

## 8. Optimization Notes (performance)

Nothing is slow today at 77 tasks, but before scale:
- Sync path: batch upserts (§5), and per-connection health/sync loops run sequentially — `Promise.all` them.
- No pagination on `GET /api/tasks` / `GET /api/templates` — fine now, add `take/skip` before multi-hundreds.
- Frontend: set a `staleTime` (e.g. 30s) on the QueryClient to stop refetch-on-mount churn; memoize the repeated `filteredTasks.filter(...)` calls in kanban; both trivial.
- Vite `usePolling: true` burns CPU in local (non-Docker) dev — gate it on an env var.
- Dashboard <2s NFR is comfortably met; keep the bundle lean (only heavy dep is lucide-react, which tree-shakes).

---

## 9. General Direction & Strategy

1. **Sharpen the positioning: "reliability control plane," not "universal scheduler."** The docs already say this — hold the line. Two excellent connectors (Windows + Claude Code) beat six half-connectors. The differentiator versus cron GUIs is *observability + AI-task-awareness*: did it run, did it fail, and can my AI create/inspect tasks.
2. **Re-order Phase 5/6 slightly:** (a) security hardening (§4.1–4) → (b) execution history + failure alerts (§6.1–2) → (c) host backend on Hetzner → (d) MCP server → (e) WiX installer → (f) macOS agent. The MCP server before the installer, because you're the only user right now and MCP multiplies *your* daily value; the installer only matters when other people install it.
3. **Dogfood the template system on your own 77 tasks.** Migrate a handful of the Edge-Radar/PaxAI Claude runs to TaskHub-created tasks via the new Claude Code Headless template. Every friction point you hit is the roadmap.
4. **Honesty in the UI builds trust in an automation tool.** Fake "Online" status, fake upvotes, no-op buttons, and "1/1/1" dates each individually look small, but this is an app whose entire job is telling you the truth about background automation. Recommend a "no fake data" rule for the dashboard.
5. **Docs debt is low — keep it that way.** Two drifts to fix: agent targets net10.0 (docs say .NET 8), and Phase4.md lists agent security tests that don't exist. Update Phase4.md with this analysis's security findings as the audit input it's waiting for.
6. **Repo hygiene**: remove committed `coverage/`, `agent/publish/`, `fix_connection.sql`, stray `src/` and `Gemini_Agent/` at root (or document them); add `.env.example` files for backend and frontend (the frontend currently has no documented way to know about `VITE_DEMO_MODE`).

---

## 10. Prioritized Action Plan

**P0 — before hosting anything (security)**
1. ⬜ WebSocket auth: pairing secret + HMAC handshake; kill `cors: '*'`; fail-fast on missing `JWT_SECRET`. *(Deliberately deferred by Mike — must precede Hetzner hosting.)*
2. ⬜ Wire AES-256-GCM encryption into `PlatformConnection.config` reads/writes.
3. ⬜ Scope all routes to `req.user.id`; remove committed dev JWT from `api.ts` and rotate.

**P1 — correctness (1 sprint)**
4. ✅ Use `scheduler-conversion.ts` in the apply path; send structured triggers; replace the agent's 2-case cron parser; surface confidence in the modal. *(Done 2026-07-07 — plus preview endpoint and the schedule-key fix.)*
5. ⬜ Normalize synced schedules to cron + fix `DateTime.MinValue` → null (fixes Schedule view + "1/1/1" dates). *(Native tasks populate `Task.nextRunTime` properly; synced Windows tasks still don't.)*
6. ⬜ Real system-status panel + honest "last synced" indicator; fix "Sync Now" semantics.
7. ⬜ Zod validation + error middleware; Prisma singleton; batched upserts. *(New native routes validate manually; Zod still not adopted.)*

**P2 — product value (1–2 sprints)**
8. 🟡 Execution history + failure status + (webhook) notifications. *(Run History tab ✅, durations ✅, red "Run failed" indicators ✅ — notifications still open. Note: Windows tasks only log runs triggered through TaskHub; agent-side result reporting for natively-scheduled Windows runs is still open.)*
9. 🟡 Apply modal upgrades: name field ⬜, cron presets ✅ *(in the New Task modal; not yet in Apply)*, human-readable/local-time preview ⬜, `\TaskHub\` folder targeting ✅ *(2026-07-07: agent registers all created tasks under `\TaskHub\`; applies to templates and the New Task modal alike)*.
10. ⬜ Template library UI: category/OS filters, search, starter-vs-pattern grouping; parameterize the 4 Tier-B patterns.
11. ⬜ Ship the **Developer Pack** templates (§7), flagship: Claude Code Headless Run.
12. ⬜ Save-task-as-template.

**New since analysis (not in original plan)**
- ✅ **TaskHub-native tasks (Flavor B)** — backend scheduler + HTTP jobs + connector + create/delete + platform filter UI. See `docs/resources/Native_Tasks.md`. Follow-ups: `CLAUDE_PROMPT` job type, edit schedule for natives, Redis lock before multi-instance.
- ✅ **Platform selector in New Task modal** (2026-07-07) — `CreateTaskModal` creates TaskHub-native *or* Windows tasks; Windows path uses real trigger conversion + live preview warnings and lands under `\TaskHub\`. Also fixed: `POST /api/tasks` (clone path) previously skipped trigger conversion → cloned Windows tasks ran at the wrong time. Found during E2E: agent-created tasks can't be deleted from a non-elevated shell (agent runs elevated) — one more reason to prioritize agent `task:delete` (§5-Agent).

**P3 — expansion**
13. ⬜ MCP server (list/run/create/convert). 14. 🟡 Settings page ⬜ + edit schedule ⬜ + delete task ✅ *(native tasks only)*. 15. ⬜ Frontend refactor (split Dashboard.tsx, router, toasts, modal a11y, mobile drawer). 16. ⬜ macOS agent. 17. ⬜ WiX installer.

---

*Generated by Claude Code analysis session, 2026-07-07. Companion detail lives in the exploration notes; all file:line references verified against the working tree at commit `2fb6849`.*
