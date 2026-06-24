# Phase 0: Inception & Discovery

**Duration:** 1–2 weeks
**Status:** Complete
**Master plan:** [`Project_Plan.md`](Project_Plan.md)
**Informed by:** [`Business_Idea_Assessment.md`](Business_Idea_Assessment.md) — independent viability assessment (2026-05-14)

---

> **Strategic direction (per the independent assessment).** TaskHub is positioned as a **control plane** — *see, trigger, and trust* scheduled tasks across existing systems — **not** a universal workflow builder. The wedge is a unification + reliability layer across disconnected schedulers (OS + AI-native surfaces). Defensibility comes from **connector quality, normalized observability, and trust/reliability**, not from connector count. The MVP is deliberately a **2-platform reliability control plane** (Windows + one cloud/AI platform). Every other platform is *roadmap language*, not an implementation expectation. Market it as **"high-confidence integrations," not "supports everything."**

---

## Deliverable 1: Project Charter

**Vision**  
A single, elegant **control plane** that lets users *see, trigger, and trust* every scheduled task across their digital workspace—Windows, AI assistants, and automation tools—reducing context switching and giving them confidence that what's scheduled is actually running. Visibility + triggering + reliability first; cross-platform orchestration is a later-stage ambition, not the MVP promise.

**Scope (MVP)** — explicitly a **2-platform reliability control plane**  
- Support Windows Task Scheduler (via local agent) + Claude Code Routines (via API) — **depth over breadth; each integration must be deep and reliable, not a shallow connector that drifts**  
- Unified task inventory across both platforms with **normalized status**  
- One-click **run / enable / disable** with confirmations  
- Quick links to native management UIs  
- Manually trigger a Windows task from the web/mobile  
- **Execution timeline + clear logs for every run/trigger action**  
- **Connector health diagnostics** (is the agent/API actually healthy?)  
- Basic template library (5–10 cross‑platform schedule conversions) **with explicit conversion caveats / confidence score**  
- Dark theme, responsive design

**Out of Scope (MVP)** — *delayed per the assessment to protect the reliability baseline*  
- **Advanced workflow building** (TaskHub is a control plane, not a workflow builder)  
- **Broad multi-platform parity** — more shallow connectors weaken trust more than they add value  
- Full two‑way sync (e.g., editing a schedule in ChatGPT updates the web app automatically)  
- Cross‑platform dependency chains  
- **Heavy AI/MCP authoring workflows before the reliability baseline is met** — MCP stays Phase 6, pitched as "coming soon"  
- Support for Open Claw, Hermes, Jules (post‑MVP)

**Success Metrics (KPI)** — first-90-day targets from the assessment  
- A user can connect **2 systems in under 15 minutes**  
- User can discover and trigger a Windows task from phone in **< 30 seconds**  
- **> 95% successful sync reliability** across connected tasks *(raised from the original 90% "appear correctly" bar — reliability is the product, so the threshold is higher)*  
- **Clear execution logs for every run/trigger action** (no silent successes or failures)  
- Cross‑platform conversion template success rate > 85% (user‑rated), each conversion carrying a **confidence score**  
- < 2% crash rate for Windows agent over 7 days

**Stakeholders**  
- Primary: Project owner / power user  
- Secondary: Early beta testers (from automation forums)  
- Tertiary: Platform owners (Anthropic, OpenAI, Google) – no formal relationship, rely on public APIs

---

## Deliverable 2: High‑Level Risk Assessment

