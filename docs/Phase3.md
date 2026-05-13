# Phase 3: Development (MVP)

**Duration:** 8–12 weeks
**Status:** Not started
**Master plan:** [`Project_Plan.md`](Project_Plan.md)
**Predecessor:** [`Phase2.md`](Phase2.md)

---

## Goal

Ship a working MVP that lets a single user:

1. Connect a Windows machine (via local agent) and a Claude Code account (via API key).
2. See every scheduled task from both platforms in one dark-themed dashboard.
3. Manually trigger a Windows task from a phone in under 30 seconds.
4. Apply one of 5–10 prebuilt schedule templates to create a task on either platform.

---

## Deliverables

- ✅ Functional MVP web app deployed to staging.
- ✅ Signed Windows agent installer (`.msi`).
- ✅ User-auth flow (register, login, refresh).
- ✅ Dashboard with platform status, unified task list, and per-task quick actions.
- ✅ Template library with 5–10 working templates.
- ✅ Manual run trigger (Windows + Claude where API allows).
- ✅ Dark theme persisting across sessions.
- ✅ Postgres schema migrated through Prisma.
- ✅ Test suite covering the connector layer and run-trigger flow.

---

## Sprint Breakdown (~2 weeks per sprint)

### Sprint 1–2: Backend Core

**Outcomes**
- Express + TypeScript project scaffold (`backend/`) with Prisma client generated.
- PostgreSQL via Docker Compose; migrations checked in.
- JWT auth (access + refresh in httpOnly cookies); register / login / refresh / logout routes.
- Encryption helpers (`encryptConfig` / `decryptConfig`) using AES-256-GCM.
- Logger (`pino`) with request-ID middleware.
- Health-check endpoint `/healthz`.
- CI: lint + typecheck + test workflow.

**Definition of Done**
- `docker compose up` boots Postgres + backend; `/healthz` returns 200.
- Register → login → refresh works against a real DB via integration test.

### Sprint 3–4: Platform Integrations

**Outcomes**
- `PlatformConnector` interface + registry pattern in `backend/src/connectors/`.
- **`WindowsAgentConnector`** — server side of the WebSocket protocol from Phase 2; signs commands with per-session HMAC.
- **`ClaudeConnector`** — wraps the Anthropic API for listing routines (read) and triggering runs (write, where supported).
- Windows agent (`agent/`): .NET 8 BackgroundService, `TaskScheduler` COM wrapper, WebSocket client with exponential-backoff reconnect, heartbeat.
- Pairing flow: backend issues `pairingSecret`; agent exchanges it for a session token on first `agent:hello`.

**Definition of Done**
- A real Windows machine running the agent shows up in the backend's connected-agents list.
- `GET /tasks` returns merged Windows + Claude task list for the authed user.

### Sprint 5: Real-Time Sync + Manual Run Trigger

**Outcomes**
- Server pushes `task:run` over WebSocket; agent executes and replies with `task:executed`.
- `ExecutionLog` rows written for every trigger attempt.
- Backend rebroadcasts updates to subscribed frontend clients via Socket.io.
- React Query invalidation hooks for `task:updated` / `task:executed`.

**Definition of Done**
- Triggering a Windows task from a second machine's browser executes it within 5 seconds (LAN).
- Failed runs surface a toast with the error string from the agent.

### Sprint 6: Frontend Dashboard

**Outcomes**
- React 18 + Vite project in `frontend/`, Tailwind configured with `darkMode: 'class'`.
- shadcn/ui base components: Button, Card, Dialog, Toast, Table.
- Pages: `/login`, `/register`, `/dashboard`, `/templates`, `/settings`, `/task/:id`.
- `PlatformStatusBar`, `TaskTable`, `TaskRow`, `TaskDetailModal`, `FloatingActionButton`.
- Theme toggle persists to `localStorage` (key: `taskhub.theme`); defaults to **dark**.
- Mobile breakpoint < 375px: task table collapses to stacked cards.

**Definition of Done**
- Lighthouse mobile score ≥ 90 on `/dashboard`.
- Cypress (or Playwright) smoke test: login → see tasks → click "Run" → see toast.

### Sprint 7: Template Library

**Outcomes**
- `templates` table seeded with 5–10 cross-platform examples (see `data/templates.seed.ts`).
- Template list page with search + filter by source platform.
- "Apply" flow: pick target platform → preview converted schedule → confirm → task created.
- Conversion logic in `backend/src/services/scheduleConverter.ts` (cron ↔ Windows trigger ↔ Claude cron passthrough).

**Definition of Done**
- Applying a "Daily backup at 3 AM" template to Windows creates an actual scheduled task on the user's machine, visible in `taskschd.msc`.

### Sprint 8: Testing & Hardening

**Outcomes**
- Unit tests for `scheduleConverter`, encryption helpers, connector registry.
- Integration tests for `/tasks/:id/run` happy path + failure modes (agent offline, task not found, agent rejects HMAC).
- E2E (Playwright) for the trigger-from-mobile flow on a real Android viewport.
- Load test: 100 concurrent users hitting `/tasks` (target: p95 < 500ms).
- Bug bash + fix sweep.
- Staging deploy.

**Definition of Done**
- All exit criteria below met.

---

## Tech Stack (recap from Phase 0)

| Area | Tech |
|---|---|
| Frontend | React 18 + TS + Vite + Tailwind + shadcn/ui + TanStack Query |
| Backend | Node.js + Express + TypeScript + Prisma |
| DB | PostgreSQL 16 |
| Real-time | Socket.io + native WebSocket on agent |
| Agent | .NET 8 (C#) + `Microsoft.Win32.TaskScheduler` |
| Auth | JWT + httpOnly refresh cookie |
| Dev hosting | Docker Compose |

---

## Subagent / Skill Playbook

Use these proactively per sprint (see [`../CLAUDE.md`](../CLAUDE.md) §6–7 for the full list):

- **Sprints 1–4 (backend + agent):** `backend-designer`, `api-designer`, `code-reviewer`.
- **Sprint 5 (real-time):** `fullstack-developer` for the end-to-end trace.
- **Sprint 6 (frontend):** `frontend-designer` for layout, `frontend-developer` for build-out, `ui-design-system` for tokens, `mobile-design` for the mobile target.
- **Sprint 7 (templates + conversion):** `fullstack-developer`.
- **Sprint 8 (testing):** `senior-qa`, `security-review`.
- Throughout: `context7` MCP for current library docs; `code-reviewer` skill before merging non-trivial PRs.

---

## Phase 3 Exit Criteria

- [ ] All 8 sprints' DoD met.
- [ ] CI green on `main`.
- [ ] Staging deploy reachable; both connectors smoke-tested against real platforms.
- [ ] Test coverage on the connector layer ≥ 80%.
- [ ] Lighthouse desktop + mobile scores ≥ 90 on `/dashboard`.
- [ ] Windows agent has a signed installer and registers itself as an auto-start service.

→ Advance to **[Phase 4: Testing & QA](Phase4.md)**.
