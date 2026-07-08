# TaskHub Roadmap

> The living plan for TaskHub — what's shipped and what's next, in priority order.
> This replaces the phase-based planning docs (the original `Project_Plan.md` and the
> per-phase deep-dives), which are kept locally under `docs/archive/` as the historical
> record of how the MVP was built — that folder is **not tracked in git**.
> Detailed findings behind many open items live in the 2026-07-07 project analysis
> (`.claude/temp/TaskHub_Analysis_2026-07-07.md`).

**Update rule:** when a task ships, move it to Completed with a date; when a material
decision changes scope, edit the item here first, then implement.

*Last updated: 2026-07-08 (added: README visual overhaul with banner logo + live screenshots; docs hub "Start here" path).*

---

## ✅ Completed

### Foundation — MVP build-out (Phases 0–3, Jan–Jun 2026, archived)

- Discovery, requirements, architecture, and competitive research (archived locally under `docs/archive/`).
- **Windows Task Scheduler end-to-end**: .NET agent ↔ Socket.io backend ↔ Prisma/Postgres ↔ React dashboard; manual run trigger; enable/disable.
- **Dashboard UX**: dark theme, 4 view modes (grid/list/kanban/schedule), category chips with counts, selective import with local category overrides, task cloning, Help Center.
- **Template library**: two-tier catalog (20 script starters + use-case patterns), Apply modal with `{{placeholder}}` parameters and client+server validation.
- Auth scaffold (JWT), Docker Compose dev stack, Vercel demo deployment (`taskhub.mikesailab.com`, `VITE_DEMO_MODE`), GitHub Actions CI, unit test suites across backend (Vitest) / frontend (RTL) / agent (xUnit).

### Reliability & product sprint (July 2026)

