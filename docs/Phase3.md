# Phase 3: Development (MVP)

**Duration:** 8–12 weeks
**Status:** **Active (Sprints 1-8 complete)**
**Master plan:** [`Project_Plan.md`](Project_Plan.md)
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

### Sprint 9: Selective Import & System Filtering (Active)
- [ ] **Initial Dashboard state:** Dashboard remains empty until an explicit import is performed.
- [ ] **Import Filter Modal:** New UI to select categories before syncing to the database.
- [ ] **Default Filters:** "Microsoft" and "Uncategorized" tasks are deselected by default.
- [ ] **Persistence:** Filter preferences are saved per platform connection.

---

## Phase 3 Exit Criteria

- [ ] All 9 sprints' DoD met.
- [ ] CI green on `main`.
- [ ] Staging deploy reachable.
- [ ] Test coverage on the connector layer ≥ 80%.
- [ ] Lighthouse desktop + mobile scores ≥ 90 on `/dashboard`.
- [ ] Windows agent has a signed installer.
- [ ] Sync reliability ≥ 95%.

→ Advance to **[Phase 4: Testing & QA](Phase4.md)**.
