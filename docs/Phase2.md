# Phase 2: Architecture & Design

**Duration:** 2 weeks
**Status:** Drafted
**Master plan:** [`Project_Plan.md`](Project_Plan.md)
**Predecessor:** [`Phase1.md`](Phase1.md)

---

## Deliverable 1: System Architecture Diagram (Text Description)

### High-Level Components

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             User Devices                                     │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐                              │
│  │   Web    │    │  Mobile  │    │   CLI    │                              │
│  │ Browser  │    │ Browser  │    │ (curl)   │                              │
│  └────┬─────┘    └────┬─────┘    └────┬─────┘                              │
│       │               │               │                                     │
│       └───────────────┼───────────────┘                                     │
│                       │ HTTPS                                              │
└───────────────────────┼─────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Cloud / Hosted Backend                            │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         Load Balancer (nginx)                        │   │
│  └─────────────────┬───────────────────────┬───────────────────────────┘   │
│                    │                       │                               │
│  ┌─────────────────▼─────────────────┐  ┌──▼─────────────────────────────┐ │
│  │        Web Server (Node.js)       │  │     WebSocket Server (Socket.io)│ │
│  │  - Express REST API               │  │  - Manages agent connections    │ │
│  │  - Authentication (JWT)           │  │  - Broadcasts run commands      │ │
│  │  - Platform connectors            │  │  - Receives task updates        │ │
│  └─────────────────┬─────────────────┘  └──┬─────────────────────────────┘ │
│                    │                       │                               │
│                    └───────────┬───────────┘                               │
│                                │                                           │
│                    ┌───────────▼───────────┐                               │
│                    │      PostgreSQL       │                               │
│                    │   - Users, tasks      │                               │
│                    │   - Platform conns    │                               │
│                    │   - Execution logs    │                               │
│                    │   - Templates         │                               │
│                    └───────────┬───────────┘                               │
│                                │                                           │
│                    ┌───────────▼───────────┐                               │
│                    │     Redis (optional)  │                               │
│                    │   - Session store     │                               │
│                    │   - Rate limiting     │                               │
│                    │   - Pub/sub for sync  │                               │
│                    └───────────────────────┘                               │
└─────────────────────────────────────────────────────────────────────────────┘
                        │
                        │ WebSocket (outbound connection from agent)
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           User's Windows Machine                            │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     Windows Agent (.NET 8)                          │   │
│  │  - Runs as Windows Service                                          │   │
│  │  - WebSocket client to backend                                      │   │
│  │  - Task Scheduler COM wrapper                                       │   │
│  │  - Command executor (run tasks, list tasks)                         │   │
│  │  - Heartbeat & auto-reconnect                                       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    Windows Task Scheduler                           │   │
│  │  - Native scheduled tasks                                           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘

External APIs (called by backend):
  ┌──────────────┐    ┌──────────────┐
  │ Claude API   │    │ ChatGPT API* │ (if available)
  └──────────────┘    └──────────────┘
```

### Data Flow – Manual Task Trigger from Mobile

1. User taps "Run" on a Windows task in mobile browser.
2. Frontend sends `POST /tasks/{taskId}/run` to backend.
3. Backend looks up the task's platform connection (Windows agent ID).
4. Backend sends WebSocket message `task:run { taskId, command }` to the specific agent.
5. Agent receives message, invokes Task Scheduler COM to run the task.
6. Agent sends back `task:executed { success, output }` via WebSocket.
7. Backend stores execution log, pushes notification to frontend via polling or WebSocket.
8. Frontend displays success/failure toast.

---

## Deliverable 2: Security Design

### Authentication & Authorization

| Component | Method | Notes |
|-----------|--------|-------|
| Web app user | JWT (signed, short-lived) + refresh token | Refresh token stored in HTTP-only cookie |
| Windows agent | Pairing secret + agent ID (UUID) | Agent sends secret on WebSocket handshake; backend validates |
| Claude API | API key (encrypted at rest, decrypted in memory) | User provides key; never exposed to frontend |
| MCP (future) | API key with scoped permissions (read-only, run-only, admin) | User generates key from dashboard |

### Data Encryption

- **At rest:**  
  - Database: `config` JSON field (contains API keys, tokens) encrypted using AES-256-GCM. Application-level encryption before Prisma insert.  
  - Backups: encrypted with KMS (AWS KMS or similar).  
- **In transit:**  
  - All HTTP endpoints: TLS 1.3 only (HSTS).  
  - WebSocket: WSS (TLS).  
  - Agent ↔ Server: WSS with mutual TLS (optional for MVP, at least server certificate validation).

### Secrets Management

- Use environment variables for database credentials, JWT secret, encryption key.  
- In production, use a secrets manager (e.g., AWS Secrets Manager, HashiCorp Vault).  
- Agent pairing secrets are one-time use; after handshake, agent gets a token.

### Windows Agent Security Considerations

- Agent runs as a Windows service with least privilege (e.g., `NT AUTHORITY\SYSTEM` is powerful; consider a dedicated service account with permissions only to Task Scheduler).  
- Agent stores only a device ID and WebSocket token; no user credentials.  
- Commands from backend are signed with a per-session HMAC to prevent replay.

---

## Deliverable 3: Database Schema (ER Diagram & Indexes)

### ER Diagram (Text)

```
┌─────────────┐       ┌─────────────────────┐       ┌─────────────┐
│    User     │       │ PlatformConnection  │       │    Task     │
├─────────────┤       ├─────────────────────┤       ├─────────────┤
│ id (PK)     │──────<│ userId (FK)         │       │ id (PK)     │
│ email       │       │ id (PK)             │       │ userId (FK) │>───┐
│ name        │       │ platform            │       │ platform    │    │
│ ...         │       │ config (encrypted)  │       │ externalId  │    │
└─────────────┘       │ isActive            │       │ name        │    │
                      │ lastSync            │       │ schedule    │    │
                      └─────────────────────┘       │ nextRunTime │    │
                                                    │ status      │    │
                                                    │ quickLink   │    │
                                                    │ metadata    │    │
                                                    └─────────────┘    │
                                                                        │
