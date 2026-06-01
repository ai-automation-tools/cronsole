# Phase 1: Requirements & Specifications

**Duration:** 2–3 weeks
**Status:** Drafted
**Master plan:** [`Project_Plan.md`](Project_Plan.md)
**Predecessor:** [`Phase0.md`](Phase0.md)
**Informed by:** [`Business_Idea_Assessment.md`](Business_Idea_Assessment.md) — the "first features that matter most" set drives the Must-have priorities below.

---

> **Requirements lens (per the assessment).** The MVP is a **reliability control plane**, so the highest-value requirements are: unified inventory + **status normalization**, **one-click run/enable/disable with confirmations**, **execution timeline + failure alerting**, **connector health diagnostics**, and schedule conversion **with explicit caveats / a confidence score**. Advanced workflow building and broad platform parity are explicitly deferred.

## Deliverable 1: Functional Requirements Document (FRD)

### Core Functional Requirements

| ID | Requirement | Priority | MVP |
|----|-------------|----------|-----|
| FR1 | User can register/login with email/password (JWT) | Must | ✅ |
| FR2 | User can connect a Windows machine via local agent (pairing code) | Must | ✅ |
| FR3 | User can connect Claude Code routines via API key | Must | ✅ |
| FR4 | System discovers all scheduled tasks from connected Windows agent | Must | ✅ |
| FR5 | System lists all routines from Claude Code API | Must | ✅ |
| FR6 | Dashboard shows unified task list with platform icon, name, **normalized status**, schedule, next run | Must | ✅ |
| FR7 | User can click a "Run now" button to manually trigger a Windows task | Must | ✅ |
| FR8 | User can click a "Run now" button to manually trigger a Claude routine | Should | ✅ (if API allows) |
| FR9 | User can click an "Edit in native UI" button → deep link to platform's own management page | Must | ✅ |
| FR10 | User can view template library (predefined schedule examples) | Must | ✅ |
| FR11 | User can apply a template to create a new task on a connected platform | Should | ✅ |
| FR12 | User can search/filter tasks by platform, name, status | Could | ❌ (post-MVP) |
| FR13 | System syncs task list every 5 minutes or on agent push, **achieving > 95% sync reliability** | Must | ✅ |
| FR14 | User receives visual warning if Windows agent is offline | Must | ✅ |
| FR15 | Dark theme persists across sessions | Must | ✅ |
| FR16 | User can **enable / disable** a task one-click from the dashboard | Must | ✅ |
| FR17 | **Destructive or state-changing actions (run, enable, disable, delete) require a confirmation** | Must | ✅ |
| FR18 | Every run/trigger writes an **execution-timeline entry**, and the user sees an **alert/notification on failure** | Must | ✅ |
| FR19 | Dashboard surfaces **connector health diagnostics** per platform (agent reachable, API key valid, last successful sync, error reason) | Must | ✅ |
| FR20 | Schedule conversion shows a **confidence score + explicit caveats/warnings** before the user applies it | Must | ✅ |

### Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| NFR1 | Dashboard initial load time | < 2 seconds |
| NFR2 | Manual trigger latency (phone → Windows) | < 3 seconds (LAN) |
| NFR3 | Concurrent users supported | 100 (MVP) |
| NFR4 | Agent CPU usage (idle) | < 0.5% |
| NFR5 | Agent memory usage | < 50 MB |
| NFR6 | Web app availability | 99.5% uptime |
| NFR7 | All API endpoints require authentication | Yes |
| NFR8 | Secrets (API keys, tokens) encrypted at rest | AES-256 |
| NFR9 | Sync reliability across connected tasks | > 95% |
| NFR10 | Time to connect 2 systems (onboarding) | < 15 minutes |

---

## Deliverable 2: User Stories & Acceptance Criteria

### Epic 1: Onboarding & Setup

**US1.1** As a new user, I want to install the Windows agent with one click so that I can control my scheduled tasks remotely.
- **Acceptance:** Download link provides `.msi` installer; after installation, agent appears in system tray; web app shows "Agent connected" status.

**US1.2** As a user, I want to connect my Claude Code account using an API key so that my routines appear in the dashboard.
- **Acceptance:** Input field for API key; system validates key by fetching list of routines; success message shown.

### Epic 2: Task Management

**US2.1** As a user, I want to see all my scheduled tasks from Windows and Claude in a single, sortable list.
- **Acceptance:** Dashboard displays tasks with platform badge, schedule, next run time (if available). Sorting by name works.

**US2.2** As a user, I want to manually trigger a Windows task from my phone, even when I'm not at my desk.
- **Acceptance:** Tap "Run" on any Windows task; agent receives command and executes it; success/failure notification appears in web app within 5 seconds.

**US2.3** As a user, I want a quick link to edit a task in its native interface because my web app cannot support all advanced settings.
- **Acceptance:** Each task has an "Edit original" button that opens Windows Task Scheduler or Claude dashboard in a new tab.

**US2.4** As a user, I want to enable or disable a task in one click so that I can pause something without deleting it.
- **Acceptance:** Each task row has an enable/disable toggle; toggling prompts a confirmation, sends the command to the platform, and the normalized status updates within 5 seconds. (FR16, FR17)