| Risk ID | Description | Likelihood | Impact | Mitigation Strategy |
|---------|-------------|------------|--------|----------------------|
| R1 | Windows Task Scheduler cannot be triggered remotely without local agent | High | High | Build lightweight Windows agent (WebSocket). Fallback: manual trigger instructions + quick link. |
| R2 | Claude/Codex/Jules APIs change or require re‑auth frequently | Medium | Medium | Abstract each platform behind a connector layer; store refresh tokens. |
| R3 | ChatGPT schedules API not publicly documented | Medium | High | Reverse‑engineer / use browser automation; otherwise limit to quick links. |
| R4 | Sync frequency causes high CPU/battery on Windows (polling) | Low | Medium | Event‑based sync with configurable polling (default 5 min). |
| R5 | User forgets to install agent → "why can't I control Windows tasks?" | High | Low | Clear onboarding wizard, in‑dashboard status indicator, one‑click download. |
| R6 | Cross‑platform schedule conversion produces wrong times (timezone, DST) | Medium | Medium | Store schedules in UTC; **require user preview + validation + a confidence score before apply**; DST warnings. |
| R7 | **Scope creep — platform breadth chased ahead of reliability** (the assessment's #1 execution threat: becoming a connector-maintenance project, not a product) | High | High | **Hard roadmap gates tied to reliability metrics, not connector count.** A new connector ships only after the existing set holds its sync-reliability and crash-rate KPIs. |
| R8 | **Security/compliance concerns with the local-agent model** | Medium | High | Auditable agent design, least-privilege service account, explicit permission scopes, and clear public **trust docs** explaining exactly what the agent can and cannot do. |
| R9 | **Connector/API surface volatility** (Anthropic/OpenAI/Google change endpoints) | Medium | High | Strict connector abstraction, **version pinning**, and **fast fallback to quick-links** behavior so a broken API degrades gracefully instead of breaking the dashboard. |

---

## Deliverable 3: Initial Tech Stack Selection

| Layer | Technology | Justification |
|-------|------------|----------------|
| **Frontend** | React 18 + TypeScript | Component reusability; strong typing for API contracts. |
| **UI / Styling** | Tailwind CSS + shadcn/ui | Built‑in dark mode, modern component library. |
| **Backend API** | Node.js + Express (TypeScript) | Lightweight, WebSocket integration. |
| **Database** | PostgreSQL 16 | Reliable, JSON fields for platform metadata. |
| **ORM** | Prisma | Type‑safe database access. |
| **Real‑time** | Socket.io (server + agent client) | Handles reconnection, fallback to polling. |
| **Windows Agent** | .NET 8 (C#) + Microsoft.Win32.TaskScheduler | Native Task Scheduler control, runs as Windows service. |
| **Auth** | JWT + optional OAuth2 | Simple for MVP; extensible. |
| **Hosting** | Docker Compose (dev) + AWS ECS / Render (prod) | Portable, easy scaling. |

---

## Deliverable 4: MVP vs. Feature‑Complete Roadmap

**MVP (0–6 months)**  
- Windows Task Scheduler (local agent)  
- Claude Code Routines (API)  
- Unified task list view  
- Quick links to each platform’s native UI  
- Manual run trigger (Windows & Claude if API allows)  
- Static template library (no auto‑conversion yet)  
- Dark theme, mobile responsive  

**Post‑MVP (6–12 months)**  
- ChatGPT Automations (API or webhook)  
- Jules, Open Claw, Hermes connectors  
- Full schedule conversion tool (cron ↔ Windows ↔ Claude YAML ↔ ChatGPT)  
- Two‑way sync (edits in web app update the platform)  
- MCP integration – AI creates/edits tasks via natural language  
- Public template gallery with voting  
- Task run history & logs aggregation  
- Cross‑platform dependencies  

**Future / Stretch**  
- Mobile apps (iOS/Android native)  
- Calendar view of scheduled executions  
- Slack/Teams notifications on task failures  

---

## Deliverable 5: Competitive Landscape Analysis

Survey of incumbent scheduled-task and workflow-automation tools, plus where TaskHub differentiates. Full table and takeaways live in [`Competition_Analysis.md`](Competition_Analysis.md).

**Headline findings**
- No incumbent unifies AI-assistant schedulers (Claude Code, ChatGPT, Jules) with OS-level schedulers (Windows Task Scheduler, cron). TaskHub's unification thesis is uncontested today.
- Desktop competitors are either stagnant (Task Till Dawn, last update 2019) or expensive (VisualCron ~$2.3k/yr, ActiveBatch $50k+/yr).
- Web orchestrators (Airflow, n8n, Rundeck, Jenkins) target data engineers / DevOps — wrong persona for our power-user developer.
- **MCP integration is the unique wedge.** No surveyed competitor exposes a Model Context Protocol surface; this anchors the Phase 6 differentiator.

---

## Key Activity 1: Validate Feasibility of Controlling Windows Task Scheduler

**Approach**  
Build proof‑of‑concept Windows agent in C#:  
- List all scheduled tasks using `TaskScheduler` COM interop  
- Run a specific task via `task.Run()`  
- Receive commands via HTTP or WebSocket  

**Feasibility Verdict** ✅ **Feasible (Validated 2026-06-01)**  
- `TaskScheduler` assembly well‑documented by Microsoft.
- Successfully built .NET 8 Agent POC that connects to a Node.js server via Socket.io.
- Confirmed listing of local tasks and remote triggering capability.
- Outbound-only WebSocket connection confirmed to bypass inbound firewall issues.

---

## Key Activity 2: Research Target Platform Automation APIs

| Platform | API Availability | Auth Method | List Tasks? | Trigger Run? | Create/Edit? | MVP Integration |
|----------|----------------|-------------|-------------|--------------|--------------|------------------|
| Windows Task Scheduler | Custom agent required | Local system token | ✅ Yes | ✅ Yes | ✅ Yes | Full control |
| Claude Code Routines | Public (Anthropic API) | API Key | ✅ Yes | ✅ Yes | ✅ Yes | Full control |
| ChatGPT Automations | No public API | N/A | ❌ No | ❌ No | ❌ No | Quick links only |
| Jules (Google) | Unclear | N/A | ❓ Unknown | ❓ Unknown | ❓ Unknown | Quick links only |
| Open Claw | Unknown | Varies | ? | ? | ? | Quick links only |
| Hermes | Unknown | ? | ? | ? | ? | Quick links only |

**Decision for MVP**  
- **Full integration:** Windows + Claude Code  
- **Quick links only:** ChatGPT, Jules, Open Claw, Hermes (deep links if available)  

---

## Key Activity 3: Define Data Model (Prisma Schema Draft)

```prisma
model User {
  id            String   @id @default(cuid())
  email         String   @unique
  name          String?
  createdAt     DateTime @default(now())
  platforms     PlatformConnection[]
  tasks         Task[]
  templates     Template[]
}

model PlatformConnection {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id])
  platform    PlatformType
  config      Json     // OAuth tokens, agent local URL, API keys (encrypted)
  isActive    Boolean  @default(true)
  lastSync     DateTime?
  createdAt   DateTime @default(now())
}

model Task {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id])
  platform    PlatformType
  externalId  String
  name        String
  schedule    String?
  nextRunTime DateTime?
  status      TaskStatus
  quickLink   String?
  metadata    Json
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([platform, externalId])
}

model ExecutionLog {
  id          String   @id @default(cuid())
  taskId      String
  task        Task     @relation(fields: [taskId], references: [id])
  triggeredAt DateTime @default(now())
  status      ExecutionStatus
  log         String?
  platformRunId String?
}

model Template {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id])
  name        String
  description String?
  sourcePlatform PlatformType
  targetPlatforms PlatformType[]
  scheduleExpression String
  command     String
  isPublic    Boolean  @default(false)
  upvotes     Int      @default(0)
  createdAt   DateTime @default(now())
}

enum PlatformType {
  WINDOWS_TASK_SCHEDULER
  CLAUDE_CODE
  CHATGPT
  JULES
  OPEN_CLAW
  HERMES
}

enum TaskStatus {
  ACTIVE
  DISABLED
  UNKNOWN
  DELETED
}

enum ExecutionStatus {
  SUCCESS
  FAILURE
  TIMEOUT
  PENDING
}
```

**Notes**
- `config` JSON stores encrypted tokens; agent connections store agent ID + last seen IP.
- `quickLink` generated per platform (e.g., `taskschd.msc` for Windows).
- Templates use normalized cron; conversion logic lives in the service layer (see Phase 2).

---

## Phase 0 Exit Criteria

- [x] Project charter signed off with the control-plane positioning explicit (see/trigger/trust, not workflow builder).
- [x] Risk register reviewed — including the R7 scope-creep gate.
- [x] Tech stack locked.
- [x] MVP scope agreed and documented as a 2-platform reliability control plane; everything else confirmed as roadmap-only.
- [x] Reliability-gated roadmap policy agreed: new connectors unlock only after the current set holds its KPIs.
- [x] Competitive landscape surveyed ([`Competition_Analysis.md`](Competition_Analysis.md)).
- [x] Windows agent feasibility proven via technical POC spike (2026-06-01).
- [ ] Initial Prisma schema committed (Moving to Phase 2/3).

→ **Phase 0 Complete.** Advance to [Phase 1: Requirements & Specifications](Phase1.md).
