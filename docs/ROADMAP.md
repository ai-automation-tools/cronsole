# TaskHub Roadmap

> The living plan for TaskHub — what's shipped and what's next, in priority order.
> This replaces the phase-based planning docs, which are preserved in
> [`archive/`](archive/) ([`Project_Plan.md`](archive/Project_Plan.md) +
> [`phases/`](archive/phases/)) as the historical record of how the MVP was built.
> Detailed findings behind many open items live in the 2026-07-07 project analysis
> (`.claude/temp/TaskHub_Analysis_2026-07-07.md`).

**Update rule:** when a task ships, move it to Completed with a date; when a material
decision changes scope, edit the item here first, then implement.

*Last updated: 2026-07-07 (added: task search, user resources/onboarding, installer packages).*

---

## ✅ Completed

### Foundation — MVP build-out (Phases 0–3, Jan–Jun 2026, archived)

- Discovery, requirements, architecture, and competitive research ([`archive/phases/`](archive/phases/), [`research/`](research/)).
- **Windows Task Scheduler end-to-end**: .NET agent ↔ Socket.io backend ↔ Prisma/Postgres ↔ React dashboard; manual run trigger; enable/disable.
- **Dashboard UX**: dark theme, 4 view modes (grid/list/kanban/schedule), category chips with counts, selective import with local category overrides, task cloning, Help Center.
- **Template library**: two-tier catalog (20 script starters + use-case patterns), Apply modal with `{{placeholder}}` parameters and client+server validation.
- Auth scaffold (JWT), Docker Compose dev stack, Vercel demo deployment (`taskhub.mikesailab.com`, `VITE_DEMO_MODE`), GitHub Actions CI, unit test suites across backend (Vitest) / frontend (RTL) / agent (xUnit).

### Reliability & product sprint (July 2026)

- **Real cron→Windows-trigger conversion** wired end-to-end (apply route → structured `trigger` → agent `TriggerBuilder`), with preview endpoints and live confidence warnings. *(2026-07-07)*
- **TaskHub-native tasks**: backend scheduler (30s tick, missed-run grace), HTTP job executor, connector, create/delete, violet identity + dashboard platform filter ([`resources/Native_Tasks.md`](resources/Native_Tasks.md)). *(2026-07-07)*
- **Run history & failure surfacing**: Run History tab (status, timestamp, duration, log snippet); red "Run failed" indicators on cards/list. *(2026-07-07)*
- **Stale-task pruning on sync**: tasks deleted natively no longer linger in TaskHub. *(2026-07-07)*
- **Agent reconnect resilience**: 30s watchdog survives backend restarts and boot-order races; startup task registered with no 72h execution limit and safe re-publish. *(2026-07-07)*
- **Platform selector in New Task modal**: create TaskHub-native *or* Windows tasks ad-hoc; Windows tasks land under the `\TaskHub\` scheduler folder; clone-flow trigger conversion fixed. *(2026-07-07)*
- **Task search on the dashboard**: free-text search across name/category/path/command/schedule with multi-term narrowing, match counter, `/` shortcut, Esc-to-clear; composes with the category/platform/active filters and all four views. *(2026-07-07)*
- Docs restructure: post-reorg links fixed, .NET 10 alignment, contracts kept in sync with implementation.

---

## 🔴 P0 — Security hardening (blockers before hosting the backend)

Nothing below ships to a public host until these are done (analysis §4):

- [ ] **WebSocket auth**: pairing-secret handshake on `agent:hello`, per-session HMAC on `task:run`/`task:create`, reject unauthenticated sockets, restrict Socket.io CORS (today: any process reaching port 3000 gets remote command execution).
- [ ] **Encrypt `PlatformConnection.config` at rest** — wire the existing (tested) AES-256-GCM helpers into every config read/write.
- [ ] **Multi-tenancy basics**: scope all routes to `req.user.id` (no cross-user reads/IDOR), fail-fast on missing `JWT_SECRET`, remove + rotate the committed dev JWT in `frontend/src/api.ts`.
- [ ] **Command handling**: per-OS escaping of template parameters; agent builds actions from structured `{executable, args[]}` instead of one `cmd.exe /c` string.
- [ ] Agent config file/env for server URL + WSS support (hardcoded `http://localhost:3000` today).

## 🟠 P1 — Correctness & honesty