- **Real cron→Windows-trigger conversion** wired end-to-end (apply route → structured `trigger` → agent `TriggerBuilder`), with preview endpoints and live confidence warnings. *(2026-07-07)*
- **TaskHub-native tasks**: backend scheduler (30s tick, missed-run grace), HTTP job executor, connector, create/delete, violet identity + dashboard platform filter (design doc archived locally under `docs/archive/specs/`). *(2026-07-07)*
- **Run history & failure surfacing**: Run History tab (status, timestamp, duration, log snippet); red "Run failed" indicators on cards/list. *(2026-07-07)*
- **Stale-task pruning on sync**: tasks deleted natively no longer linger in TaskHub. *(2026-07-07)*
- **Agent reconnect resilience**: 30s watchdog survives backend restarts and boot-order races; startup task registered with no 72h execution limit and safe re-publish. *(2026-07-07)*
- **Platform selector in New Task modal**: create TaskHub-native *or* Windows tasks ad-hoc; Windows tasks land under the `\TaskHub\` scheduler folder; clone-flow trigger conversion fixed. *(2026-07-07)*
- **Task search on the dashboard**: free-text search across name/category/path/command/schedule with multi-term narrowing, match counter, `/` shortcut, Esc-to-clear; composes with the category/platform/active filters and all four views. *(2026-07-07)*
- **Standard dark/light/system theme system**: replaced the hardcoded blue-tinted palette with a neutral-surface semantic token set wired into Tailwind v4 (`@theme inline` + `.light`/`.dark` CSS-variable overrides). Added a `useTheme` hook (persists to `localStorage` `taskhub.theme`, follows the OS in *system* mode), a `ThemeToggle` (Light/Dark/System) in the sidebar, and a FOUC-preventing bootstrap in `index.html`. ~210 hardcoded `slate-*`/`blue-*`/`text-white` utility classes across 13 files migrated to `background`/`surface`/`muted`/`border`/`foreground`/`primary` tokens. Accent scheme: **violet** `primary` for primary actions (New Task, Sync Now, active tabs/chips) and **emerald** `success` for Run/execute buttons; native-task violet identity + red/green status colors retained. Neutral surfaces flip between light and dark; dark remains the default. *(2026-07-07)*
- Docs restructure: post-reorg links fixed, .NET 10 alignment, contracts kept in sync with implementation.
- **README visual overhaul**: Command Grid banner logo wired into the hero (`images/TaskHub-Images/`), real app screenshots captured from the current build (`images/screenshots/` — dashboard, templates, task detail, light theme), quick-nav link row (docs / demo / issues), numbered Quick Start with back-to-top links, collapsible screenshots section; docs hub gained a numbered "Start here" path. *(2026-07-08)*

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
- [ ] **User resources & onboarding**: surface help content where users need it — link the existing guides ([`user-guides/UI_User_Guide.md`](user-guides/UI_User_Guide.md), [`user-guides/Agent_Setup_Guide.md`](user-guides/Agent_Setup_Guide.md)) and the template catalog spec ([`reports/templates/Templates.md`](reports/templates/Templates.md)) from the in-app Help Center; add a "getting started" walkthrough covering importing, categorizing, and managing tasks, and where to find/contribute templates.
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

## 🚀 Go-public checklist — public repo + advertisable product

Everything required before the repo flips public and TaskHub is promoted beyond personal use. All of **P0 is a hard prerequisite**; P1 correctness and the P2 onboarding/resources item are strongly recommended first.

### Repo goes public

- [ ] **License decision** — the current `LICENSE` is proprietary/all-rights-reserved. Choose: open source (MIT/Apache-2.0), source-available (BSL/fair-source), or public product with private code. Blocks everything below.
- [ ] **Secret & history audit**: scan full git history (gitleaks/trufflehog) — the dev JWT was committed and must be rotated regardless; scrub personal machine paths, real task names, and account identifiers from docs, seeds, fixtures, and screenshots. If history can't be cleaned confidently, squash to a fresh public root.
- [ ] **Repo hygiene for outsiders**: remove committed artifacts (`coverage/`, stray `src/`, `Gemini_Agent/`, `fix_connection.sql`); add `.env.example` for backend and frontend; make `main` the clean default branch with branch protection.
- [ ] **Community scaffolding**: `SECURITY.md` (vulnerability disclosure policy — non-negotiable for a tool that executes commands), issue/PR templates, `CODE_OF_CONDUCT.md`, GitHub Discussions or a support contact; CI status badges on the README.
- [ ] **Final README/docs pass for a stranger audience** (github-readme skill): quick-start that works on a machine that isn't Mike's, screenshots/GIF of the dashboard, honest feature-status table.
- [ ] **Name check**: verify "TaskHub" is defensible for advertising (existing products/repos share the name); decide whether to rebrand before the first public link, not after.

### Application goes public

- [ ] **Real account system**: registration/login UI, password reset, JWT refresh flow end-to-end, session management; full multi-tenant isolation (extends P0 route scoping) with a per-user **agent pairing flow** (pairing code UI ↔ agent config).
- [ ] **Production operations**: error tracking (e.g. Sentry), structured logs, uptime monitoring + status page, automated Postgres backups with a tested restore, rate limiting on auth and API, staging environment + deploy pipeline (CI → staging → prod).
- [ ] **Agent distribution & trust**: signed installer (see Installer packages above), code-signing certificate to clear SmartScreen, versioned releases with an update channel, and a documented "what the agent can do / how to remove it" trust page — critical for a tool that runs with elevated privileges.
- [ ] **Legal minimum**: privacy policy + terms of service, account deletion (and data export) that actually purges tasks/logs, cookie handling on the hosted site.
- [ ] **Launch surface**: landing page at `taskhub.mikesailab.com` (marketing content + demo + agent download + docs), getting-started guide (builds on the P2 onboarding item), and a support/feedback channel.
- [ ] **Versioning & releases**: semver + tagged releases + changelog discipline (already started) so advertised versions are reproducible.

---

## Open decisions

- [ ] Final hosting choice: Hetzner VPS (leading) vs. Render vs. AWS ECS.
- [ ] Agent transport: WebSocket only, or hybrid with long-polling for restricted networks?
- [ ] **License model** for the public repo (open source vs. source-available vs. closed) — see Go-public checklist.
- [ ] **Keep the "TaskHub" name** or rebrand before the first public announcement?

## Strategy guardrails (from the 2026-07-07 analysis)

- **Reliability control plane, not universal scheduler** — two excellent connectors beat six half-connectors; new connectors unlock only when sync reliability >95% and crash rate <2% hold.
- **No fake data in the UI** — an automation tool earns trust by telling the truth (status panels, upvotes, dates).
- **Dogfood**: migrate real Task Scheduler jobs onto TaskHub-created tasks; every friction point is roadmap input.