┌─────────────┐       ┌─────────────────────┐       ┌─────────────────┘
│  Template   │       │   ExecutionLog      │       │
├─────────────┤       ├─────────────────────┤       │
│ id (PK)     │       │ id (PK)             │       │
│ userId (FK) │>──────│ taskId (FK)         │>──────┘
│ name        │       │ triggeredAt         │
│ scheduleExpr│       │ status              │
│ command     │       │ log                 │
│ isPublic    │       │ platformRunId       │
│ ...         │       └─────────────────────┘
└─────────────┘
```

### Indexes for Performance

```sql
-- Task queries: filter by user and platform
CREATE INDEX idx_tasks_user_platform ON tasks(user_id, platform);

-- Tasks by next run time (for notifications)
CREATE INDEX idx_tasks_next_run ON tasks(next_run_time) WHERE status = 'ACTIVE';

-- Execution log retrieval by task (most recent first)
CREATE INDEX idx_execution_logs_task_triggered ON execution_logs(task_id, triggered_at DESC);

-- Platform connections by user and active status
CREATE INDEX idx_platform_conn_user_active ON platform_connections(user_id, is_active);

-- Templates by popularity (public)
CREATE INDEX idx_templates_public_upvotes ON templates(is_public, upvotes DESC);
```

### Prisma Schema Extensions (from Phase 0)

Add these to the existing schema:

```prisma
// For better indexing and encryption
model User {
  // ... existing fields
  @@index([email])
}

model PlatformConnection {
  // ... existing fields
  config Json // encrypted at application level
  @@unique([userId, platform])
}

model Task {
  // ... existing fields
  @@unique([platform, externalId])
  @@index([userId, platform])
  @@index([nextRunTime])
}

model ExecutionLog {
  // ... existing fields
  @@index([taskId, triggeredAt(sort: Desc)])
}
```

---

## Deliverable 4: WebSocket Protocol Specification

### Connection Lifecycle

1. Agent initiates WebSocket connection to `wss://api.taskhub.app/v1/ws` with query params: `?agentId={id}&secret={pairingSecret}`
2. Server validates secret, associates connection with user.
3. Agent sends `agent:hello` with machine info.
4. Server responds with `agent:welcome` and requests initial task list (`task:list`).
5. Agent sends `task:full_list` (array of tasks).
6. Heartbeat: ping/pong every 30 seconds.
7. On disconnect, server marks agent offline; on reconnect, agent resyncs.

### Message Formats (JSON)

**Agent → Server**

```json
// Agent announces itself
{
  "type": "agent:hello",
  "payload": {
    "machineName": "DESKTOP-ABC",
    "agentVersion": "1.0.0",
    "osVersion": "Windows 11 22H2"
  }
}

// Agent sends full task list (after connect or after change)
{
  "type": "task:full_list",
  "payload": {
    "tasks": [
      {
        "externalId": "MyTask",
        "name": "Daily Backup",
        "schedule": "0 3 * * *",
        "status": "ACTIVE",
        "metadata": { "taskPath": "\\MyTasks\\Backup" }
      }
    ]
  }
}

// Agent reports task execution result
{
  "type": "task:executed",
  "payload": {
    "taskExternalId": "MyTask",
    "success": true,
    "output": "Backup completed.",
    "runId": "win_run_123"
  }
}

// Agent heartbeat
{
  "type": "agent:ping",
  "payload": { "timestamp": "2025-04-15T10:00:00Z" }
}
```

