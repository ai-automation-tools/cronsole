---
allowed-tools: Read, Bash, Grep, Glob
argument-hint: (no args) | --stale | --agent | --mcp | --fix
description: Diagnose a Cronsole stack that builds but misbehaves — the three processes that run stale, agent connectivity, and MCP token expansion
---

# Cronsole Doctor

Run **before** debugging your own code when live behavior contradicts the source.

## Why this exists

Cronsole has **three processes that run stale**, and each one presents as a bug in your
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

**Skip this check entirely unless `taskhub-proxy-1` is up** — on a normal stack nothing serves
`frontend/dist`, which is why it is not on the standing stale list.

```bash
docker ps --filter "name=taskhub-proxy" --format "{{.Names}}"          # empty => skip
cd frontend/dist/assets && grep -o '.\{4\}`same-origin`.\{4\}' index-*.js | tail -1
```

Two different failures, and they present as **opposites** — do not diagnose one as the other:

| Proxied page | Requests | Cause | Entry |
|:---|:---|:---|:---|
| Older than `:7373` | fine | never rebuilt | [#53](../../docs/troubleshooting/README.md#53-the-proxied-dashboard-is-stale-while-the-dev-server-is-current) |
| Current | all fail, *cannot reach backend* | built with `npm run build`, not `build:remote` | [#63](../../docs/troubleshooting/README.md#63-the-proxied-dashboard-loads-on-the-phone-but-cannot-reach-the-backend) |

The grep reads the **call**, not the occurrence: `Rl(\`same-origin\`)` is a correct remote build,
`Rl(\`http://localhost:3000\`)` is the wrong mode. Searching for either string on its own proves
nothing — both appear in every bundle. Fix for both: `cd frontend && npm run build:remote` (the
mount is live; no container restart).

## Report format

Give a verdict table, then the **single most likely cause** and its fix. Cite the
troubleshooting entry number where one exists. If everything passes, say so plainly and
say that the problem is likely in the changed code after all — that is a real result, not
a failure to find something.

## Arguments

- `--stale` — only the three stale-prone processes (checks 2–4)
- `--agent` — only agent connectivity and build currency (check 3)
- `--mcp` — only the MCP server and token (check 4)
- `--fix` — apply the safe fixes (`docker restart`, `npm run build` in `mcp-server/`). **Never**
  auto-run the agent republish: it needs elevation and would kill a running agent. In `frontend/`
  the fix is **`npm run build:remote`**, never plain `build` — see check 7.

$ARGUMENTS