**US2.5** As a user, I want a confirmation before any run/enable/disable/delete so that I don't accidentally fire a task.
- **Acceptance:** State-changing actions open a confirmation dialog naming the task and platform; only on confirm is the command sent. (FR17)

### Epic 3: Templates & Conversion

**US3.1** As a user, I want to browse a library of schedule templates (e.g., "daily backup at 3 AM") so that I don't have to write cron expressions from scratch.
- **Acceptance:** Template library page shows 5+ examples with human descriptions; clicking a template fills a form.

**US3.2** As a user, I want to convert a schedule from one platform format to another (e.g., cron → Windows trigger).
- **Acceptance:** Select source platform and target platform; system previews converted schedule; user can save as new task.

### Epic 4: System Health

**US4.1** As a user, I want to know if my Windows agent is offline so that I don't mistakenly think tasks are still controllable.
- **Acceptance:** Dashboard shows red dot / "Agent offline" message next to Windows platform card.

**US4.2** As a user, I want to see recent execution logs for triggered tasks so that I can debug failures.
- **Acceptance:** Clicking a task shows a modal with last 5 runs (timestamp, status, output snippet).

**US4.3** As a user, I want connector health diagnostics per platform so that I can trust the dashboard is showing me the real state.
- **Acceptance:** Each platform card shows: connection state, last successful sync time, and — when unhealthy — the specific reason (agent unreachable, API key invalid/expired, rate-limited). (FR19)

**US4.4** As a user, I want to be alerted when a task run fails so that I'm not relying on silent success.
- **Acceptance:** A failed run produces a visible in-app alert and an execution-timeline entry with the failure reason. (FR18)

---

## Deliverable 3: API Contracts (OpenAPI 3.0 Style)

**Base URL:** `https://api.taskhub.app/v1`
**Authentication:** Bearer token in `Authorization` header.

> Full request/response sample payloads live under [`api-examples/`](api-examples/).

### 1. Platforms

**GET /platforms** — List connected platforms and their status.

```json
// Response 200
[
  {
    "id": "plat_win_1",
    "platform": "WINDOWS_TASK_SCHEDULER",
    "isActive": true,
    "agentConnected": true,
    "lastSync": "2025-04-15T10:30:00Z"
  },
  {
    "id": "plat_claude_1",
    "platform": "CLAUDE_CODE",
    "isActive": true,
    "agentConnected": null,
    "lastSync": "2025-04-15T10:29:00Z"
  }
]
```

**POST /platforms/windows/agent/register** — Register a new agent (pairing).

```json
// Request
{ "machineName": "DESKTOP-ABC", "publicKey": "..." }

// Response 201
{ "agentId": "agt_123", "pairingSecret": "secret", "wsUrl": "wss://..." }
```

**POST /platforms/claude/connect** — Store Claude API key.

```json
// Request
{ "apiKey": "sk-ant-..." }

// Response 200
{ "platformId": "plat_claude_1", "routinesCount": 12 }
```

### 2. Tasks

**GET /tasks** — List all tasks from all platforms.

```json
// Response 200
{
  "tasks": [
    {
      "id": "task_1",
      "name": "Daily Backup",
      "platform": "WINDOWS_TASK_SCHEDULER",
      "schedule": "0 3 * * *",
      "nextRunTime": "2025-04-16T03:00:00Z",
      "status": "ACTIVE",
      "quickLink": "taskschd.msc /s /query?task=Daily%20Backup",
      "metadata": { "taskPath": "\\MyTasks\\Daily Backup" }
    }
  ],
  "total": 25
}
```

**POST /tasks/{taskId}/run** — Manually trigger a task.

```json
// Response 202
{ "executionId": "exec_123", "status": "PENDING" }
```

**GET /tasks/{taskId}/logs** — Fetch execution logs.

```json
// Response 200
{
  "logs": [
    {
      "id": "exec_123",
      "triggeredAt": "2025-04-15T14:22:00Z",
      "status": "SUCCESS",
      "log": "Backup completed, 2.3 GB copied.",
      "platformRunId": "win_run_456"
    }
  ]
}
```

### 3. Templates

**GET /templates** — List public + user templates.

```json
// Response 200
{
  "templates": [
    {
      "id": "tmpl_1",
      "name": "Daily Backup at 3 AM",
      "description": "Run backup script every night",
      "scheduleExpression": "0 3 * * *",
      "command": "backup.bat",
      "sourcePlatform": "WINDOWS_TASK_SCHEDULER",
      "isPublic": true,
      "upvotes": 42
    }
  ]
}
```

**POST /templates/{templateId}/apply** — Create a task from template on a specified platform.

```json
// Request
{ "platformId": "plat_win_1", "taskName": "My Backup" }

// Response 201
{ "taskId": "task_42", "platformTaskId": "My Backup" }
```

**POST /templates/convert** — Convert schedule expression from one platform to another.

