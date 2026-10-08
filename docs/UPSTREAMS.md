# Upstreams

Every external platform, protocol, library, and host Cronsole depends on, what the code
assumes about each, and where to check whether that assumption still holds. The biweekly
**Cronsole Upstream Check** routine (`upstream/auto-*` PRs) works from this file. Keep it
current by hand too: a new connector is a new row.

Connectors live in `backend/src/connectors/` behind `platform.interface.ts`, listed in
`registry.ts`. **Last checked** is filled in by the routine, and only with a date it actually
read the source. `—` means never checked.

## Sources (the connectors)

| Upstream | What the code assumes | Code | Check at | Last checked |
|:---|:---|:---|:---|:---|
| **Claude Code triggers** *(undocumented OAuth API; highest drift risk)* | `ANTHROPIC_BASE_URL` or `api.anthropic.com`; `GET/POST /v1/code/triggers[/{id}]`, `POST /v1/code/triggers/{id}/run`, `GET /v1/code/sessions`; header `anthropic-beta: ccr-triggers-2026-01-30`; token read from `~/.claude/.credentials.json` → `claudeAiOauth.{accessToken,expiresAt}`, never refreshed | `backend/src/services/claudeTriggers.ts`, `claudeOAuth.ts` | github.com/anthropics/claude-code/blob/main/CHANGELOG.md (no API announcements exist; watch for trigger, routine, and credentials-file changes) | — |
| **Claude Code routines** *(documented fire endpoint)* | `POST api.anthropic.com/v1/claude_code/routines/{id}/fire` with the per-routine token; `anthropic-version: 2023-06-01`, `anthropic-beta: experimental-cc-routine-2026-04-01`; deep links to `claude.ai/code/routines/…` and `…/sessions/…` | `backend/src/connectors/ClaudeConnector.ts`, `backend/src/services/claudeRoutines.ts`, `claudeConnection.ts` | docs.claude.com/en/release-notes/api; the Claude Code routines docs | — |
| **Gemini API Triggers** *(v1beta preview)* | `generativelanguage.googleapis.com`, `x-goog-api-key`; `/v1beta/triggers[/{id}]`, `…/{id}/executions`, `/v1beta/interactions/{id}`. Response quirks: executions under `trigger_executions`; statuses `completed` / `in_progress`; `interaction.input` written as a string, read back as an array; `PATCH` rejects `schedule` | `backend/src/services/geminiApi.ts`, `geminiTriggers.ts`, `backend/src/connectors/GeminiTriggersConnector.ts` | ai.google.dev/gemini-api/docs/changelog | 2026-10-08 |
| **GitHub Actions** *(read-only)* | `api.github.com`, `X-GitHub-Api-Version: 2022-11-28`; workflows, `/contents/{path}` (schedule parsed from YAML), `…/runs?event=schedule`, `/actions/runs/{id}/jobs` | `backend/src/services/githubActions.ts`, `githubRepositories.ts`, `backend/src/connectors/GitHubActionsConnector.ts` | docs.github.com/en/rest/about-the-rest-api/api-versions; github.blog/changelog | 2026-10-08 (2022-11-28 supported to 2028-03-10; 2026-03-10 now exists) |
| **Vercel Cron** *(read-only)* | `api.vercel.com`, Bearer token; `/v2/user`, `/v9/projects/{idOrName}`, `/v10/projects` with `teamId`/`slug`; reads `crons.definitions[] {host,path,schedule}` | `backend/src/services/vercelApi.ts`, `vercelProjects.ts`, `backend/src/connectors/VercelCronConnector.ts` | vercel.com/changelog; vercel.com/docs/cron-jobs | — |
| **n8n** *(public API v1 for reads; instance MCP server for `run`)* | **MCP**: `{base}/mcp-server/http`, `Authorization: Bearer <MCP access token>` (Settings › MCP access, 1.121+), streamable HTTP (JSON or SSE replies, `Mcp-Session-Id`), `execute_workflow { workflowId, executionMode: "production", triggerNodeName? (2.36+) }` → `{ executionId, status: started\|error, error? }`; a workflow must be marked *Available in MCP*. **REST**: `{base}/api/v1`, `X-N8N-API-KEY`; `GET /workflows` (cursor, limit 250) carries `activeVersion` = the published graph; `/workflows/{id}`, `/executions?workflowId=`, `/executions/{id}?includeData=true`. Schedule Trigger v1.4 `rule.interval[]` with defaults **omitted from the body** (weeks → Sunday, minute → 0); statuses `success` / `error` / `crashed` / `canceled` / `running` / `waiting`; no execute endpoint; no workflow→folder field (`?parentFolderId=` is a 400); `GENERIC_TIMEZONE` not exposed | `backend/src/services/n8nApi.ts`, `n8nSchedule.ts`, `n8nConnection.ts`, `backend/src/connectors/N8nConnector.ts` | docs.n8n.io/release-notes; docs.n8n.io/api (watch: folder membership on workflows, an execute endpoint, the Schedule Trigger's defaults) | 2026-10-04 |
| **Windows Task Scheduler** *(via the .NET agent)* | `TaskScheduler` NuGet 2.12.2; exported XML is UTF-16 LE with BOM; tasks created only under `\Cronsole`, `\Microsoft\` refused | `agent/Cronsole.Agent/Win32TaskScheduler.cs`, `TriggerBuilder.cs`, `TriggerReader.cs`, `TaskFolderPath.cs`, `backend/src/connectors/WindowsAgentConnector.ts` | github.com/dahall/TaskScheduler/releases; learn.microsoft.com/windows/win32/taskschd | — |
| **Windows Event Log** | `Microsoft-Windows-TaskScheduler/Operational` via `EventLogQuery`; `System.Diagnostics.EventLog` 9.0.0 | `agent/Cronsole.Agent/TaskHistoryReader.cs` | learn.microsoft.com/dotnet/api/system.diagnostics.eventing.reader | — |
| **Cronsole-native jobs** | SCRIPT interpreters `pwsh`, `bash`, `python`, `node` called by name from PATH | `backend/src/services/NativeTaskExecutor.ts`, `NativeScheduler.ts` | each runtime's release notes (breaking CLI changes only) | — |

## Notifications

| Upstream | What the code assumes | Code | Check at | Last checked |
|:---|:---|:---|:---|:---|
| **Resend** | `POST api.resend.com/emails` | `backend/src/services/FailureNotificationService.ts`, `notificationChannels.ts` | resend.com/changelog | — |
| **Discord webhooks** | Incoming webhook POST | same | discord.com/developers/docs/change-log | — |
| **ntfy** | Publish via HTTP POST | same | docs.ntfy.sh/releases | — |

## Protocols and SDKs

| Upstream | What the code assumes | Where | Check at | Last checked |
|:---|:---|:---|:---|:---|
| **MCP spec + TypeScript SDK** | `@modelcontextprotocol/sdk ^1.19.1` with `zod ^3.25.76` (the backend is on zod 4) | `mcp-server/` | github.com/modelcontextprotocol/typescript-sdk/releases; modelcontextprotocol.io/specification | — |
| **Socket.IO** | `socket.io` / `socket.io-client ^4.8.3`; .NET `SocketIOClient` 4.0.4; agent handshake `{agentId,nonce,ts,hmac}` (HMAC-SHA256) | `backend/src/ws/`, frontend hooks, `agent/Cronsole.Agent/SocketIOWrapper.cs` | github.com/socketio/socket.io/releases; github.com/doghappy/socket.io-client-csharp/releases | — |

## Runtime, stack, and hosting

| Upstream | Pinned | Where | Check at | Last checked |
|:---|:---|:---|:---|:---|
| **Node.js** | `node:20-alpine` in the Dockerfiles, 22 in CI, no `engines` field | `backend/Dockerfile`, `frontend/Dockerfile`, `.github/workflows/` | nodejs.org/en/about/previous-releases (EOL dates) | 2026-10-08 (20 is EOL since 2026-03-24; queued on ROADMAP) |
| **.NET** | `net10.0` | `agent/**/*.csproj` | dotnet.microsoft.com/platform/support/policy | — |
| **Prisma** | 6.19.3 exact | `backend/package.json`, `backend/prisma/` | github.com/prisma/prisma/releases | — |
| **Postgres, Redis, Caddy, cloudflared images** | `postgres:16-alpine`, `redis:7-alpine`, `caddy:2.10-alpine`, `cloudflare/cloudflared:2025.8.1` | `docker-compose.yml` | each project's releases / EOL page | — |
| **Express, React, react-router, Vite, Tailwind, TanStack Query, TypeScript, Vitest, Playwright** | see each `package.json` | `backend/`, `frontend/`, `mcp-server/` | each project's GitHub releases | — |
| **GitHub Actions and Pages** | `actions/checkout@v4`, `setup-node@v4`, `setup-dotnet@v4`; three publish workflows push to Pages repos | `.github/workflows/` | the actions' releases pages; docs.github.com/pages | — |

Flag breaking majors, EOL runtimes, and security advisories only. Routine bumps are
Dependabot's job. The hosted template registry (`mikesailab.com/cronsole-registry/`) is ours,
not an upstream.
