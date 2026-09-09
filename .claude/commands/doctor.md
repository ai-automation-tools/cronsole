---
allowed-tools: Read, Bash, Grep, Glob
argument-hint: (no args) | --stale | --agent | --mcp | --dist | --db | --fix
description: Diagnose a Cronsole stack that builds but misbehaves — the five things that run stale (incl. the database schema and the proxied frontend bundle), agent connectivity, and MCP token expansion
---

# Cronsole Doctor

Run **before** debugging your own code when live behavior contradicts the source.

## Why this exists

Cronsole has **five things that run stale**, and each one presents as a bug in your logic
rather than a stale process. Four are always live; the last only matters while the reverse
proxy is running:

| Stale thing | Presents as | Because |
|:---|:---|:---|
| **Dockerized backend** | New route 404s; live request disagrees with source; offline tests pass | Windows→Linux bind mounts do not propagate inotify, so `tsx watch` never fires |
| **Published .NET agent** | New agent command 502s "Agent … timeout" after ~15s; DB-only paths work | It is a host process running a published exe; it never hot-reloads |
| **`mcp-server/dist/`** | Tool behaves like the old code | The host runs `dist/`, not `src/` — an unbuilt change is invisible |
| **The database schema** | A whole feature 500s with a bare *"Internal server error"* — every route, including reads | A committed migration was never applied. `schema.prisma`, the client and the tests all agree; only the database disagrees, so nothing else can see it |
| **`frontend/dist/`** *(only while the proxy runs)* | The proxied page works perfectly and is **from another day**; `:7373` is current | Nothing rebuilds it — `cronsole up` starts the proxy but never runs a build |

Most "impossible" behavior is one of these. Check them before suspecting your own code.

## Instructions

Work through each check and **report a verdict per check** — do not stop at the first
finding. Prefer asking the running system over inferring from files.

### 1. Is the stack even up?

```bash
docker ps --filter "name=taskhub" --format "table {{.Names}}\t{{.Status}}"
```

If port 3000 is `LISTENING` but requests return `HTTP 000`: **do not chase the port.**
Docker's port proxy holds it while the app inside crashed. Read `docker logs
taskhub-backend-1` for why the process died.

### 2. Is the backend serving current code?

The tell that distinguishes a stale backend from a missing route: a stale backend **404s**
the new route entirely ("Cannot GET"), whereas a live route with a bad id returns **your
handler's** error. If a route you just wrote 404s:

```bash
docker restart taskhub-backend-1
```

### 2b. Is the **database** on this checkout's schema?

```bash
node scripts/check-migrations-applied.mjs
```

Run this early, and **run it before reading any application code**, whenever a newly added
platform, status or job type misbehaves. It is the only check here that asks the database
rather than the working tree, and it is the one failure that leaves no other trace:
`schema.prisma` has the value, the generated client has the value, `tsc` passes and the suite
is green — the database is the single place it is missing, and Postgres answers `invalid input
value for enum`, which surfaces as a bare 500.

The tell: a feature that fails **uniformly and instantly**, on read routes as well as writes,
with no message. `PENDING` → `cd backend && npx prisma migrate deploy`. `UNKNOWN` means no
database was reachable, which is a different answer from "up to date" — start the stack and
ask again ([#81](../../docs/troubleshooting/README.md#81-a-brand-new-source-returns-internal-server-error-the-moment-you-open-it)).

### 3. Is the agent connected, and is it the build you think?

Ask the backend, not the process list:

```bash
curl -s http://localhost:3000/api/tasks/health -H "Authorization: Bearer $CRONSOLE_TOKEN"
```

`WINDOWS_TASK_SCHEDULER` should be `HEALTHY` with a recent `lastSync`.

> **An unelevated `Get-Process Cronsole.Agent` returning nothing does NOT mean the agent is
> down** — for two independent reasons. It runs elevated, so it is invisible to an unelevated
> shell; and **an agent launched before the 2026-07-31 exe rename is still named
> `TaskHub.Agent`**, so it is invisible to that lookup at any privilege level. Ask for both
> names — `Get-Process -Name 'Cronsole.Agent','TaskHub.Agent'` — and treat the health
> endpoint as the reliable signal either way (troubleshooting #35a).

To check the build is current, compare the published dll against the source:

```powershell
Get-Item ".\agent\publish\Cronsole.Agent.dll" | Select-Object LastWriteTime
Get-ChildItem ".\agent\Cronsole.Agent" -Recurse -Filter *.cs |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1 LastWriteTime
```

If any `.cs` is **newer** than the dll, the agent is stale — republish it from an
**Administrator** prompt (see [troubleshooting #7](../../docs/troubleshooting/README.md#7-new-agent-command-502-times-out-until-the-agent-is-republished)).

If Windows shows `OFFLINE` right after you ran a transient/dogfood agent, the transient one
displaced the real agent's socket registration: `docker compose restart backend`.

### 4. Is the MCP server usable?

```powershell
# Is dist/ built, and is it newer than src/?
Get-Item ".\mcp-server\dist\index.js" | Select-Object LastWriteTime
Get-ChildItem ".\mcp-server\src" -Filter *.ts |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1 LastWriteTime

