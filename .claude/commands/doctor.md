---
allowed-tools: Read, Bash, Grep, Glob
argument-hint: (no args) | --stale | --agent | --mcp | --fix
description: Diagnose a TaskHub stack that builds but misbehaves — the three processes that run stale, agent connectivity, and MCP token expansion
---

# TaskHub Doctor

Run **before** debugging your own code when live behavior contradicts the source.

## Why this exists

TaskHub has **three processes that run stale**, and each one presents as a bug in your
logic rather than a stale process:

| Stale thing | Presents as | Because |
|:---|:---|:---|
| **Dockerized backend** | New route 404s; live request disagrees with source; offline tests pass | Windows→Linux bind mounts do not propagate inotify, so `tsx watch` never fires |
| **Published .NET agent** | New agent command 502s "Agent … timeout" after ~15s; DB-only paths work | It is a host process running a published exe; it never hot-reloads |
| **`mcp-server/dist/`** | Tool behaves like the old code | The host runs `dist/`, not `src/` — an unbuilt change is invisible |

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

### 3. Is the agent connected, and is it the build you think?

Ask the backend, not the process list:

```bash
curl -s http://localhost:3000/api/tasks/health -H "Authorization: Bearer $TASKHUB_TOKEN"
```

`WINDOWS_TASK_SCHEDULER` should be `HEALTHY` with a recent `lastSync`.

> **An unelevated `Get-Process TaskHub.Agent` returning nothing does NOT mean the agent is
> down.** It runs elevated and is invisible to an unelevated shell. The health endpoint is
> the reliable signal.

To check the build is current, compare the published dll against the source:

```powershell
Get-Item ".\agent\publish\TaskHub.Agent.dll" | Select-Object LastWriteTime
Get-ChildItem ".\agent\TaskHub.Agent" -Recurse -Filter *.cs |
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
if ($env:TASKHUB_TOKEN) { "set, length $($env:TASKHUB_TOKEN.Length)" } else { "NOT SET" }
[Environment]::GetEnvironmentVariable('TASKHUB_TOKEN','User') -ne $null
```

**The `taskhub` MCP tools missing entirely is a symptom, not an absence of one.** The
server exits on startup when `TASKHUB_TOKEN` is unset — the host forwards the literal
`${TASKHUB_TOKEN}`, `configFromEnv()` detects it and refuses to start, and a host silently
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

## Report format

Give a verdict table, then the **single most likely cause** and its fix. Cite the
troubleshooting entry number where one exists. If everything passes, say so plainly and
say that the problem is likely in the changed code after all — that is a real result, not
a failure to find something.

## Arguments

- `--stale` — only the three stale-prone processes (checks 2–4)
- `--agent` — only agent connectivity and build currency (check 3)
- `--mcp` — only the MCP server and token (check 4)
- `--fix` — apply the safe fixes (`docker restart`, `npm run build`). **Never** auto-run the
  agent republish: it needs elevation and would kill a running agent.

$ARGUMENTS