```json
// Request
{
  "sourcePlatform": "WINDOWS_TASK_SCHEDULER",
  "targetPlatform": "CLAUDE_CODE",
  "schedule": "0 3 * * *"
}

// Response 200
{
  "converted": "cron: 0 3 * * *",
  "confidence": 0.92,                 // 0–1 semantic-fidelity score; surfaced before apply
  "warnings": ["Claude routines only support hourly granularity"]
}
```

### 4. WebSocket Events (Agent ↔ Server)

- **Agent → Server:** `task:update` (task list changed), `task:executed` (run result), `agent:status` (online/offline)
- **Server → Agent:** `task:run` (trigger a specific task), `task:list` (request full list)

Full message envelope spec: see [`Phase2.md`](Phase2.md) → Deliverable 4.

---

## Deliverable 4: UX Wireframes (Text Description)

### Page 1: Dashboard (Main View)
- **Header:** App logo, dark/light toggle, user avatar.
- **Platform Status Bar:** Horizontal pills showing Windows (green dot = agent online), Claude (connected), ChatGPT (quick links only). Click pill to filter tasks.
- **Task Table:** Columns: Task name, Platform (icon), Schedule (human readable), Next run (relative time), Actions (Run button, Edit original link).
- **Floating Action Button (FAB):** "+ New task" (opens platform selector).
- **Footer:** Last sync time, template library link.

### Page 2: Template Library
- **Search bar** + filter by platform.
- **Grid of cards** — each card shows template name, description, schedule expression, command, upvote count.
- **"Apply" button** opens a modal: choose target platform, customise task name, confirm.

### Page 3: Platform Connection Manager
- List of supported platforms with connect/disconnect buttons.
- For Windows: shows agent status, machine name, "Download installer" button.
- For Claude: input field for API key, "Test connection" button.
- For others (ChatGPT, Jules): shows "Quick links only – no API" message with external link.

### Page 4: Task Details Modal
- Task name, platform, full schedule (cron + natural language).
- **Run history** (scrollable list with timestamps, status icons, log preview).
- **"Edit in native UI"** button — opens deep link.
- **"Delete"** (only if platform API supports deletion).

### Mobile View (Responsive)
- Task table becomes stacked cards.
- FAB transforms into bottom navigation.
- Agent offline warning takes full-width banner.

---

## Deliverable 5: Schedule Conversion Specification

### Normalized Schedule Format

Internally, all schedules are stored as **cron expressions** with 5 fields: `minute hour day month weekday` (no seconds or year).
Time zone: **UTC** only.

### Conversion Matrix (MVP)

| From | To | Method |
|------|----|--------|
| cron | Windows trigger | Parse cron → map to `TriggerType.Daily/Weekly/Monthly`. For complex cron (e.g., `0 3 * * 1-5`), use multiple triggers. |
| cron | Claude routine | Claude accepts cron string directly (Anthropic API). Pass through with validation. |
| Windows trigger | cron | Convert Windows trigger to cron using library `cron-converter`; warn if unsupported (e.g., "repeat every 5 minutes for 1 hour"). |

### Validation Rules
- Cron must be valid (via `cron-validator` library).
- Timezone conversion: user sees local time, but stored UTC.
- Warning if schedule uses seconds (not supported) or year (ignore).

### Confidence Score (per the assessment — mitigates semantic-mismatch risk)
Every conversion returns a **confidence score (0–1)** alongside warnings, shown in the preview **before apply**:
- **1.0** — lossless round-trip (e.g., cron → Claude cron passthrough).
- **0.7–0.99** — semantically equivalent but with caveats (e.g., a single cron mapped to multiple Windows triggers).
- **< 0.7** — lossy or approximate; the apply button is gated behind an explicit "I understand" acknowledgement.

The score is derived from a round-trip check (`source → target → source`) plus a penalty for each warning. Low-confidence conversions are never applied silently.

### Example Conversion
**Input (Windows):** Daily at 9:30 AM, Mon–Fri.
**Output (cron):** `30 9 * * 1-5`
**User preview:** "Runs at 09:30 UTC, Monday through Friday."

---

## Deliverable 6: MCP Integration Outline (deferred to Phase 6)

**Model Context Protocol** will allow AI assistants (Claude Desktop, Cursor, etc.) to interact with the system via natural language.

**Proposed MCP Tools:**
- `list_tasks` — return all tasks for the authenticated user.
- `run_task(task_id)` — trigger a task.
- `create_task(platform, name, schedule_expression, command)` — create a new scheduled task.
- `convert_schedule(source_platform, target_platform, expression)` — return a converted schedule.

**Security:** MCP requests use a separate API key (user generates in web app). Key has scoped permissions (e.g., read-only, run-only).

**Implementation:** Build MCP server in Node.js that wraps the existing REST API. Deploy separately or as part of main backend.

→ Full design in [`Phase6.md`](Phase6.md).

---

## Phase 1 Exit Criteria

- [ ] FRD signed off by Mike.
- [ ] All MVP user stories have acceptance criteria.
- [ ] OpenAPI 3.0 spec drafted for every MVP endpoint.
- [ ] Wireframes approved (Figma or text spec).
- [ ] Schedule conversion rules locked.

→ Advance to **[Phase 2: Architecture & Design](Phase2.md)**.
