# Unified Scheduled Task Management System — Project Plan

> Master overview. For deep dives, see the per-phase docs below.

## Project Goal

Build a modern, dark-themed web application that provides a single pane of glass — a **control plane** — for *seeing, triggering, and trusting* scheduled tasks across Windows Task Scheduler, Claude Code Routines, ChatGPT Automations, Jules scheduled tasks, Open Claw, Hermes, and future systems. Includes quick links, cross-platform conversion templates, and MCP-based AI integration.

> **Strategic direction** (from the independent viability assessment, [`Business_Idea_Assessment.md`](Business_Idea_Assessment.md), 2026-05-14):
> - **Position as a control plane** — visibility + triggering + reliability — **not** a universal workflow builder.
> - **MVP is a 2-platform reliability control plane** (Windows + Claude). Every other platform is roadmap language, not an implementation expectation.
> - **Compete on connector quality, normalized observability, and trust** — *"high-confidence integrations," not "supports everything."*
> - **Reliability-gated roadmap:** new connectors/features unlock only after the existing set holds its reliability KPIs (sync > 95%, crash < 2%). Scope creep is the #1 execution risk.     
> - **MCP stays Phase 6**, pitched "coming soon" until production-ready.
>
> See each phase doc's "Informed by" header for how these recommendations were folded in.

## Phase Index

| Phase | Doc | Duration | Status |
|---|---|---|---|
| 0 — Inception & Discovery | [`Phase0.md`](Phase0.md) | 1–2 wk | **Complete** |
| 1 — Requirements & Specs | [`Phase1.md`](Phase1.md) | 2–3 wk | **Complete** |
| 2 — Architecture & Design | [`Phase2.md`](Phase2.md) | 2 wk | **Complete** |
| Phase 3 — Development (MVP) | [`Phase3.md`](Phase3.md) | 8–12 wk | **Complete (Sprints 1-10 complete; exit criteria mapped to staging/E2E)** |
| 4 — Testing & QA | [`Phase4.md`](Phase4.md) | 2–3 wk | **Active (Unit Testing & Template Validation Complete; Integration & E2E Active)** |
| 5 — Deployment & Rollout | [`Phase5.md`](Phase5.md) | 1–2 wk | Not started |
| 6 — Post-Launch & Iteration | [`Phase6.md`](Phase6.md) | ongoing | Not started |

Also: [`api-examples/`](api-examples/) — sample request/response payloads.

Strategic assessment: [`Business_Idea_Assessment.md`](Business_Idea_Assessment.md).

---

## Phase 0: Inception & Discovery
**Duration:** 1–2 weeks

### Deliverables
- Project charter (vision, scope, success metrics, stakeholders)
- High‑level risk assessment (API limitations, platform auth, sync frequency)
- Initial tech stack selection (React/TypeScript + Node.js + PostgreSQL + Docker)
- MVP vs. feature‑complete roadmap
- Competitive landscape analysis ([`Competition_Analysis.md`](Competition_Analysis.md))

### Key Activities
- Validate feasibility of controlling Windows Task Scheduler via remote API (WinRM / custom agent)
- Research each target platform’s automation API (Claude, ChatGPT, Jules, Open Claw, Hermes)
- Define data model: `Task` (platform-agnostic), `PlatformConnection`, `ScheduleExpression`, `ExecutionLog`

---

## Phase 1: Requirements & Specifications
**Duration:** 2–3 weeks

### Deliverables
- Functional requirements document (FRD)
- Non‑functional requirements (performance, security, dark theme, mobile responsive)
- User stories & acceptance criteria
- API contracts for planned integrations

### Key Activities
- Prioritize platforms for MVP (Windows Task Scheduler + Claude Code)
- Define “quick link” architecture – deep links or redirects to native UIs
- Spec for cross‑platform conversion templates (cron → ChatGPT schedule → Windows trigger)
- Outline MCP (Model Context Protocol) integration for AI task creation
- UX wireframes (dashboard, task grid, schedule visualizer)

---

## Phase 2: Architecture & Design
**Duration:** 2 weeks

### Deliverables
- System architecture diagram
- Security design (OAuth, API keys, local agent encryption)
- Database schema (ER diagram)
- UI mockups – dark theme, responsive, sample templates library

### Key Activities
- Design **local Windows agent** (lightweight service ↔ web backend via WebSocket/REST)
- Plan push notifications (to trigger remote runs) and polling (to sync state)
- Real‑time sync strategy (webhooks where available)
- Template format for cross‑platform conversion (JSON Schema + YAML)

---

## Phase 3: Development (MVP)
**Duration:** 8–12 weeks

### Deliverables
- Working MVP with:
  - Add/manage platform credentials (OAuth, local agent pairing) — connect 2 systems in < 15 min
  - Discover/display scheduled tasks from ≥2 platforms (Windows + Claude) with **normalized status**
  - **Connector health diagnostics** per platform
  - Quick links to native UIs
  - Manual run trigger + **one-click enable/disable, each with a confirmation** (via agent/API)
  - **Execution timeline + failure alerting** (clear logs for every run)
  - Template library (5–10 cross‑platform examples) with **conversion confidence score** — full catalog & schema in [`resources/Templates.md`](resources/Templates.md)
  - **Local task categorization & organization (Independent of source platforms)**
  - Dark theme dashboard

