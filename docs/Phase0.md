# Phase 0: Inception & Discovery

**Duration:** 1–2 weeks
**Status:** Active
**Master plan:** [`Project_Plan.md`](Project_Plan.md)

---

## Deliverable 1: Project Charter

**Vision**  
A single, elegant web dashboard that gives users unified control over every scheduled task across their entire digital workspace—whether running on Windows, AI assistants, or automation tools—reducing context switching and enabling cross-platform orchestration.

**Scope (MVP)**  
- Support Windows Task Scheduler (via local agent) + Claude Code Routines (via API)  
- View all tasks from both platforms in one list  
- Quick links to native management UIs  
- Manually trigger a Windows task from the web/mobile  
- Basic template library (5–10 cross‑platform schedule conversions)  
- Dark theme, responsive design

**Out of Scope (MVP)**  
- Full two‑way sync (e.g., editing a schedule in ChatGPT updates the web app automatically)  
- Cross‑platform dependency chains  
- MCP AI task creation (post‑MVP)  
- Support for Open Claw, Hermes, Jules (post‑MVP)

**Success Metrics (KPI)**  
- User can discover and trigger a Windows task from phone in < 30 seconds  
- 90% of scheduled tasks from connected platforms appear correctly in dashboard  
- Cross‑platform conversion template success rate > 85% (user‑rated)  
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
| R6 | Cross‑platform schedule conversion produces wrong times (timezone, DST) | Medium | Medium | Store schedules in UTC; require user preview; DST warnings. |

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

## Key Activity 1: Validate Feasibility of Controlling Windows Task Scheduler

**Approach**  
Build proof‑of‑concept Windows agent in C#:  
- List all scheduled tasks using `TaskScheduler` COM interop  
- Run a specific task via `task.Run()`  
- Receive commands via HTTP or WebSocket  

**Feasibility Verdict** ✅ **Feasible**  
- `TaskScheduler` assembly well‑documented by Microsoft  
- Requires admin rights (agent runs as SYSTEM or user with privileges)  
- Remote control over LAN via WebSocket; over internet requires relay or tunnel  

**Edge Cases**  
- NAT/firewall → agent initiates WebSocket connection to public relay  
- Auto‑update and graceful restart needed  

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

- [ ] Project charter signed off.
- [ ] Risk register reviewed.
- [ ] Tech stack locked.
- [ ] MVP scope agreed and documented.
- [ ] Windows agent feasibility proven via 2-day POC spike.
- [ ] Initial Prisma schema committed.

→ Advance to **[Phase 1: Requirements & Specifications](Phase1.md)**.