**Server → Agent**

```json
// Server acknowledges welcome
{
  "type": "agent:welcome",
  "payload": { "syncIntervalSeconds": 300 }
}

// Server requests full task list (on initial connect or after reconnect)
{
  "type": "task:list",
  "payload": {}
}

// Server commands agent to run a task
{
  "type": "task:run",
  "payload": {
    "taskExternalId": "MyTask",
    "commandId": "exec_123"
  }
}

// Server heartbeat response
{
  "type": "agent:pong",
  "payload": { "timestamp": "2025-04-15T10:00:05Z" }
}
```

---

## Deliverable 5: Platform Connector Abstraction

### Interface Design (TypeScript)

```typescript
// backend/src/connectors/platform.interface.ts

export interface Task {
  externalId: string;
  name: string;
  schedule: string | null; // normalized cron or null
  nextRunTime?: Date;
  status: 'ACTIVE' | 'DISABLED' | 'UNKNOWN';
  quickLink: string;
  metadata: Record<string, any>;
}

export interface PlatformConnector {
  // Authentication / setup
  connect(config: any): Promise<void>;
  disconnect(): Promise<void>;
  
  // Task operations
  listTasks(): Promise<Task[]>;
  runTask(externalId: string): Promise<{ runId: string }>;
  createTask?(name: string, schedule: string, command: string): Promise<Task>;
  deleteTask?(externalId: string): Promise<void>;
  
  // Health
  isConnected(): boolean;
  getPlatformType(): string;
}

// Example implementation: WindowsAgentConnector (communicates via WebSocket)
// Example implementation: ClaudeConnector (calls Anthropic API)
```

### Connector Registry

```typescript
// backend/src/connectors/registry.ts
const connectors = new Map<string, PlatformConnector>();

export function registerConnector(platform: string, connector: PlatformConnector) {
  connectors.set(platform, connector);
}

export function getConnector(platform: string, userId: string): PlatformConnector {
  // Load user's platform connection config from DB
  // Instantiate connector with that config
}
```

---

## Deliverable 6: Windows Agent Design (POC Focus)

### Technology Choices

- **Language:** C# (.NET 8)
- **Task Scheduler library:** `Microsoft.Win32.TaskScheduler` (NuGet)
- **WebSocket client:** `System.Net.WebSockets.ClientWebSocket`
- **Service host:** `Microsoft.Extensions.Hosting` (BackgroundService)
- **Logging:** `Serilog` (file + console)
- **Configuration:** `appsettings.json` + environment variables

### Agent Components

```
Windows Agent
├── Program.cs                // Entry point, builds service host
├── AgentService.cs           // BackgroundService: manages WebSocket lifecycle
├── TaskSchedulerWrapper.cs   // COM interop with TaskScheduler
├── WebSocketClient.cs        // Handles connection, reconnection, message routing
├── CommandProcessor.cs       // Parses incoming commands (task:run, task:list)
├── Heartbeat.cs              // Periodic ping
└── Configuration.cs          // Loads agentId, secret, server URL
```

### Key Code Snippet (Task Scheduler Wrapper)

```csharp
using Microsoft.Win32.TaskScheduler;

public class TaskSchedulerWrapper
{
    public List<TaskInfo> GetAllTasks()
    {
        using (TaskService ts = new TaskService())
        {
            var tasks = ts.AllTasks.Select(t => new TaskInfo
            {
                ExternalId = t.Name,
                Name = t.Name,
                Schedule = t.Definition.Triggers.FirstOrDefault()?.ToString(),
                Status = t.Enabled ? "ACTIVE" : "DISABLED",
                Metadata = new { Path = t.Path }
            }).ToList();
            return tasks;
        }
    }

    public void RunTask(string taskName)
    {
        using (TaskService ts = new TaskService())
        {
            var task = ts.GetTask(taskName);
            if (task == null) throw new Exception($"Task {taskName} not found");
            task.Run();
        }
    }
}
```

### Installation & Autoupdate

- Build MSI installer using WiX Toolset.
- Agent registers as a Windows Service with `StartType = Automatic`.
- Update mechanism: agent checks `/api/agent/version` every 24h; downloads new MSI, runs silent install, restarts service.

---