# Is the token actually expanded in THIS process?
if ($env:CRONSOLE_TOKEN) { "set, length $($env:CRONSOLE_TOKEN.Length)" } else { "NOT SET" }
[Environment]::GetEnvironmentVariable('CRONSOLE_TOKEN','User') -ne $null
```

> **Do not check `TASKHUB_TOKEN` here.** Rename stage 2 **deleted that variable from the
> machine** (`Migrate-ToCronsole.ps1`), so probing it reports a failure that isn't real —
> it is guaranteed to print `NOT SET` on a perfectly healthy setup. This block did exactly
> that until 2026-07-31. The legacy name still exists in **one** place, and it is not this
> one: `mcp-server/src/client.ts` reads a `['TASK','HUB'].join('')` prefix as a fallback for
> a *user* whose old variable is still exported. That is a compatibility path in code, not a
> thing to diagnose.

**The `cronsole` MCP tools missing entirely is a symptom, not an absence of one.** The
server exits on startup when `CRONSOLE_TOKEN` is unset — the host forwards the literal
`${CRONSOLE_TOKEN}`, `configFromEnv()` detects it and refuses to start, and a host silently
drops a server that fails to boot. Check `/mcp` for the message.

If the variable is set at User scope but empty in this process: **the terminal predates the
change.** A process inherits its parent's environment — close the terminal entirely, open a
fresh one, relaunch. Restarting the host alone does nothing.
See [troubleshooting #8](../../docs/troubleshooting/README.md#8-every-mcp-tool-returns-403-invalid-or-expired-token).

### 5. Is auth actually broken, or does it just look that way?

`403 Invalid or expired token` has **two** unrelated causes — check the cheap one first:

- The token is the **unexpanded literal** (check #4). Nothing is expired.
- Docker baked **dev-only default secrets** that do not match your rotated `backend/.env`.
  Create a root `.env` mirroring it, then
  `docker compose up -d --force-recreate backend`.

### 6. Is the registry in sync?

```bash
cd backend && npm test   # the drift test fails if registry/ disagrees with bundled.ts
```

### 7. Only if the proxy is running: is `frontend/dist` right?

**`frontend/dist` is the fourth thing that runs stale, and the only one with no keeper.** The
other three announce themselves — a stale backend 404s, a stale agent 502s, an unbuilt
`mcp-server/dist` behaves like old code. A stale `dist` serves a **complete, working,
correct-looking dashboard from another day**. Nothing errors, nothing logs, and `:7373` is
current the whole time, so the two addresses disagree and only the one you are not looking at
is wrong.

```bash
node scripts/check-dist-fresh.mjs
```

It **omits itself** when the proxy is down (nothing serves `dist`, so its age is a fact about
nothing) and reports `UNKNOWN` when Docker cannot be asked — neither is a pass. `--force`
measures anyway. Verdicts: `OK` · `STALE` · `NEVER BUILT` · `UNKNOWN`.

| Verdict | Means | Fix |
|:---|:---|:---|
| `STALE` | The proxied page is older than the source | `cd frontend && npm run build` — the mount is live, no container restart ([#53](../../docs/troubleshooting/README.md#53-the-proxied-dashboard-is-stale-while-the-dev-server-is-current)) |
| `NEVER BUILT` | Proxy is up, `dist` absent — the page is a 404, not a stale page | `cd frontend && npm run build` |

> **`cronsole up` starts the proxy and does not rebuild `dist`** — deliberately. Rebuilding on
> every `up` would let a routine start command silently replace what is being served, which is a
> worse property than an occasional stale bundle. The gap is closed by reporting, per the
> standing rule that a diagnostic reports and does not repair.

**Do not diagnose the API-origin failure from the bundle's bytes.** Since the 2026-08-17 fold
(`FALLBACK_API_ORIGIN` in `frontend/src/api.ts`), **`npm run build` and `npm run build:remote`
produce the same correct same-origin bundle** — there is no longer a wrong command to run, and
`.env.remote` says so itself. The old advice here, to grep for a `same-origin` *call* and to
always prefer `build:remote`, is superseded: `http://localhost:3000` still appears once in a
**correct** build, and the minifier now emits an assignment rather than the documented call
shape, so that grep distinguishes nothing.

What can still bake a wrong origin is an **input**: `VITE_API_URL` set in `frontend/.env.local`,
which Vite loads in *every* mode and compiles in as a literal. `check-dist-fresh.mjs` reports
that alongside its verdict. That is the live form of
[#63](../../docs/troubleshooting/README.md#63-the-proxied-dashboard-loads-on-the-phone-but-cannot-reach-the-backend)
— the page loads fine on a phone and reaches no backend.

## Report format

Give a verdict table, then the **single most likely cause** and its fix. Cite the
troubleshooting entry number where one exists. If everything passes, say so plainly and
say that the problem is likely in the changed code after all — that is a real result, not
a failure to find something.

## Arguments

- `--stale` — only the stale-prone processes (checks 2, 2b, 3, 4)
- `--db` — only the migration-status check (check 2b)
- `--agent` — only agent connectivity and build currency (check 3)
- `--mcp` — only the MCP server and token (check 4)
- `--dist` — only the proxied-bundle freshness check (check 7)
- `--fix` — apply the safe fixes (`docker restart`, `npm run build` in `mcp-server/` and, when
  check 7 reports `STALE`, in `frontend/`). **`prisma migrate deploy` is included**: it applies
  only migrations already committed to this checkout, which is the state the rest of the repo
  already assumes. It is still reported before it is run. **Never** auto-run the agent republish: it needs
  elevation and would kill a running agent. Plain `npm run build` is correct in `frontend/`
  since the 2026-08-17 fold — see check 7.

$ARGUMENTS
