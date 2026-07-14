# Workflows

Load when doing one of the common jobs. Each is the *sequence* — the docs have the detail.

## Run the stack

```powershell
pwsh scripts/taskhub.ps1 up        # idempotent — starts anything not running
pwsh scripts/taskhub.ps1 status    # one table, every service + health (default)
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
5. Large diff → invoke the **`code-reviewer`** skill before declaring done.
6. Commit: conventional prefix, imperative subject.
7. **End of session:** if a deliverable shipped or scope shifted, update `docs/ROADMAP.md`
   (dated). New setup/runtime trap → add to `docs/troubleshooting/README.md`.