## Deliverable 7: Frontend Architecture

### Component Hierarchy

```
App
├── AuthProvider (context)
├── ThemeProvider (dark mode)
├── Router (React Router)
│   ├── /dashboard
│   │   ├── PlatformStatusBar
│   │   ├── TaskTable
│   │   │   └── TaskRow (Run button, Edit link)
│   │   └── FloatingActionButton
│   ├── /templates
│   │   ├── SearchFilter
│   │   ├── TemplateGrid
│   │   │   └── TemplateCard (Apply button)
│   │   └── ConvertForm (schedule converter)
│   ├── /settings
│   │   ├── PlatformConnections
│   │   └── AccountSettings
│   └── /task/:id
│       └── TaskDetailModal
└── ToastNotifications
```

### State Management

- **Server state:** TanStack Query (React Query) for all API calls – caching, background refetch.
- **UI state:** React hooks (useState, useReducer) for filters, modals.
- **Real-time updates:** Socket.io client – listens for `task:updated` and `task:executed`, invalidates queries.

### Dark Theme Implementation (Tailwind)

```css
/* tailwind.config.js */
module.exports = {
  darkMode: 'class',
  // ...
}
```

```jsx
// Theme toggle
import { useTheme } from 'next-themes';
const { theme, setTheme } = useTheme();
// setTheme('dark') or 'light'
```

---

## Deliverable 8: Deployment Architecture (MVP)

### Docker Compose (Development)

```yaml
version: '3.8'
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: taskhub
      POSTGRES_USER: taskhub
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
  backend:
    build: ./backend
    ports:
      - "3000:3000"
    depends_on:
      - postgres
      - redis
    environment:
      DATABASE_URL: postgresql://taskhub:${DB_PASSWORD}@postgres:5432/taskhub
      REDIS_URL: redis://redis:6379
  redis:
    image: redis:7-alpine
  frontend:
    build: ./frontend
    ports:
      - "80:80"
```

### Production (AWS ECS or Render)

- **Frontend:** Static site on S3 + CloudFront (or Vercel)
- **Backend:** Docker container on ECS Fargate (or Render)
- **PostgreSQL:** AWS RDS (or Render managed DB)
- **Redis:** AWS ElastiCache (optional)
- **WebSocket server:** Same container as backend (Socket.io can scale with sticky sessions; use Redis adapter for multi-instance)

### Environment Variables (Backend)

```
DATABASE_URL=postgresql://...
JWT_SECRET=...
ENCRYPTION_KEY=...
CLAUDE_API_BASE=https://api.anthropic.com
AGENT_WS_SECRET_SALT=...
REDIS_URL=redis://...
```

---

## Deliverable 9: Performance & Scalability Considerations

| Area | Design Decision | Rationale |
|------|----------------|-----------|
| Database | Connection pool (20-50 connections) | Avoids exhaustion under load |
| API rate limiting | 100 requests per minute per user (burst 200) | Prevents abuse |
| WebSocket scaling | Redis pub/sub adapter for Socket.io | Allows multiple backend instances |
| Agent sync frequency | Agent pushes changes on any task update; backend polls only as fallback | Minimizes latency and bandwidth |
| Task list caching | React Query caches for 30 seconds, background refetch | Balances freshness and load |
| Image optimization | Use next/image (or similar) for logo/icons | Improves mobile performance |

---

## Deliverable 10: Error Handling & Resilience

### Backend

- All API routes wrapped in try/catch → returns `{ error: { code, message } }`
- Unhandled promise rejection → process.exit (with supervisor)
- Database transaction retries (3 attempts with exponential backoff)

### Windows Agent

- WebSocket disconnection → exponential backoff reconnect (1s, 2s, 4s, … up to 5 minutes)
- Task execution timeout (configurable, default 30 minutes)
- Log rotation (10 MB per file, keep 5 files)

### Frontend

- Global error boundary → fallback UI with "Reload" button
- API error toast (user-friendly message)
- Offline detection → show "Agent unreachable" banner

---

## Phase 2 Exit Criteria

- [ ] System architecture diagram approved (Mermaid or Figma render).
- [ ] Security design reviewed (encryption, auth, agent handshake).
- [ ] Prisma schema migrated to draft DB; indexes verified via `EXPLAIN`.
- [ ] WebSocket protocol spec frozen; sample exchange documented in `api-examples/`.
- [ ] Windows agent design has a working POC binary (lists tasks + runs one task).
- [ ] Docker Compose dev environment boots end-to-end (`docker compose up` → backend healthy).

→ Advance to **[Phase 3: Development (MVP)](Phase3.md)**.