### Sprint Breakdown
- **Sprint 1–2:** Backend core – user auth, DB, API scaffolding, platform abstraction layer
- **Sprint 3–4:** Platform integrations – Windows agent (WebSocket + Task Scheduler COM wrapper), Claude Code routines API
- **Sprint 5:** Real‑time task list sync + manual run trigger
- **Sprint 6:** Frontend – dashboard, dark theme, task cards, quick links
- **Sprint 7:** Template library & **Task Categorization**
- **Sprint 8:** Testing & hardening

### Recommended Tech Stack
| Area | Technology |
|------|-------------|
| Frontend | React + Tailwind CSS + TanStack Query |
| Backend | Node.js + Express (or Fastify) + PostgreSQL + Prisma |
| Real‑time | Socket.io (agent ↔ server) |
| Windows Agent | .NET 8 (C#) + Task Scheduler Managed Wrapper |
| Hosting | Docker + cloud (Render, AWS ECS, or self‑hosted) |

---

## Phase 4: Testing & QA
**Duration:** 2–3 weeks

### Deliverables
- Test plan (unit, integration, E2E, cross‑platform)
- Security audit (API keys, token storage, agent authentication)
- Performance report (sync latency, mobile response)

### Key Activities
- Simulate network failures / offline scenarios (agent reconnection)
- Validate conversion templates (e.g., cron → ChatGPT schedule → Windows task)
- Cross‑browser & mobile testing
- Beta user feedback (template usability)

---

## Phase 5: Deployment & Rollout
**Duration:** 1–2 weeks

### Deliverables
- Production environment (staging → prod)
- User documentation + template contribution guide
- Monitoring & alerting (logs, agent connectivity, API rate limits)

### Key Activities
- Deploy web app + database + WebSocket server
- Distribute Windows agent installer (signed, auto‑update)
- Zero‑config onboarding (OAuth for cloud platforms, one‑click agent download)
- Backup & restore procedures for user task mappings

### Rollout Plan
- Private beta (10–20 power users) → public beta → general availability

---

## Phase 6: Post‑Launch & Iteration
**Duration:** ongoing

### Deliverables & Features
- Feedback loop (GitHub issues, in‑app feedback)
- Full MCP support – AI can create/update tasks via natural language
- Additional platform connectors (Open Claw, Hermes, Jules)
- Advanced schedule visualizer (calendar/gantt)
- Cross‑platform dependency chains
- Public template gallery with user submissions
- Performance optimization & cost monitoring

### Cadence
- Monthly release cycle
- Community management for template sharing
- Enterprise features (SSO, audit logs) – optional

---

## Risk Management Matrix

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|-------------|
| Platform API changes (e.g., ChatGPT deprecates schedule endpoint) | Medium | High | Abstract connector layer; fallback to quick links |
| Windows agent blocked by corporate firewalls | High | Medium | Support local polling (no WebSocket) or hybrid mode |
| User confusion over “run” vs “edit” (native UI vs web trigger) | Medium | Low | Clear UI labels + tooltips + tutorial |
| Schedule conversion inaccuracies (cron → ChatGPT) | High | Medium | Provide preview + validation + **confidence score** before saving |
| MCP integration scope creep | Medium | Medium | Treat as Phase 6; MVP uses static templates only; market "coming soon" |
| **Platform-breadth scope creep ahead of reliability** (becoming a connector-maintenance project, not a product) | High | High | **Hard roadmap gates tied to reliability metrics, not connector count.** New connectors unlock only after the existing set holds sync-reliability + crash-rate KPIs. |
| **Connector/API surface volatility** (Anthropic/OpenAI/Google change endpoints) | Medium | High | Strict connector abstraction + **version pinning** + **fast fallback to quick links** so a broken API degrades gracefully. |
| **Local-agent trust/security concerns** | Medium | High | Auditable least-privilege agent, explicit permission scopes, public trust docs. |

---

## Sample Timeline (Gantt Overview)

| Phase | Weeks |
|-------|-------|
| Inception | 1–2 |
| Requirements | 3–5 |
| Architecture | 6–7 |
| MVP Development | 8–19 |
| Testing | 20–22 |
| Deployment | 23–24 |
| Post‑launch | Week 25+ |

**Total to MVP:** ~6 months (part‑time/small team)
*Can be compressed to 3–4 months with 2–3 full‑time developers*

---

## Next Steps (Immediate Action Items)

1. **Stand up staging infrastructure** – Deploy the backend and database on the Hetzner VPS (`62.238.44.179`), configure reverse proxy/SSL, and run database migrations.
2. **Wire DNS & Vercel API** – Configure `taskhub-api.mikesailab.com` in Squarespace DNS and set the `VITE_API_URL` environment variable on Vercel to connect the frontend to the live backend.
3. **Develop Playwright E2E Test Suite** – Scaffold Playwright in the frontend, implement E2E scenarios E2E.1–E2E.9, and run reliability/network failure checks.
4. **Build WiX Installer** – Scaffold the WiX installer project for the C# Agent under `agent/installer/` and automate building the `.msi` package in CI.
5. **Security & Performance Audits** – Run security audit scripts (JWT, HMAC, rate limits, encryption checks) and measure performance targets (load latency, agent CPU/memory).

---

*For further detail on any phase (e.g., Windows agent design, API contracts, MCP integration), please request.*
