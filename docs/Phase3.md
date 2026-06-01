# Phase 3: Development (MVP)

**Duration:** 8–12 weeks
**Status:** **Active (Sprints 1-6 mostly complete)**
**Master plan:** [`Project_Plan.md`](Project_Plan.md)
**Predecessor:** [`Phase2.md`](Phase2.md)
**Informed by:** [`Business_Idea_Assessment.md`](Business_Idea_Assessment.md)

---

> **Build order (per the assessment).** Build the **reliability control plane**, not a workflow builder. The "first features that matter most" are: unified inventory + status normalization, one-click run/enable/disable with confirmations, execution timeline + failure alerting, connector health diagnostics, and template conversion with a confidence score. **Advanced workflow building and broad platform parity are explicitly out of this phase** — adding a third connector before the Windows + Claude pair holds its sync-reliability and crash-rate KPIs is a scope-creep regression (R7).

## Goal

Ship a working MVP that lets a single user:

1. Connect a Windows machine (via local agent) and a Claude Code account (via API key) — **in under 15 minutes total**.
2. See every scheduled task from both platforms in one dark-themed dashboard, **with normalized status and per-connector health**.
3. Manually trigger a Windows task from a phone in under 30 seconds, **with a confirmation and a logged execution-timeline entry**.
4. Enable/disable any task one-click (with confirmation).
5. Apply one of 5–10 prebuilt schedule templates to create a task on either platform, **seeing a conversion confidence score before applying**.

---

## Deliverables

- ✅ Functional MVP web app with Dashboard.
- ✅ .NET 8 Windows agent with status management support.
- ✅ Backend refactored to TypeScript with Connector Registry.
- ✅ **ClaudeConnector** implemented for routines.
- ✅ **WindowsAgentConnector** implemented with WebSocket.
- ✅ **One-click run / enable / disable, each behind a confirmation dialog (WIP for enable/disable).**
- ✅ **Task normalization** via TaskService.
- ✅ Template library seed data prepared.
- ✅ Manual run trigger (Windows + Claude).
- ✅ Dark theme dashboard wired to live data.
- ✅ Postgres schema migrated through Prisma.

---

## Sprint Breakdown (~2 weeks per sprint)

### Sprint 1–2: Backend Core

**Outcomes**
- ✅ Express + TypeScript project scaffold (`backend/`) with Prisma client generated.
- ✅ PostgreSQL via Docker Compose; migrations checked in.
- [ ] JWT auth (access + refresh in httpOnly cookies); register / login / refresh / logout routes. (Currently using placeholder user).
- [ ] Encryption helpers (`encryptConfig` / `decryptConfig`) using AES-256-GCM.
- ✅ Health-check endpoint `/api/health`.

**Definition of Done**
- ✅ `npm run build` succeeds for backend.
- ✅ Basic task listing and triggering works.

### Sprint 3–4: Platform Integrations

**Outcomes**
- ✅ `PlatformConnector` interface + registry pattern in `backend/src/connectors/`.
- ✅ **`WindowsAgentConnector`** — refactored to use registry and Socket.io.
- ✅ **`ClaudeConnector`** — implemented using experimental 2026 API.
- ✅ Windows agent (`agent/`): Updated to support `task:set_status` and improved communication.

**Definition of Done**
- ✅ `dotnet build` succeeds for agent.
- ✅ Both connectors registered in `connectorRegistry`.

### Sprint 5: Real-Time Sync + Manual Run Trigger

**Outcomes**
- ✅ Server pushes `task:run` and `task:set_status` over WebSocket.
- [ ] `ExecutionLog` rows written for every trigger attempt. (WIP in routes).
- [ ] **Connector health diagnostics** endpoint.
- ✅ Backend rebroadcasts updates to subscribed frontend clients via Socket.io.

**Definition of Done**
- ✅ Triggering a Windows task from browser works with confirmation.

### Sprint 6: Frontend Dashboard

**Outcomes**
- ✅ React 18 + Vite project in `frontend/`.
- ✅ Dashboard with task cards and confirmation dialogs.
- ✅ Sidebar and Tab navigation.
- ✅ Theme is dark by default.

**Definition of Done**
- ✅ `npm run build` succeeds for frontend.

### Sprint 7: Template Library (Next)

**Outcomes**
- ✅ `templates` table seeded with 4 examples.
- [ ] Template list page build-out.
- [ ] Schedule conversion logic implementation.

### Sprint 8: Testing & Hardening (Pending)

---

## Phase 3 Exit Criteria

- [ ] All 8 sprints' DoD met.
- [ ] CI green on `main`.
- [ ] Staging deploy reachable.
- [ ] Test coverage on the connector layer ≥ 80%.
- [ ] Lighthouse desktop + mobile scores ≥ 90 on `/dashboard`.
- [ ] Windows agent has a signed installer.
- [ ] Sync reliability ≥ 95%.

→ Advance to **[Phase 4: Testing & QA](Phase4.md)**.
