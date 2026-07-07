# Phase 3: Development (MVP)

**Duration:** 8–12 weeks
**Status:** **Complete (Sprints 1-10 complete)**
**Master plan:** [`Project_Plan.md`](../Project_Plan.md)
**Predecessor:** [`Phase2.md`](Phase2.md)
**Informed by:** [`Business_Idea_Assessment.md`](Business_Idea_Assessment.md)

## Goal

Ship a working MVP that lets a single user:
1.  Connect their Windows machine (via agent).
2.  Connect their Claude / ChatGPT accounts (via API/Web).
3.  See all their scheduled tasks in one dark-themed dashboard.
4.  Trigger a task manually from the web.
5.  Receive a browser notification when a task fails.

---

## Sprints

### Sprint 1: Backend Foundation (Complete)
**Outcomes**
- ✅ Express + TypeScript project scaffold (`backend/`) with Prisma client generated.
- ✅ PostgreSQL via Docker Compose; migrations checked in.
- ✅ JWT Auth (Access Tokens, middleware, routes).
- ✅ Encryption helpers (`encryptConfig` / `decryptConfig`) using AES-256-GCM.
- ✅ Health-check endpoint `/api/health`.

### Sprint 2: Windows Agent (Complete)
**Outcomes**
- ✅ .NET Console application that communicates with Backend via Socket.IO.
- ✅ Can list all Windows Scheduled Tasks.
- ✅ Can trigger a specific task by path.
- ✅ Can create a new task definition from JSON.

### Sprint 3: Frontend Scaffold (Complete)
**Outcomes**
- ✅ Vite + React + Tailwind + Lucide Icons.
- ✅ Sidebar navigation (Dashboard, Platforms, Settings).
- ✅ Dark theme base with blue accents.

### Sprint 4: The Sync Engine (Complete)
**Outcomes**
- ✅ Real-time WebSocket bridge between Frontend and Agent via Backend.
- ✅ Manual "Sync Now" button triggers agent scan.
- ✅ Tasks persisted to Postgres on first sync.

### Sprint 5: Task Dashboard (Complete)
**Outcomes**
- ✅ Card grid showing task name, status, next run time, and platform.
- ✅ "Run Now" button on cards.
- ✅ Search bar to filter by name/path.

### Sprint 6: Notifications & Logs (Complete)
**Outcomes**
- ✅ Execution logs table for each task.
- ✅ Toast notifications on frontend for success/failure.

### Sprint 7: Templates & Categorization (Complete)
**Outcomes**
- ✅ Templates visible in both local and demo app.
- ✅ **Applying a template to Windows creates an actual scheduled task.**
- ✅ **Tasks can be moved between local categories and filtered via tabs.**
- ✅ **Native folder structures are imported as initial categories during first sync.**

### Sprint 8: Testing & Hardening (Complete)
**Outcomes**
- ✅ **Set up Vitest testing framework.**
- ✅ **Implemented encryption helpers with 100% unit test coverage.**
- ✅ **Implemented JWT Auth (Access Tokens, middleware, routes).**
- ✅ **Implemented Platforms Tab with official and custom links.**

### Sprint 9: Selective Import & System Filtering (Complete)
**Outcomes**
- ✅ **Initial Dashboard state:** Dashboard remains empty until an explicit import is performed.
- ✅ **Import Filter Modal:** New UI to select categories before syncing to the database.
- ✅ **Default Filters:** "Microsoft" and "Uncategorized" tasks are deselected by default.
- ✅ **Persistence:** Filter preferences and categories dynamically populate via the `/discover` endpoint.

### Sprint 10: Template Catalog Expansion (Complete)
**Outcomes**
- ✅ **Two-tier template catalog** — curated *script starters* (Tier A) alongside *use-case patterns* (Tier B). Full spec in [`resources/Templates.md`](resources/Templates.md).
- ✅ **20 script starters seeded** across Windows, macOS, and cross-platform runtimes (PowerShell, Batch, Python, Node, Bash/zsh, AppleScript, VBScript, HTTP, executable, Claude/ChatGPT).
- ✅ **`Template` schema extended** — `scriptType`, `os`, `category`, `commandTemplate`, `parameters` (JSON), `isStarter`, `icon`; new `ScriptType` / `OsTarget` / `TemplateCategory` enums and `MACOS_LAUNCHD` platform (migration `20260610000000_add_template_catalog_fields`).
- ✅ **Functional Apply modal** — pick target platform, confirm cron schedule, fill `{{placeholder}}` parameters with a live resolved-command preview; `POST /templates/:id/apply` accepts the resolved command/schedule/name and rejects unfilled placeholders.
- ⏭️ **Deferred:** macOS starters are catalog-only until a macOS agent ships; card filter chips / OS badges and cron↔trigger confidence scoring remain.

---

## Phase 3 Exit Criteria

- [x] All 10 sprints' DoD met. (Sprints 1-10 complete)
- [x] CI verified green locally. (Workflow defined; backend builds/tests, frontend lints/builds, agent builds successfully)
- [x] CI green on remote branches (GitHub Actions workflow configured & passing on push).
- [ ] Staging deploy reachable (pending Hetzner VPS backend setup).
- [x] Test coverage on the connector layer ≥ 80% (Currently ~97% based on Vitest baseline).
- [ ] Lighthouse desktop + mobile scores ≥ 90 on `/dashboard` (pending staging deploy).
- [ ] Windows agent has a signed installer (pending WiX installer).
- [ ] Sync reliability ≥ 95% (pending E2E/network soak testing).

→ Advance to **[Phase 4: Testing & QA](Phase4.md)**.
