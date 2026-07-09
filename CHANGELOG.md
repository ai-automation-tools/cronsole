# Changelog

All notable changes to this repository should be documented in this file.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), adapted for the current MVP stage of TaskHub.

## [Unreleased]

### Security
- **Agent WebSocket authentication** (P0): the agent↔backend Socket.IO channel is no longer unauthenticated. The backend now runs an `io.use()` handshake middleware (`backend/src/ws/agentAuth.ts`) that verifies an HMAC-SHA256 proof over `(agentId, nonce, ts)` against a shared `AGENT_PAIRING_SECRET` (with a 120s freshness window and constant-time compare) and **rejects any socket that can't authenticate** — closing the "any process reaching port 3000 gets remote command execution" gap. The handshake is single-use within its window (server-side nonce replay cache) so a captured handshake can't be replayed to displace the live agent. State-changing commands (`task:run` / `task:create` / `task:set_status`) are signed server-side with a **per-session key** derived from the handshake nonce, and the .NET agent (`AgentAuthenticator.cs`) **refuses to execute any command it can't verify** (bad signature or stale timestamp). Socket.IO CORS is restricted to `ALLOWED_ORIGINS` (empty by default; only the non-browser agent connects today). The agent reads its server URL + pairing secret from env (`TASKHUB_SERVER_URL`, `TASKHUB_PAIRING_SECRET`, `TASKHUB_AGENT_ID`; WSS-capable) **or** a gitignored `agent/TaskHub.Agent/appsettings.json` (env overrides the file; `appsettings.example.json` is the committed template, copied beside the published exe so the Windows auto-start task picks up the secret without re-exporting it), and the backend fails fast if `AGENT_PAIRING_SECRET` is unset/weak. The auto-start / self-heal scheduled task was re-published and validated end-to-end (published agent authenticates from its bundled config; Windows connector reports `HEALTHY`). A shared cross-language HMAC golden vector is asserted by both `backend/src/ws/__tests__/agentAuth.test.ts` and `agent/TaskHub.Agent.Tests/AgentAuthenticatorTests.cs` so the two implementations can't silently diverge. **Breaking:** existing agents must be rebuilt with the pairing secret configured.

