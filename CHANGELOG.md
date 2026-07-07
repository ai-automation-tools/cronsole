# Changelog

All notable changes to this repository should be documented in this file.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), adapted for the current MVP stage of TaskHub.

## [Unreleased]

### Added
- **Last-run failure surfacing**: `GET /api/tasks` now includes `lastRunStatus`/`lastRunAt`/`lastRunDurationMs`; tasks whose most recent run failed show a red "Run failed" indicator on dashboard grid cards and in the list view.
- **Run durations**: new `ExecutionLog.durationMs` column (migration `add_execution_duration`), recorded for manual runs and native scheduler fires, displayed in the Run History tab (e.g. "· 44ms").
- **Task delete for TaskHub-native tasks**: `DELETE /api/tasks/:id` (native-only guard; synced tasks are rejected until the agent supports `task:delete`) + a confirmed Delete button in the task modal.
- **Run History tab** in the task detail modal: shows the last 20 `ExecutionLog` entries (manual runs + native scheduler fires) with SUCCESS/FAILURE/TIMEOUT status pills, timestamps, and log snippets. Backed by new `GET /api/tasks/:id/executions` endpoint. Demo mode shows a notice; empty/loading/error states handled. Works for all platforms — any task run from the dashboard now leaves a visible trail.
- **TaskHub-native tasks** (`TASKHUB_NATIVE` platform, design: `docs/resources/Native_Tasks.md`): tasks that exist only in TaskHub, scheduled and executed by the backend itself with no Windows Task Scheduler entry. Includes:
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
- Repository contracts document in `docs/CONTRACTS.md`.
- Explicit roadmap and phase-status sync across the planning docs.
- Basic GitHub Actions CI workflow in `.github/workflows/ci.yml`.
- Windows Agent automated startup registration script `setup-agent-startup.ps1` to compile and register the agent inside a dedicated `\Task-Hub\` Task Scheduler folder.
- Headless daemon configuration (`WinExe` output type) for the C# Agent to run silently on logon.
- Setup and troubleshooting manual in `docs/user-guides/Agent_Setup_Guide.md`.

### Changed
- Aligned `README.md`, `CLAUDE.md`, and planning docs with the current implementation state.
- Clarified that the public deployment is a frontend demo backed by sample data.
- Reframed Claude Code support as experimental rather than production-ready.
- Updated immediate action items to focus on Phase 3 exit criteria and Phase 4 QA.

### Fixed
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
