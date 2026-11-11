# Upstreams

Every external platform, protocol, library, and host Cronsole depends on, what the code
assumes about each, and where to check whether that assumption still holds. The biweekly
***Cronsole Upstream Check** Claude scheduled task (`upstream/auto-*` PRs) works from this file. Keep it
current by hand too: a new connector is a new row.

Connectors live in `backend/src/connectors/` behind `platform.interface.ts`, listed in
`registry.ts`. **Last checked** is filled in by that task, and only with a date it actually
read the source. `—` means never checked.

## Sources (the connectors)

| Upstream | What the code assumes | Code | Check at | Last checked |
|:---|:---|:---|:---|:---|
| **Claude Code triggers** *(undocumented OAuth API; highest drift risk)* | `ANTHROPIC_BASE_URL` or `api.anthropic.com`; `GET/POST /v1/code/triggers[/{id}]`, `POST /v1/code/triggers/{id}/run`, `GET /v1/code/sessions`; header `anthropic-beta: ccr-triggers-2026-01-30`; token read from `~/.claude/.credentials.json` → `claudeAiOauth.{accessToken,expiresAt}`, never refreshed | `backend/src/services/claudeTriggers.ts`, `claudeOAuth.ts` | github.com/anthropics/claude-code/blob/main/CHANGELOG.md (no API announcements exist; watch for trigger, routine, and credentials-file changes) | 2026-11-05 (changelog to 2.1.318: nothing on the triggers API or the credentials file) |
| **Claude Code scheduled tasks** *(documented fire endpoint)* | `POST api.anthropic.com/v1/claude_code/routines/{id}/fire` with the per-task token; `anthropic-version: 2023-06-01`, `anthropic-beta: experimental-cc-routine-2026-04-01`; deep links to `claude.ai/code/routines/…` and `…/sessions/…` | `backend/src/connectors/ClaudeConnector.ts`, `backend/src/services/claudeRoutines.ts`, `claudeConnection.ts` | docs.claude.com/en/release-notes/api; the Claude Code routines docs | 2026-11-05 (platform.claude.com API release notes to 2026-11-02: nothing on the fire endpoint or either header; docs.claude.com redirects there) |
| **Gemini API Triggers** *(v1beta preview)* | `generativelanguage.googleapis.com`, `x-goog-api-key`; `/v1beta/triggers[/{id}]`, `…/{id}/executions`, `/v1beta/interactions/{id}`. Response quirks: executions under `trigger_executions`; statuses `completed` / `in_progress`; `interaction.input` written as a string, read back as an array; `PATCH` rejects `schedule` | `backend/src/services/geminiApi.ts`, `geminiTriggers.ts`, `backend/src/connectors/GeminiTriggersConnector.ts` | aistudio.google.com/docs/changelog (ai.google.dev/gemini-api/docs/changelog 301s there) | 2026-11-05 (to 2026-11-05: nothing on triggers; the 2026-11-02 Gemini 2.5 deprecations don't touch us, no model ID in the code) |
| **GitHub Actions** *(read-only)* | `api.github.com`, `X-GitHub-Api-Version: 2022-11-28`; workflows, `/contents/{path}` (schedule parsed from YAML), `…/runs?event=schedule`, `/actions/runs/{id}/jobs` | `backend/src/services/githubActions.ts`, `githubRepositories.ts`, `backend/src/connectors/GitHubActionsConnector.ts` | docs.github.com/en/rest/about-the-rest-api/api-versions; github.blog/changelog | 2026-11-05 (2022-11-28 supported to 2028-03-10; 2026-03-10 is the newest; `pull_request_target` becomes blocked by default 2026-12-02 per github.blog/changelog, and no workflow here uses it) |
| **Vercel Cron** *(read-only)* | `api.vercel.com`, Bearer token; `/v2/user`, `/v9/projects/{idOrName}`, `/v10/projects` with `teamId`/`slug`; reads `crons.definitions[] {host,path,schedule}` | `backend/src/services/vercelApi.ts`, `vercelProjects.ts`, `backend/src/connectors/VercelCronConnector.ts` | vercel.com/changelog; vercel.com/docs/cron-jobs | 2026-11-05 (changelog pages 1-2, to 2026-11-04: nothing on crons or the REST API) |
| **n8n** *(public API v1 for reads; instance MCP server for `run`)* | **MCP**: `{base}/mcp-server/http`, `Authorization: Bearer <MCP access token>` (Settings › MCP access, 1.121+), streamable HTTP (JSON or SSE replies, `Mcp-Session-Id`), `execute_workflow { workflowId, executionMode: "production", triggerNodeName? (2.36+) }` → `{ executionId, status: started\|error, error? }`; a workflow must be marked *Available in MCP*. **REST**: `{base}/api/v1`, `X-N8N-API-KEY`; `GET /workflows` (cursor, limit 250) carries `activeVersion` = the published graph; `/workflows/{id}`, `/executions?workflowId=`, `/executions/{id}?includeData=true`. Schedule Trigger v1.4 `rule.interval[]` with defaults **omitted from the body** (weeks → Sunday, minute → 0); statuses `success` / `error` / `crashed` / `canceled` / `running` / `waiting`; no execute endpoint; no workflow→folder field (`?parentFolderId=` is a 400); `GENERIC_TIMEZONE` not exposed | `backend/src/services/n8nApi.ts`, `n8nSchedule.ts`, `n8nConnection.ts`, `backend/src/connectors/N8nConnector.ts` | docs.n8n.io/release-notes; docs.n8n.io/api (watch: folder membership on workflows, an execute endpoint, the Schedule Trigger's defaults) | 2026-11-05 (n8n 3.0 shipped 2026-10-27; its breaking-changes page lists nothing on the public API, the MCP server or `GENERIC_TIMEZONE`, removes the Cron and Interval nodes (Schedule Trigger is the replacement and is unchanged), and unpublishes workflows using removed nodes) |
| **Windows Task Scheduler** *(via the .NET agent)* | `TaskScheduler` NuGet 2.12.2; exported XML is UTF-16 LE with BOM; tasks created only under `\Cronsole`, `\Microsoft\` refused | `agent/Cronsole.Agent/Win32TaskScheduler.cs`, `TriggerBuilder.cs`, `TriggerReader.cs`, `TaskFolderPath.cs`, `backend/src/connectors/WindowsAgentConnector.ts` | github.com/dahall/TaskScheduler/releases; learn.microsoft.com/windows/win32/taskschd | 2026-11-05 (2.12.2 is still the latest release) |
| **Windows Event Log** | `Microsoft-Windows-TaskScheduler/Operational` via `EventLogQuery`; `System.Diagnostics.EventLog` 9.0.22 | `agent/Cronsole.Agent/TaskHistoryReader.cs` | learn.microsoft.com/dotnet/api/system.diagnostics.eventing.reader | 2026-10-22 (MS docs page not read; pin corrected from the csproj again on 2026-11-05, it was 9.0.20 here and 9.0.22 in the file) |
| **Cronsole-native jobs** | SCRIPT interpreters `pwsh`, `bash`, `python`, `node` called by name from PATH | `backend/src/services/NativeTaskExecutor.ts`, `NativeScheduler.ts` | each runtime's release notes (breaking CLI changes only) | 2026-11-05 (Node releases list: 24.22.2 and 26.13.0 out, 27 at alpha; nothing read on pwsh/bash/python CLIs) |

## Notifications

| Upstream | What the code assumes | Code | Check at | Last checked |
|:---|:---|:---|:---|:---|
| **Resend** | `POST api.resend.com/emails` | `backend/src/services/FailureNotificationService.ts`, `notificationChannels.ts` | resend.com/changelog | unreachable 2026-10-22 (index page has no dates or entry text) |
| **Discord webhooks** | Incoming webhook POST | same | docs.discord.com/developers/change-log (moved from discord.com/developers/docs/change-log) | 2026-11-05 (newest entries to 2026-10-30 read: nothing on webhooks; page truncated at 100k characters) |
| **ntfy** | Publish via HTTP POST with `Title` and `Tags` headers (server 2.28.0 caps a title at 1 KB and all tags at 512 bytes, 400 above that; task names are capped at 200 chars) | same | docs.ntfy.sh/releases | 2026-11-05 (read to 2.37.2: no change to Title or Tags handling; 2.37.0 adds `Retry-After` and `RateLimit` response headers) |

## Protocols and SDKs

| Upstream | What the code assumes | Where | Check at | Last checked |
|:---|:---|:---|:---|:---|
| **MCP spec + TypeScript SDK** | `@modelcontextprotocol/server ^2.4.0` (+ `client` as a dev dependency for the tests) with `zod ^4.6.7` (v2 requires `^4.2`). Moved from 1.x on 2026-10-30; 1.x gets fixes only until about 2027-01-27 | `mcp-server/` | github.com/modelcontextprotocol/typescript-sdk/releases; modelcontextprotocol.io/specification | 2026-11-05 (`@modelcontextprotocol/server` 2.4.0 is still the latest; newest spec release is 2026-07-28) |
| **Socket.IO** | `socket.io` / `socket.io-client ^4.8.4`; .NET `SocketIOClient` 4.0.5; agent handshake `{agentId,nonce,ts,hmac}` (HMAC-SHA256) | `backend/src/ws/`, frontend hooks, `agent/Cronsole.Agent/SocketIOWrapper.cs` | github.com/socketio/socket.io/releases; github.com/doghappy/socket.io-client-csharp/releases | 2026-11-05 (socket.io 4.8.4 and the C# client v4.0.2 are still the latest releases; the pin was `^4.8.3` here and `^4.8.4` in the package.json files) |

## Runtime, stack, and hosting

| Upstream | Pinned | Where | Check at | Last checked |
|:---|:---|:---|:---|:---|
| **Node.js** | `node:22-alpine3.23` in the Dockerfiles, 22 in CI, `engines.node >=22` in the three `package.json` files | `backend/Dockerfile`, `frontend/Dockerfile`, `.github/workflows/` | nodejs.org/en/about/previous-releases (EOL dates) | 2026-10-23 (20 was EOL 2026-04-30; images moved to 22 the same day) |
| **.NET** | `net10.0` | `agent/**/*.csproj` | dotnet.microsoft.com/platform/support/policy | 2026-11-05 (.NET 10 LTS supported to 2028-11-14; latest patch 10.0.14) |
| **Prisma** | 7.10.1 exact (`prisma`, `@prisma/client`, `@prisma/adapter-pg`); `prisma.config.ts` holds the datasource URL | `backend/package.json`, `backend/prisma/`, `backend/prisma.config.ts` | github.com/prisma/prisma/releases | 2026-11-05 (7.10.1 is still the latest stable; 8.0.0-rc.22 is the newest rc) |
| **Postgres, Caddy, cloudflared images** | `postgres:16-alpine`, `caddy:2.11-alpine`, `cloudflare/cloudflared:2025.11.1` | `docker-compose.yml` | each project's releases / EOL page | 2026-11-05 (Caddy 2.11.9 and cloudflared 2026.10.7 are the latest releases, so the `cloudflared:2025.11.1` pin is a year old; EOL pages for Postgres and Redis not re-read, last read 2026-10-22) |
| **Express, React, react-router, Vite, Tailwind, TanStack Query, TypeScript, Vitest, Playwright** | see each `package.json` | `backend/`, `frontend/`, `mcp-server/` | each project's GitHub releases | 2026-11-05 (`npm audit --omit=dev`: 0 advisories in backend, frontend and mcp-server; majors not re-surveyed since 2026-10-22) |
| **GitHub Actions and Pages** | `actions/checkout@v7`, `setup-node@v7`, `setup-dotnet@v6` (bumped 2026-11-06, the Node-24 majors); three publish workflows push to Pages repos. Node 20 was removed from runners 2026-09-23 | `.github/workflows/` | the actions' releases pages; github.blog/changelog/label/actions; docs.github.com/pages | 2026-11-05 (latest: checkout v7.0.1, setup-node v7.1.0, setup-dotnet v6.1.0; pins match the latest majors) |

Flag breaking majors, EOL runtimes, and security advisories only. Routine bumps are
Dependabot's job. The hosted template registry (`cronsole.ai-automation-tools.dev`) is ours,
not an upstream.
