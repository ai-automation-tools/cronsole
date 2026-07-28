# Workflows

Load when doing one of the common jobs. Each is the *sequence* — the docs have the detail.

## Run the stack

```powershell
pwsh scripts/taskhub.ps1 up        # idempotent — starts anything not running
pwsh scripts/taskhub.ps1 status    # one table, every service + the signal used (default)
pwsh scripts/taskhub.ps1 logs      # tail backend/frontend/launcher
pwsh scripts/taskhub.ps1 down      # stop app tier (leaves db/redis)
pwsh scripts/taskhub.ps1 down -All # also stop db/redis containers
```

Five pieces: Postgres + Redis (Docker), backend + frontend (host Node), agent (host `.exe`).
The script exists so you stop wondering which part is down. **Use it before hand-rolling
docker commands.**

Get a dev token for API work:

```powershell
cd backend
node -r dotenv/config -e "console.log(require('jsonwebtoken').sign({id:'cli_user_placeholder',email:'mike@example.com'}, process.env.JWT_SECRET, {expiresIn:'3650d'}))"
```

Or read `VITE_DEV_TOKEN` from `frontend/.env.local`. A `403` means it was signed with a
different secret than the running backend uses — trap #2.

## Add or change a template

```bash
# 1. Edit the SOURCE OF TRUTH (never seed.ts, never registry/)
#    backend/src/catalog/bundled.ts
# 2. Rebuild the generated registry
cd backend && npm run registry:build
# 3. Drift + whole-catalog resolvability guards
npm test
# 4. Commit bundled.ts AND registry/ together — they must stay in lockstep
# 5. Mirror to the public repo (does NOT regenerate — build first)
pwsh scripts/publish-registry.ps1
```

Decisions to make: **tier** (`core: true` only if it earns a slot in the 5-template sampler),
**tags** (free-form, distinct from `category`), and **shell** (keep `exec` no-shell unless it
genuinely needs one). Detail: [templates.md](templates.md).

## Republish the agent (do this after ANY `agent/` change)

