# TaskHub-Native Tasks

*Design doc — added 2026-07-07. Status: implemented (MVP).*

TaskHub-native tasks exist **only in TaskHub**: they are scheduled and executed by the
backend itself, with no Windows Task Scheduler (or any external platform) entry. They are
the third connector alongside Windows and Claude Code.

## Scope & rationale

Native tasks are for jobs the backend can execute itself — the MVP job type is **HTTP**
(webhook pings, health checks, triggering n8n/Zapier flows). Local Windows commands stay
on Windows Task Scheduler deliberately: the OS scheduler survives reboots and runs when
TaskHub is down, and re-implementing that reliability is out of scope (see analysis
2026-07-07). Future job types (e.g. `CLAUDE_PROMPT`) extend the same `job` envelope.

## Data model

- `PlatformType.TASKHUB_NATIVE` (migration `add_taskhub_native_platform`).
- A native task is a normal `Task` row: `platform = TASKHUB_NATIVE`,
  `externalId = native_<random>`, `schedule` = 5-field cron (UTC), and the job spec in
  `metadata.job`:

```json
{ "jobType": "HTTP", "url": "https://…", "method": "GET", "headers": {}, "body": "" }
```

- `Task.nextRunTime` is authoritative for native tasks: computed with `cron-parser`
  (UTC) on create, after every fire, and backfilled at boot.

## Execution

- `NativeScheduler` (`backend/src/services/NativeScheduler.ts`): a 30-second tick loop.
  Each tick claims ACTIVE native tasks with `nextRunTime <= now`, executes them via
  `NativeTaskExecutor`, writes an `ExecutionLog` row (SUCCESS/FAILURE + response/log
  snippet), and advances `nextRunTime` to the next cron occurrence.
- **Missed-run policy:** if a due time was missed by more than the 5-minute grace window
  (server was down), the run is skipped and `nextRunTime` advances silently. Within
  grace, it fires once (catch-up).
- `NativeTaskExecutor` (`backend/src/services/NativeTaskExecutor.ts`): executes the job
  spec. HTTP jobs use a 15s timeout; non-2xx counts as FAILURE.
- `TaskHubNativeConnector` implements `PlatformConnector` so Run Now / enable / disable
  flow through the existing registry. `syncTasks` returns `[]` (the DB *is* the
  platform); `createTask` accepts a URL command for future template targeting.

## API

- `POST /api/tasks/native` — `{ name, category?, schedule, job }` → creates the task and
  returns it (validates cron + job spec).
- `DELETE /api/tasks/:id` — native tasks only (synced tasks are rejected with a 400 until
  the agent grows `task:delete`); removes the task and its execution history in a transaction.
- `GET /api/tasks/:id/executions` — last 20 `ExecutionLog` rows (all platforms).
- `GET /api/tasks` now flattens a last-run summary onto every task:
  `lastRunStatus`, `lastRunAt`, `lastRunDurationMs`.
- Run/enable/disable/patch reuse the existing `/api/tasks` routes via the connector.
- Every run (manual or scheduled) records `ExecutionLog.durationMs` (wall-clock).

## UI

- Native tasks carry a distinct violet **TASKHUB** badge (Windows stays blue).
- The dashboard has a platform filter (All / per-platform chips) so native and Windows
  tasks can be isolated in one click; it composes with the category filter.
- "New Task" button on the dashboard opens `CreateTaskModal` with a **platform
  selector** (TaskHub / Windows). The TaskHub form takes name, category, cron
  schedule, URL, method, optional body. The Windows form takes a command instead
  and creates a real Task Scheduler task via the agent (cron converted to a
  structured trigger with live warnings via `POST /api/tasks/preview`), registered
  under the `\TaskHub\` scheduler folder so TaskHub-made tasks stay identifiable.
- The task modal has a **Run History** tab (status pill, timestamp, duration, log snippet
  per run) and, for native tasks, a **Delete** button with confirmation.
- Tasks whose most recent run failed show a red **"Run failed"** indicator on grid cards
  and in the list view.

## Known limitations (MVP)

- Single-instance scheduler: no distributed lock; running multiple backend instances
  would double-fire. (Redis lock is the Phase 5 fix, matching the existing Redis note.)
- HTTP is the only job type; response bodies are truncated in logs.
- No retry policy — a failed run waits for the next scheduled occurrence.