- [ ] **Normalize synced Windows schedules to cron** (fixes "No direct schedule" in Schedule view) and map `DateTime.MinValue` → null (fixes "1/1/1" dates).
- [ ] **Real system-status panel** driven by `/api/health` or a browser socket (sidebar "Agent Online" is currently hardcoded), plus a "last synced N ago" chip; make "Sync Now" semantics honest (today it opens the Import modal).
- [ ] **Browser live updates**: connect the frontend to Socket.io and invalidate `['tasks']` on `task:updated` (per CLAUDE.md §9 convention).
- [ ] Backend hygiene: Zod validation at boundaries + one error middleware, shared Prisma singleton, batched sync upserts.
- [ ] **Remaining QA** (from archived Phase 4): integration suite against real Postgres, Playwright E2E flows, resilience/soak tests, security audit + performance report.

## 🟡 P2 — Product value

- [ ] **Failure notifications**: push on failed runs via ntfy/Discord webhook/email — the core "did my stuff run last night?" pain.
- [ ] **Agent `task:delete`**: the one CRUD op fully missing (also needed because agent-created tasks require elevation to delete by hand).
- [ ] **User resources & onboarding**: surface help content where users need it — link the existing guides ([`user-guides/UI_User_Guide.md`](user-guides/UI_User_Guide.md), [`user-guides/Agent_Setup_Guide.md`](user-guides/Agent_Setup_Guide.md)) and the template catalog spec ([`resources/Templates.md`](resources/Templates.md)) from the in-app Help Center; add a "getting started" walkthrough covering importing, categorizing, and managing tasks, and where to find/contribute templates.
- [ ] **Apply modal upgrades**: task-name field (avoid duplicate-name collisions), cron preset chips, human-readable + local-time schedule preview.
- [ ] **Template library UI**: category/OS filter chips, search, starter-vs-pattern grouping; parameterize the 4 Tier-B patterns; real (or removed) upvotes.
- [ ] **Developer Pack templates** (analysis §7): git hygiene, build/test, dev-environment maintenance, monitoring glue — flagship: **Claude Code Headless Run**.
- [ ] **Save task as template** — grow the catalog from real tasks.
- [ ] **Edit schedule** (button exists, is a no-op) and a real **Settings page** (backend URL, timezone display, agent pairing).
- [ ] Native tasks follow-ups: `CLAUDE_PROMPT` job type, edit schedule, Redis lock before multi-instance.

## 🟢 P3 — Expansion

- [ ] **Host the backend** (planned: Hetzner VPS) + set Vercel `VITE_API_URL` → turn the public demo into a real control plane. *(After P0.)*
- [ ] **MCP server**: `list_tasks` / `run_task` / `create_task_from_template` / `convert_schedule` — highest-leverage Phase-6 item; thin wrapper over existing routes. Sequenced before the installer.
- [ ] **Frontend refactor**: split `Dashboard.tsx` (1,100+ lines), add a router (deep links to `/tasks/:id`, `/templates/:id`), toasts instead of `alert()`, modal a11y (Escape/focus trap), mobile sidebar drawer (<375px requirement).
- [ ] **macOS agent** (launchd) — 7 catalog templates already wait on it; `ITaskScheduler` abstraction ports cleanly.
- [ ] **Installer packages**: standard signed Windows Installer (`.msi` via WiX) for the agent, replacing the PowerShell setup script; matching packages for other OSes as their agents land (macOS `.pkg`/Homebrew once the launchd agent exists). Matters once there are users beyond Mike.
- [ ] Claude Code connector: promote from experimental scaffold to production-ready.
- [ ] ChatGPT stays quick-links-only unless a public automations API appears.

---

## Open decisions

- [ ] Final hosting choice: Hetzner VPS (leading) vs. Render vs. AWS ECS.
- [ ] Agent transport: WebSocket only, or hybrid with long-polling for restricted networks?

## Strategy guardrails (from the 2026-07-07 analysis)

- **Reliability control plane, not universal scheduler** — two excellent connectors beat six half-connectors; new connectors unlock only when sync reliability >95% and crash rate <2% hold.
- **No fake data in the UI** — an automation tool earns trust by telling the truth (status panels, upvotes, dates).
- **Dogfood**: migrate real Task Scheduler jobs onto TaskHub-created tasks; every friction point is roadmap input.