The agent **never hot-reloads** — it's a host process running the published exe. Testing an
agent change without republishing means testing the *old* build, which is
[trap #7](../../../docs/troubleshooting/README.md#7-new-agent-command-502-times-out-until-the-agent-is-republished).

**Easy way** (register once, elevated; then no elevation ever again):

```powershell
.\scripts\startup-task\Register-RepublishTask.ps1        # ONE time, Administrator
Start-ScheduledTask -TaskPath '\Task-Hub\' -TaskName 'TaskHubRepublish'   # any prompt
Get-Content "$env:TEMP\taskhub-republish.log" -Tail 20   # it logs — read it
```

**Manual way** — Administrator prompt, `Get-Process TaskHub.Agent | Stop-Process -Force`
then `dotnet publish` then `taskhub.ps1 up`. The stop is the step that matters.

**Verify it took.** The published dll must be newer than the newest `.cs`. And an unelevated
`Get-Process TaskHub.Agent` returning nothing does **not** mean it's down — it runs elevated
and may be invisible to you. Ask `GET /api/tasks/health` instead; that's authoritative.

## Add a new agent command

The one most likely to waste your afternoon — **two processes must ship together.**

1. Define the command both sides: `noun:verb` type, `{ type, payload }` envelope.
2. Backend: route → connector method → `AgentManager` emit. If it's a **mutating** command,
   it must be **HMAC-signed**; read-only (like `task:export`) needn't be.
3. Agent: add the handler in `agent/src/`.
4. **Republish the agent** — it never hot-reloads. Admin prompt (the exe is locked and runs
   elevated):

```powershell
Get-Process TaskHub.Agent -ErrorAction SilentlyContinue | Stop-Process -Force
dotnet publish ".\agent\TaskHub.Agent" -c Release -r win-x64 --self-contained false -o ".\agent\publish"
pwsh .\scripts\taskhub.ps1 up
```

5. **Restart the backend too** — bind-mount edits don't hot-reload: `docker restart taskhub-backend-1`
6. Test: `dotnet test` + backend suites, then hand-verify with the
   [Windows Task Lifecycle runbook](../../../docs/testing/manual-testing/runbooks/Windows_Task_Lifecycle.md).

> Any change to the **signature side** of a signed command (e.g. a new `SignableCommand`
> variant) **must ship with the agent** — a mismatch surfaces as a rejected or timed-out
> command, not a clear error.

## Add a new platform connector

1. Implement `PlatformConnector` in `backend/src/connectors/<Platform>Connector.ts`.
2. Register in `backend/src/connectors/registry.ts`.
3. **Only implement the optional methods you can honestly do.** Leaving `deleteTask?`
   undefined *is* the design — a stub returning `{ success: true }` converts a missing
   capability into a lie.
4. Add the `PlatformType` enum value (Prisma migration).
5. **No platform-specific logic outside the connector layer.**

## Add an API route

1. Route in `backend/src/routes/{tasks,templates,auth}.ts`.
2. **Validate at the boundary with Zod.** Trust internal code.
3. **Scope by `userId`.** Every new route is a fresh chance to leak across tenants.
4. **Add it to the IDOR sweep** (`backend/test/integration/idor.integration.test.ts`) **in the
   same PR** — reads *and* mutations.
5. Index any new `WHERE`/`JOIN`/`ORDER BY` column.
6. `docker restart taskhub-backend-1` before testing live, or you'll debug a stale process.
7. **Does an MCP tool map to this route?** (`/api/tasks`, `/api/tasks/:id/run`, `/api/templates`,
   `/api/templates/:id/apply`, `/api/tasks/preview` — see [Change the MCP server](#change-the-mcp-server).)
   If so, the wrapper and its two tool tables move **in this change**, not later.

## Change the MCP server

`mcp-server/` is a **thin wrapper — it owns no logic.** Every tool is a call to a backend
route, which is what keeps owner scoping, no-shell `exec`, signed agent commands, and
cron→trigger conversion in one tested place. **New behavior means a new backend route**, never
cleverness in the wrapper.

The 15 tools and their routes:

| Tool | Route | |
|:---|:---|:---|
| `list_tasks` | `GET /api/tasks` | |
| `list_templates` | `GET /api/templates` | |
| `list_folders` | `GET /api/tasks/folders` | |
| `get_task_history` | `GET /api/tasks/:id/executions` | |
| `export_task` | `GET /api/tasks/:id/export` | raw bytes — UTF-16 LE + BOM |
| `convert_schedule` | `POST /api/tasks/preview` | |
| `create_task` | `POST /api/tasks` | |
| `create_native_task` | `POST /api/tasks/native` | full job spec, not a command string |
| `create_task_from_template` | `POST /api/templates/:id/apply` | |
| `run_task` | `POST /api/tasks/:id/run` | |
| `set_task_status` | `PATCH /api/tasks/:id/status` | reversible → ungated |
| `update_task_schedule` | `PATCH /api/tasks/:id/schedule` | reversible → ungated |
| `update_task_action` | `PATCH /api/tasks/:id/actions` | replaces, doesn't patch |
| `untrack_task` | `POST /api/tasks/:id/untrack` | drops TaskHub's row, **no platform call** → ungated |
| `delete_task` | `DELETE /api/tasks/:id` | **gated** by `TASKHUB_MCP_ALLOW_DESTRUCTIVE` |

**The gating rule, if you add more** (settled 2026-07-15): irreversible verbs are gated and
**absent** from `tools/list` when off; reversible ones are not. The gate is an **env var, not a
tool param** — a param is filled in by the model, so it's the caller assuring itself it's sure.
**The route existing is not by itself a reason to expose it.** Still REST-only: template
import/export, save-as-template, sync, agent pairing.

**Adding a tool ships with**: the vitest suite (`src/__tests__/tools.test.ts` — its surface test
pins the exact tool list and will fail, deliberately), both README tool tables, and the skill
(§11a). Run `npm test && npm run typecheck && npm run build` — vitest does **not** typecheck, and
`start` runs `dist/`.

1. Tool registration + Zod input schema → `mcp-server/src/tools.ts`. HTTP + error
   normalization → `client.ts`. Bootstrap → `index.ts`.
2. **stdout is sacred** — it's the JSON-RPC stream. All logging goes to `stderr`
   (`console.error`). A stray `console.log` corrupts the protocol.
3. **Return `isError: true` with a readable reason; never throw.** The model should see
   `Task not found`, not a stack trace. An honest refusal beats a broken task.
4. Update **both** tool tables — [`mcp-server/README.md`](../../../mcp-server/README.md) and
   [`MCP_Server_Guide.md`](../../../docs/user-guides/guides/MCP_Server_Guide.md) — plus the tool
   list in `SKILL.md` › "The two AI surfaces".
5. `npm run build` (tsc → `dist/`). **The host runs `dist/`, not `src/`** — an unbuilt change
   is invisible, and this is a third thing that runs stale.
6. Restart your MCP host to reload the server. `npm run inspect` drives it standalone via the
   MCP Inspector without a host in the way.

## Publish the sites

```powershell
pwsh scripts/publish-registry.ps1   # registry/ + registry-site/ → taskhub-registry
pwsh scripts/publish-landing.ps1    # landing-site/            → taskhub-site
```

Both reset their working clone to `origin/main` — **never keep manual work in
`Repos\Tools\taskhub-*`**. Both **exclude `README.md`** (the public repos own their front
pages). Neither regenerates the registry.

## Run the tests

```bash
cd backend  && npm test && npm run test:integration   # needs real Postgres
cd ../frontend && npm run lint && npm test
cd ../agent  && dotnet test
cd ../frontend && npm run test:e2e                     # needs a LIVE stack; not in CI
```

Before a release, also work the [manual runbooks](../../../docs/testing/manual-testing/README.md)
— they cover what no suite can (real COM, agent resilience, security at rest).

## Ship a change

1. **Read `docs/ROADMAP.md`.** A material decision updates it **first**, then you implement.
2. Non-trivial change → track it with a task list.
3. External library → **`context7` before writing**.
4. Write the test with the change. A bug fix ships with a test that failed before it.
5. **Sync the mirror surfaces in this change** — `mcp-server/` and the skill. Neither fails a
   test when it drifts; it just starts lying. See `SKILL.md` › "Keeping the mirror surfaces in
   sync" for which change obligates which surface.
6. Large diff → invoke the **`code-reviewer`** skill before declaring done.
7. Commit: conventional prefix, imperative subject.
8. **End of session:** if a deliverable shipped or scope shifted, update `docs/ROADMAP.md`
   (dated). New setup/runtime trap → add to `docs/troubleshooting/README.md`.