### Added
- **Task search on the dashboard**: free-text search box beside the category chips, matching name, category, platform path, command, and schedule (multi-term queries narrow). Includes a live match counter, clear button, `/` to focus, Esc to clear, and a "Clear search" action in the empty state. Composes with the category/platform/active filters across all four views. Matching logic in `frontend/src/utils/taskSearch.ts` with unit tests.
- **Platform selector in the New Task modal** (`CreateTaskModal`, replacing the native-only `CreateNativeTaskModal`): choose TaskHub-native (HTTP job) or **Windows** (command). The Windows path creates a real Task Scheduler task via the agent with the cron converted to a structured trigger, shows live conversion warnings (debounced `POST /api/tasks/preview`), stores the cron on the task row, and surfaces a clear error when the agent is offline.
- **`\TaskHub\` scheduler folder for created tasks**: the agent now registers all TaskHub-created Windows tasks under `\TaskHub\` (auto-created), so they're identifiable, category-extract as "TaskHub" on sync, and are cleanly removable.
- `POST /api/tasks/preview` — cron→trigger conversion preview for a platform (mirrors the template preview endpoint).
- **Last-run failure surfacing**: `GET /api/tasks` now includes `lastRunStatus`/`lastRunAt`/`lastRunDurationMs`; tasks whose most recent run failed show a red "Run failed" indicator on dashboard grid cards and in the list view.
- **Run durations**: new `ExecutionLog.durationMs` column (migration `add_execution_duration`), recorded for manual runs and native scheduler fires, displayed in the Run History tab (e.g. "· 44ms").
- **Task delete for TaskHub-native tasks**: `DELETE /api/tasks/:id` (native-only guard; synced tasks are rejected until the agent supports `task:delete`) + a confirmed Delete button in the task modal.
- **Run History tab** in the task detail modal: shows the last 20 `ExecutionLog` entries (manual runs + native scheduler fires) with SUCCESS/FAILURE/TIMEOUT status pills, timestamps, and log snippets. Backed by new `GET /api/tasks/:id/executions` endpoint. Demo mode shows a notice; empty/loading/error states handled. Works for all platforms — any task run from the dashboard now leaves a visible trail.
- **TaskHub-native tasks** (`TASKHUB_NATIVE` platform, design: `docs/specs/Native_Tasks.md`): tasks that exist only in TaskHub, scheduled and executed by the backend itself with no Windows Task Scheduler entry. Includes:
  - `NativeScheduler` (30s tick loop): fires due tasks, writes `ExecutionLog` rows, advances `nextRunTime` via `cron-parser` (UTC), skips runs missed by more than a 5-minute grace window.
  - `NativeTaskExecutor` with an HTTP job type (webhook pings, health checks; 15s timeout, non-2xx = FAILURE) stored in `Task.metadata.job`.
  - `TaskHubNativeConnector` in the registry so Run Now / enable / disable reuse existing routes; `POST /api/tasks/native` creation endpoint; auto-provisioned platform connection at boot.
  - UI: violet TaskHub badge identity, a dashboard **platform filter** (All / Windows / TaskHub with counts) for one-click isolation of native vs. synced tasks, and a New Task modal (name, category, cron presets, method + URL, optional body).
  - Shared `frontend/src/platform.ts` label/badge helpers — also fixes list/kanban/schedule views labeling every non-Windows platform as "Claude".
  - Tests: cron-next util (5) and NativeTaskExecutor (8, mocked axios). Verified end-to-end live: a per-minute native task fired on schedule twice with SUCCESS logs and correctly advancing nextRunTime.
- Real cron→Windows-trigger conversion in the template apply pipeline: the apply route converts the schedule via `convertCronToWindowsTrigger` and passes a structured `trigger` object through `PlatformConnector.createTask` into the `task:create` agent payload.
- Agent `TriggerBuilder` + `TriggerSpec`: registers native Daily/Weekly/interval Task Scheduler triggers from the server spec (UTC→local conversion, ISO-8601 repetition intervals), replacing the two-case cron parser. Interval schedules are registered as daily triggers with repetition so they recur beyond the first 24h window.
- `POST /api/templates/:id/preview` endpoint returning `{ score, warnings, trigger }` (template/OS compatibility + cron conversion confidence).
- Apply modal now shows live (debounced) conversion warnings and a "converts cleanly" confirmation under the schedule field.
- Tests: `TriggerBuilder` unit tests, agent `task:create` trigger-parsing tests, connector trigger-payload passthrough test.
- Proprietary `LICENSE` / rights notice for the private repository.
- Contributor guide in `CONTRIBUTING.md`.
- Repository contracts document in `docs/specs/CONTRACTS.md`.
- Explicit roadmap and phase-status sync across the planning docs.
- Basic GitHub Actions CI workflow in `.github/workflows/ci.yml`.
- Windows Agent automated startup registration script `setup-agent-startup.ps1` to compile and register the agent inside a dedicated `\Task-Hub\` Task Scheduler folder.
- Headless daemon configuration (`WinExe` output type) for the C# Agent to run silently on logon.
- Setup and troubleshooting manual in `docs/user-guides/Agent_Setup_Guide.md`.

### Changed
- **Planning docs restructured to a single living roadmap**: the phase lifecycle (0–6) is complete, so `docs/Project_Plan.md` and `docs/phases/` moved to `docs/archive/` (frozen), replaced by `docs/ROADMAP.md` — completed work plus prioritized open items (P0 security → P3 expansion) drawn from the 2026-07-07 project analysis. All doc links updated (`README`, `CLAUDE.md`, `CONTRIBUTING`, `docs/README.md`, `CONTRACTS`).
- Aligned `README.md`, `CLAUDE.md`, and planning docs with the current implementation state.
- Clarified that the public deployment is a frontend demo backed by sample data.
- Reframed Claude Code support as experimental rather than production-ready.
- Updated immediate action items to focus on Phase 3 exit criteria and Phase 4 QA.

### Fixed
- **`POST /api/tasks` (clone / custom creation) skipped cron→trigger conversion**: Windows tasks created through it (e.g. the Clone modal) fell into the agent's legacy fallback and ran "daily at now+1h" instead of the requested schedule. The route now validates the cron, converts it like the template-apply path, and rejects unconvertible schedules with a 400.
- **Tasks deleted natively no longer linger in TaskHub**: `POST /api/tasks/sync` now prunes DB tasks (and their execution logs) that are missing from the connector's full task list via `TaskService.removeStaleTasks`. Pruning is based on the pre-filter list, so category selections in the Import modal don't affect it; `TASKHUB_NATIVE` and empty connector lists are guarded. Verified live: 22 stale Windows tasks purged.
- **Agent permanently disconnected after a backend outage**: SocketIOClient gives up after its default 10 reconnect attempts, so any backend restart longer than ~1 minute left the agent silently offline until manually restarted. The agent now exposes `ISocketClient.Connected` and runs a 30s watchdog loop that re-calls `ConnectAsync` whenever disconnected — this also covers the agent starting before the backend at boot. (Do **not** "fix" this with `ReconnectionAttempts = int.MaxValue`: the library's internal delay math overflows and every connect throws.)
- **Startup task killed the agent after 3 days**: `setup-agent-startup.ps1` previously registered `TaskHubAgent` with Task Scheduler's default 72-hour execution time limit, which force-stops the long-running agent (restart-on-failure does not apply to time-limit kills). The task is now registered with no execution time limit.
- **Setup script failed on re-run while the agent was running**: the script now stops the scheduled task and kills any running `TaskHub.Agent` process before publishing, so the locked `.exe` no longer breaks rebuilds.
- **Import modal rendered a blank body when discovery returned nothing** (e.g. agent offline), making "Sync Now" look like a no-op. It now shows an explicit empty state pointing at the likely cause.
- Template apply route ignored the Apply modal's edited cron: the modal sends `schedule` but the route only read `scheduleExpression`. Both keys are now accepted, and non-5-field crons are rejected with a 400.
- GitHub Actions CI checks by:
  - Switching from `npm ci` to `npm install` in frontend and backend jobs to resolve cross-platform native package installation issues.
  - Adding `npx prisma generate` in backend pipeline to build the Prisma Client before testing/compiling.
  - Quoting the numeric `ENCRYPTION_KEY` environment variable in the workflow YAML to prevent scientific notation conversion.
  - Adding a `TaskHub.Agent.slnx` solution file inside the `agent/` folder to allow root-level `.NET` CLI commands to execute successfully.

### Known gaps
- Phase 4 QA has not formally started.
- Claude connector behavior is still scaffold-level.
- Hosted backend, staging, and signed Windows agent installer are still pending.

## Repository baseline

Current repo baseline at the time this changelog was introduced:

- Functional Windows Task Scheduler MVP path via local .NET agent.
- React frontend with dashboard, templates, platforms/settings views, demo mode, selective import, and local task categorization.
- Node/Express/Prisma backend with auth routes, task routes, template routes, WebSocket agent bridge, and connector registry.
- Backend test coverage present for encryption, connectors, task service, and agent manager.
