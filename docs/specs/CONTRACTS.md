# TaskHub Contracts

This document records the **current repository contracts**: assumptions that multiple parts of the system already rely on. When one of these changes, the matching code, tests, and docs must change together.

This is intentionally narrower and more implementation-grounded than the phase-planning docs.

## 1. Scope contract

TaskHub is currently an **MVP control plane** for scheduled tasks.

Current practical scope:

- functional Windows Task Scheduler import/sync/run flow via the local .NET agent
- dashboard and template UX in the React frontend
- local task categorization independent of source platform
- experimental Claude connector scaffolding in the backend

Out of current production-ready scope:

- broad multi-platform parity
- hosted backend / production rollout
- MCP task creation
- signed installer distribution
- confidence-scored schedule conversion
- full two-way task editing across platforms

## 2. Task identity contract

A task's durable identity is:

- `platform`
- `externalId`

This identity is enforced by Prisma with a unique constraint on `(platform, externalId)`.

Implications:

- sync operations must upsert by `(platform, externalId)`
- sync also **prunes**: after upserting, tasks absent from the connector's **full** (pre-category-filter) list are deleted along with their execution logs (`TaskService.removeStaleTasks`) — a task missing from the platform was deleted natively, regardless of which categories the user imports
- pruning is skipped for `TASKHUB_NATIVE` (its connector returns `[]`; the DB is the source of truth) and for empty connector lists (safety net against wiping a platform)
- a task rename must not silently change identity semantics
- connector authors must map native platform identifiers into a stable `externalId`

## 3. Category contract

TaskHub categories are **local TaskHub metadata**, not source-platform truth.

Current behavior:

- new Windows tasks derive an initial category from the top-level folder in the native task path
- uncategorized or non-folder tasks default to `Uncategorized`
- sync updates **must not overwrite** a user-edited category once the task exists

This behavior is implemented in `backend/src/services/TaskService.ts`.

## 4. Normalized task shape contract

Connectors normalize imported tasks into this shape:

- `externalId: string`
- `name: string`
- `status: 'ACTIVE' | 'DISABLED'`
- `metadata?: any`

Current connector interface lives in:

- `backend/src/connectors/platform.interface.ts`

Connector responsibilities:

- translate platform-native task data into the normalized shape
- preserve enough metadata for inspection/debugging
- keep platform-specific logic inside the connector layer

## 5. Platform connector contract

Every platform integration should be reachable through the connector registry.

Current registry:

- `backend/src/connectors/registry.ts`

Current registered connectors:

- `WINDOWS_TASK_SCHEDULER`
- `CLAUDE_CODE`
- `TASKHUB_NATIVE`

Connector methods currently expected by the backend:

- `syncTasks(config)`
- `runTask(externalId, config)`
- `setTaskStatus(externalId, enabled, config)`
- `getHealth(config)`
- `createTask(name, schedule, command, config, options?)` — `options.trigger`
  carries the structured cron→platform trigger conversion (Windows); creation
  routes must convert before calling, never pass a raw cron alone for Windows

If this interface changes, update:

- connector implementations
- route handlers
- tests
- planning docs that describe the connector layer

## 6. Agent transport contract

Current transport model:

- the Windows agent connects **outbound** to the backend over Socket.IO
- the backend does not initiate a connection to the Windows machine
- the backend currently stores one socket per user in `AgentManager`
- the current MVP assumes a single agent per user

Current event usage in code:

Agent → backend:

- `task:full_list`
- `task:executed`
- `task:created`

Backend → agent:

- `task:list`
- `task:run`
- `task:create`
- `task:set_status`

Important current behavior:

- task sync is now **explicitly user-triggered**, not automatic on connect
- task discovery/import relies on a live registered agent socket
- agent disconnect means Windows health is offline and sync/run calls fail
- the agent **self-heals its connection**: SocketIOClient's built-in reconnection covers short drops (default 10 attempts), and a 30s watchdog loop in `Program.cs` re-calls `ConnectAsync` whenever disconnected — covering longer backend outages and the agent starting before the backend at boot. `ReconnectionAttempts = int.MaxValue` must not be used (the library's delay math overflows and every connect throws)

## 7. Auth/runtime contract

Current backend HTTP routing:

- `GET /api/health` is public
- `/api/auth/*` is public
- `/api/tasks/*` requires JWT middleware
- `/api/templates/*` requires JWT middleware

Current reality caveat:

- the backend still seeds and uses an MVP placeholder user (`cli_user_placeholder`) for agent-linked flows
- docs must not imply that multi-user agent pairing is complete when describing current behavior

## 8. Demo mode contract

The public site and local live mode are intentionally different.

Current behavior:

- `VITE_DEMO_MODE=true` enables frontend sample data
- the public deployment is documented as a frontend-only demo
- local development can point the frontend at a real backend with `VITE_API_URL`

Docs and product copy should preserve that distinction.

## 9. Data and secret handling contract

Current expectations in repo code and docs:

- `PlatformConnection.config` is intended to hold sensitive platform config
- AES-256-GCM encryption helpers exist in `backend/src/auth/encryption.ts`
- decrypted credentials must not be logged

Current implementation caveat:

- secret lifecycle and platform-connection flows are still MVP-stage and not fully hardened
- docs should distinguish between current code paths and target-state security posture

## 10. Testing contract

Current repository expectations:

- backend tests exist for encryption, connector behavior, task service behavior, and agent manager behavior
- user-visible or contract-level changes should add or update tests where practical
- doc-only changes that alter declared behavior should stay faithful to what tests and code can actually support

Current backend test locations:

- `backend/src/auth/__tests__/`
- `backend/src/connectors/__tests__/`
- `backend/src/services/__tests__/`
- `backend/src/ws/__tests__/`

## 11. Documentation contract

When behavior changes, at minimum review whether these files also need changes:

- `README.md`
- `CLAUDE.md`
- `docs/Project_Plan.md`
- relevant `docs/phases/Phase*.md`
- `CHANGELOG.md`
- this file

Planning docs may describe targets; this file should describe **what the repo currently depends on today**.
