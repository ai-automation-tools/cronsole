<a id="troubleshooting-top"></a>

<h1 align="center">🧯 Troubleshooting</h1>

<p align="center">
  <em>Symptom → cause → fix for problems we've actually hit running TaskHub.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/format-symptom_first-EF4444?style=for-the-badge" alt="Symptom first">
  <a href="../README.md"><img src="https://img.shields.io/badge/↩-docs_home-6B7280?style=for-the-badge" alt="Docs Home"></a>
</p>

---

Hit something weird? **Scan the symptom table**, jump to the entry, apply the fix. If you
solve a *new* problem — especially one that took more than a few minutes or that we're likely
to hit again — **add it here** while it's fresh (template at the bottom).

## 🔎 Quick lookup

| # | Symptom | Likely cause | Jump |
|:--|:---|:---|:--|
| 1 | Backend crash-loops on startup with an opaque `[Object: null prototype] {}` uncaught exception | `ts-node` can't parse the installed TypeScript version | [→](#1-backend-crash-loops-with-object-null-prototype) |
| 2 | Dashboard shows no tasks / `403 Invalid or expired token`; agent handshake rejected | Docker's default secrets don't match your rotated `backend/.env` | [→](#2-403-invalid-or-expired-token-or-agent-rejected) |
| 3 | Port 3000 shows as `LISTENING` but every request returns `HTTP 000` / `EADDRINUSE` on restart | Docker's port proxy holds the port even though the app process died | [→](#3-port-listening-but-http-000--eaddrinuse) |
| 4 | Edited backend source, but the running Docker stack still 404s the new route / serves old behavior | `tsx watch` inside the container never sees the file change (Windows→Linux bind-mount inotify) | [→](#4-backend-source-edits-not-picked-up-in-docker) |
| 5 | After running a second/transient agent for testing, Windows shows `OFFLINE` and won't recover even though the real agent process is still running | The transient agent displaced the real agent's socket registration; the idle real agent won't re-register until its socket drops | [→](#5-windows-offline-after-running-a-transient-test-agent) |
| 6 | A `.ps1` fails to parse under `powershell` (5.1) with `Unexpected token '}'` / `The string is missing the terminator` — but runs fine under `pwsh` (7) | A non-ASCII char (e.g. an em-dash `—`) in a BOM-less UTF-8 script; Windows PowerShell 5.1 reads it as ANSI and decodes it into a curly quote it treats as a string delimiter | [→](#6-ps1-parse-errors-under-windows-powershell-51-only) |
| 7 | A newly added agent command (e.g. a new `task:*` socket op) returns `502` with `... timeout` after ~15s, even though the backend route exists | The **.NET agent is a host process running the old published exe** — it doesn't hot-reload, so it has no handler for the new command and never answers; the backend times out | [→](#7-new-agent-command-502-times-out-until-the-agent-is-republished) |
| 8 | **Every** MCP tool returns `403 Invalid or expired token` — or the `taskhub` tools are **missing entirely** — while the dashboard and `curl` with a real token work fine | `TASKHUB_TOKEN` is unset, so Claude Code passed the **literal** `${TASKHUB_TOKEN}` through to the API — nothing is actually expired. Since the server now refuses to start on a literal, the tools go *missing* rather than 403 | [→](#8-every-mcp-tool-returns-403-invalid-or-expired-token) |
| 8a | …and the token **is** set at the User level, you restarted, and it's *still* invisible | A new terminal is not a new environment. A VS Code integrated terminal inherits `Code.exe`'s environment block, snapshotted when VS Code launched — new tabs and host restarts re-inherit the same stale one | [→](#8a-and-restart-from-a-fresh-terminal-does-nothing-under-vs-code) |
| 9 | A new agent command returns a well-formed payload where **every field is empty/false** — no error, no exception, the counts are even right | The agent emitted a C# object directly; the socket serializer does **not** camelCase, so the wire carries `Path`/`TaskCount` while the backend reads `f.path` → `undefined` for every field | [→](#9-agent-payload-arrives-with-every-field-empty) |
| 10 | `DeleteFolder` on a Task Scheduler folder fails with `Access is denied. (0x80070005 (E_ACCESSDENIED))` | Task Scheduler folder deletion requires **elevation**, even for a folder you created and even when it is empty | [→](#10-cannot-delete-a-task-scheduler-folder-e_accessdenied) |
| 11 | After a **System Restore**, `Start-ScheduledTask` says the republish task doesn't exist **and/or** the `taskhub` MCP tools vanish — while the repo, `git status`, and the build are all perfectly clean | Both live on `C:` as per-machine state git can't protect: the scheduled-task registration and the `TASKHUB_TOKEN` **User** env var. A restore of `C:` wipes them; a repo on another drive survives, so nothing *looks* wrong | [→](#11-after-a-system-restore-the-republish-task-and-mcp-tools-are-gone) |
| 12 | A task created from a template sits in `Running` **forever** (`LastTaskResult` `267009`), burning no CPU — while TaskHub cheerfully reports `lastRunStatus: SUCCESS`, and every test passes | The command is broken **on the target**, which no test checks. Classic cause: `Invoke-WebRequest` without `-UseBasicParsing` needs the **IE engine Windows 11 removed** → `NullReferenceException`, and with no console to write it to, the process blocks instead of exiting | [→](#12-a-template-passes-every-test-and-still-hangs-on-the-target) |
| 13 | The `taskhub` MCP tools are **missing** — and the token is fine: it's set, the host can see it, the backend is healthy, and `node mcp-server/dist/index.js` boots clean by hand | The server is **disabled in the host**, not broken. `disabledMcpjsonServers` in `.claude/settings.local.json` lists it — that's what Claude Code writes for **every** server in `.mcp.json` when you decline the "do you trust this project's MCP servers?" prompt | [→](#13-the-taskhub-mcp-tools-are-missing-while-the-token-is-fine) |

---

## 1. Backend crash-loops with `[Object: null prototype]`

**Symptom** — `docker logs taskhub-backend-1` (or `npm run dev` in `backend/`) prints a bare
uncaught exception and exits, restarting forever:

```
node:internal/modules/run_main:123
    triggerUncaughtException(
[Object: null prototype] {
  [Symbol(nodejs.util.inspect.custom)]: [Function: [nodejs.util.inspect.custom]]
}
Failed running 'src/index.ts'
```

The compiled build (`npm run build` then `npm start`) runs **fine** — which is the tell.

**Cause** — the dev runner was `ts-node`, and `ts-node@10.9` does not support TypeScript 6.
It throws that opaque null-prototype object instead of a readable error. Plain `tsc` +
`node dist/index.js` never touches ts-node, so the compiled path works and masks the cause.

**Fix** — run dev/seed through **`tsx`** (version-agnostic), not ts-node. This is already the
committed default:

```jsonc
// backend/package.json
"dev":  "tsx watch src/index.ts",
"seed": "tsx src/seed.ts",
```

If the Docker container still fails after a `package.json` change, its anonymous
`node_modules` volume is shadowing the fresh image — rebuild **and** renew it:

```bash
docker compose up -d --build --force-recreate --renew-anon-volumes backend
```

> [!TIP]
> Any bare `[Object: null prototype]` crash from a TS entrypoint is almost always the dev
> **runner**, not your code or your env. Confirm by building: if `npm run build && npm start`
> works, it's the runner.

*First hit: 2026-07-10.*

---

## 2. `403 Invalid or expired token` (or agent rejected)

**Symptom** — the stack is up, but the dashboard shows no tasks and API calls return
`403 {"error":"Invalid or expired token"}`. Or the agent connects and is immediately
rejected at the pairing handshake.

**Cause** — `docker-compose.yml` bakes in **DEV-ONLY default secrets**
(`JWT_SECRET=dev-jwt-secret-change-in-production`, and defaults for `ENCRYPTION_KEY` /
`AGENT_PAIRING_SECRET`) so `docker compose up` boots out of the box. But the frontend dev
token in `frontend/.env.local` and the agent's `TASKHUB_PAIRING_SECRET` were generated
against the **rotated** secrets in `backend/.env`. The container's default `JWT_SECRET`
can't verify a token signed with the rotated one → 403. Same story for the pairing secret.

**Fix** — create a **root `.env`** (next to `docker-compose.yml`, gitignored) mirroring the
secret values from `backend/.env`. Compose interpolates it automatically:

```dotenv
JWT_SECRET=<same as backend/.env>
ENCRYPTION_KEY=<same as backend/.env, exactly 32 chars>
AGENT_PAIRING_SECRET=<same as backend/.env>
ALLOWED_ORIGINS=http://localhost:5173
```

Then recreate the backend so it loads the new env (env changes need a recreate, not just a
rebuild):

```bash
docker compose up -d --force-recreate backend
```

**Verify** — `docker exec taskhub-backend-1 printenv JWT_SECRET` should now show your
`backend/.env` value, and `GET /api/tasks` with the dev token returns `200`.

> [!NOTE]
> Whenever you rotate a secret in `backend/.env`, update the root `.env` too, and regenerate
> the frontend dev token (`frontend/.env.local`). See
> [Setup › Docker vs. manual](../setup/README.md#-docker-vs-manual).

*First hit: 2026-07-10.*

---

## 3. Port `LISTENING` but `HTTP 000` / `EADDRINUSE`

**Symptom** — `netstat` shows `:3000` as `LISTENING`, but `curl http://localhost:3000/...`
returns `HTTP 000` (connection made, no response). Or starting the backend locally fails
with `Error: listen EADDRINUSE: address already in use :::3000`.

**Cause** — Docker's port proxy (`com.docker.backend`) keeps the published port bound to the
container **even while the app process inside it has crashed or is mid-restart**. So the port
looks alive, but nothing answers — and a *second* local process can't bind it either.

**Fix** — don't chase the port; check the app. Read `docker logs taskhub-backend-1` to see
why the process died (usually entry #1 or #2 above). To run the backend locally instead of in
Docker, stop the container first so the proxy releases the port:

```bash
docker compose stop backend
cd backend && npm run dev
```

> [!TIP]
> `HTTP 000` from `curl` means "connected but got nothing," which points at a **crashed app
> behind a live proxy**, not a firewall or a wrong URL.

*First hit: 2026-07-10.*

---

## 4. Backend source edits not picked up in Docker

**Symptom** — you edit `backend/src/**`, the source is correct and `npm run build` passes, but
the **running** stack still behaves like the old code: a newly added route 404s
(`Cannot PATCH /api/tasks/:id/schedule`), a changed handler runs the old logic, etc. A live
E2E/API check fails even though every offline test is green.

**Cause** — the backend container runs `npm run dev` = `tsx watch` over the bind-mounted
`./backend:/app` volume. On a **Windows host → Linux container** bind mount, filesystem
change events (inotify) **don't propagate**, so `tsx watch` never notices the edit and keeps
serving the process it started with. The container can be "up 2 hours" and still be running
pre-edit code.

**Fix** — restart the container so it re-reads the mounted source on boot:

```bash
docker restart taskhub-backend-1
# then wait for it to answer (403 = up, auth-gated):
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/tasks -H "Authorization: Bearer x"
```

A plain restart is enough (the source is already mounted — no rebuild needed unless
`package.json`/deps changed, in which case see entry #1's `--renew-anon-volumes`).

> [!TIP]
> The tell: `npm run build` succeeds and the offline unit/integration suites pass, but a
> request against `localhost:3000` disagrees with the source. That gap = the live process is
> stale. Restart before you debug the code.

*First hit: 2026-07-10.*

---

## 5. Windows `OFFLINE` after running a transient test agent

**Symptom** — you start a second agent instance for a dogfood/test (e.g. `dotnet
TaskHub.Agent.dll` with `TASKHUB_AGENT_ID=dogfood-agent`), do your testing, then stop it —
and now `GET /api/tasks/health` reports `WINDOWS_TASK_SCHEDULER: OFFLINE` and stays that way,
even though the **real** agent process (the elevated `\Task-Hub\TaskHubAgent` scheduled task)
is still running. Polling for a minute-plus doesn't recover it.

**Cause** — the backend maps one agent socket per user (single-user MVP). When the transient
agent connects it becomes *the* Windows agent; when it disconnects, the backend clears the
mapping. The real agent's socket is still alive from **its** point of view, so it doesn't
reconnect — and re-registration only happens on (re)connect. Result: the real agent is
connected-but-unregistered, and the backend has no Windows socket to command.

**Fix** — force the real agent to reconnect by dropping all agent sockets. Restarting the
backend does it (its 30s watchdog reconnects the real agent, which re-registers on connect):

```bash
docker compose restart backend
# then confirm Windows is HEALTHY again:
curl -s http://localhost:3000/api/tasks/health -H "Authorization: Bearer <dev token>"
```

Windows returns to `HEALTHY` within ~15s of the restart.

> [!TIP]
> The real agent runs **elevated** (registered with highest privileges), so an unelevated
> shell **can't** `Stop-Process` it (`Access is denied`). Don't try to kill/republish over
> it for a dogfood — run a transient agent instead, and restart the backend when you're done
> to hand the connection back.

*First hit: 2026-07-11.*

---

## 6. `.ps1` parse errors under Windows PowerShell 5.1 only

**Symptom** — running a script with the stock `powershell` (Windows PowerShell 5.1) fails to
parse, even though it's syntactically fine and runs under `pwsh` (7):

```
Unexpected token '}' in expression or statement.
The string is missing the terminator: ".
Missing closing '}' in statement block or type definition.
```

The reported line/column point at the *end* of the file (a late `}` or the last string),
not the real culprit — the parser got desynced earlier and only noticed at EOF.

**Cause** — a **non-ASCII character in a BOM-less UTF-8 script**. The usual offender is an
**em-dash `—`** (U+2014) pasted into a comment or `Write-Host` string. Windows PowerShell 5.1
reads a file with no byte-order mark as the system **ANSI** codepage (Windows-1252), so the
em-dash's UTF-8 bytes (`E2 80 94`) decode to three characters — one of which is a **curly
quote** (`"`, U+201D). PowerShell treats curly quotes as valid string delimiters, so it thinks
a string opened and never closed, and every brace after it is misread. `pwsh` 7 defaults to
UTF-8, so it never sees the problem — which is why a pwsh-based syntax check passes.

**Fix** — keep PowerShell (and VBScript) scripts **pure ASCII**. Replace em-dashes with `-`:

```powershell
# find non-ASCII chars in a script
([System.IO.File]::ReadAllText($f).ToCharArray() | Where-Object { [int]$_ -gt 127 } |
  Sort-Object -Unique | ForEach-Object { 'U+{0:X4}' -f [int]$_ })

# replace em-dashes, rewrite as UTF-8 without BOM
$t = [System.IO.File]::ReadAllText($f) -replace [char]0x2014, '-'
[System.IO.File]::WriteAllText($f, $t, (New-Object System.Text.UTF8Encoding($false)))
```

Then verify **under 5.1 specifically** (not just pwsh):

```powershell
& 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -NoProfile -Command "
  `$e=`$null; [System.Management.Automation.Language.Parser]::ParseFile('$f',[ref]`$null,[ref]`$e)
  if(`$e){ `$e.Message } else { 'OK' }"
```

> [!TIP]
> A BOM would also fix it (5.1 auto-detects UTF-8 with a BOM), but plain ASCII is the most
> portable — it can't be corrupted by any editor/encoding and stays greppable.

*First hit: 2026-07-13.*

---

## 7. New agent command 502-times-out until the agent is republished

**Symptom** — you add a new agent socket command (a `task:*` op like `task:export`),
wire up the backend route + connector, restart the backend, and the endpoint now
*exists* (no 404) — but it hangs ~15s and returns:

```json
{ "error": "Agent export timeout" }
```
(HTTP 502; the message varies per command — "Agent … timeout".)

**Cause** — two separate processes run old code, and they reload differently:

1. The **backend** is a Docker container (`taskhub-backend-1`, `npm run dev`) with
   the source bind-mounted. Windows→Linux bind mounts don't propagate file-change
   events, so `tsx watch` never sees your edit — the new **route** 404s. See
   [entry #4](#4-backend-source-edits-not-picked-up-in-docker). Fix: `docker compose restart backend`.
2. The **.NET agent** is a **host process** running the published exe
   (`agent\publish\TaskHub.Agent.exe`), launched by the stack / self-heal task. It
   does **not** hot-reload at all. Until you rebuild + republish it, it has no
   handler for the new command, never emits the response, and the backend's 15s
   wait times out to a 502.

The tell that distinguishes this from entry #4: the route **exists** (a bad id
returns your handler's `{"error":"Task not found"}`, not an Express "Cannot GET"),
and only the **agent-backed** path (Windows tasks) times out — a DB-only path
(TaskHub-native) works immediately.

**Fix** — republish the agent. It runs at **RunLevel Highest**, so an unelevated
shell can't stop it and `dotnet publish` can't overwrite the locked exe.

### The easy way — the on-demand republish task (recommended)

Register it **once** from an **Administrator** prompt:

```powershell
.\scripts\startup-task\Register-RepublishTask.ps1
```

After that, republish from **any** prompt — no elevation, no UAC:

```powershell
Start-ScheduledTask -TaskPath '\Task-Hub\' -TaskName 'TaskHubRepublish'
Get-Content "$env:TEMP\taskhub-republish.log" -Tail 20   # it logs; read it, don't assume
```

`\Task-Hub\TaskHubRepublish` is a **no-trigger** task at RunLevel Highest that runs
[`scripts/Republish-Agent.ps1`](../../scripts/Republish-Agent.ps1) (stop → publish →
relaunch), hidden via `run-hidden.vbs`. It only ever runs when explicitly started.

> [!NOTE]
> This is a **dev tool** and is deliberately not registered by `Register-TaskHubStack.ps1`
> or any installer. It is, by construction, a way to run code elevated without a UAC
> prompt — but it runs one fixed script from this repo, and `\Task-Hub\TaskHubStack`
> already runs `taskhub.ps1` elevated on a recurring trigger, so anyone who can write to
> this repo already has elevated execution here. It adds an entry point, not a capability.
> Don't register it on a machine where the repo is writable by someone who shouldn't have
> admin. Remove with `Register-RepublishTask.ps1 -Unregister`.

### The manual way

In an **Administrator** PowerShell:

```powershell
# 1. Stop the running agent so its exe can be replaced
Get-Process TaskHub.Agent -ErrorAction SilentlyContinue | Stop-Process -Force
# 2. Rebuild + publish (now includes the new command handler)
dotnet publish ".\agent\TaskHub.Agent" -c Release -r win-x64 --self-contained false -o ".\agent\publish"
# 3. Relaunch the stack (starts the new agent hidden)
& ".\scripts\taskhub.ps1" up
```

Step 1 is the one that matters: skip it and step 2 fails on the locked exe, or worse
appears to succeed while the old process keeps running.

### Verify it took — don't assume

```powershell
# The published dll must be NEWER than the newest source file.
Get-Item ".\agent\publish\TaskHub.Agent.dll" | Select-Object LastWriteTime
Get-ChildItem ".\agent\TaskHub.Agent" -Recurse -Filter *.cs |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1 LastWriteTime
```

> [!TIP]
> An unelevated `Get-Process TaskHub.Agent` returning **nothing does not mean the agent is
> down** — it runs elevated and can be invisible to your shell. Ask the backend instead:
> `GET /api/tasks/health` should show `WINDOWS_TASK_SCHEDULER` as `HEALTHY` with a recent
> `lastSync`. That is the authoritative signal.

> [!NOTE]
> Any change to the **backend** signature side of a signed command (e.g. a new
> `SignableCommand` variant) must ship **with** the agent — deploy both together,
> or the mismatch surfaces as a rejected/timed-out command. Read-only commands
> (like `task:export`) aren't signed, but still need the agent republished for the
> handler to exist.

*First hit: 2026-07-13.*

---

## 8. Every MCP tool returns `403 Invalid or expired token`

**Symptom** — the backend is healthy and the dashboard works, but *every* TaskHub MCP
tool call fails immediately:

```
TaskHub API error (HTTP 403): Invalid or expired token
```

**Cause** — `TASKHUB_TOKEN` is **not set in the environment the MCP host was launched
from**, so it was never expanded. `.mcp.json` references the token as
`"TASKHUB_TOKEN": "${TASKHUB_TOKEN}"`, and Claude Code
[documents](https://code.claude.com/docs/en/mcp) that an unset variable is passed
through as its **literal text** (`${TASKHUB_TOKEN}`) with only a warning. The server
then sends `Authorization: Bearer ${TASKHUB_TOKEN}` and the API rejects it.

The message is misleading: nothing is expired, and the JWT is not malformed — the
variable is simply unset. Don't rotate secrets or re-mint a token before checking this.

The tell that distinguishes it from [entry #2](#2-403-invalid-or-expired-token-or-agent-rejected)
(Docker's secrets not matching `backend/.env`):

- **Only the MCP server** 403s. The dashboard and `curl` with a real token both work —
  entry #2 breaks *everything*, including the agent handshake.
- A **missing** `Authorization` header returns `401 Access token required`, not `403`.
  Getting `403` means a token *was* sent — it just wasn't a JWT. Reproduce the exact
  failure with:

  ```bash
  curl -s -H 'Authorization: Bearer ${TASKHUB_TOKEN}' http://localhost:3000/api/tasks
  # {"error":"Invalid or expired token"}  ← identical to what the MCP tools return
  ```

**Fix** — set the variable in your environment, then **restart the MCP host** (it
expands `.mcp.json` at launch). Never paste the literal token into `.mcp.json` — the
repo's convention is that it holds only `${ENV}` references.

```powershell
# Mint a token inside the backend container, so it's signed with the JWT_SECRET
# the running backend actually uses (not whatever your shell has).
$token = (docker exec taskhub-backend-1 node -e "console.log(require('jsonwebtoken').sign({id:'<userId>',email:'<email>'}, process.env.JWT_SECRET, {expiresIn:'365d'}))").Trim()
[Environment]::SetEnvironmentVariable('TASKHUB_TOKEN', $token, 'User')   # persistent
```

Since 2026-07-14 `configFromEnv()` detects an unexpanded `${...}` literal and refuses
to start with an explicit message, so this now fails loudly at launch rather than as a
403 on every call. If you see that startup error, the fix above is still the answer.
**Note the symptom moved:** because the server now refuses to start, the tools go
*missing* rather than 403ing. `/mcp` showing no `taskhub`, or a `ToolSearch` for
`mcp__taskhub__*` finding nothing, can be this same bug wearing a quieter mask —
but **missing tools do not identify the token as the cause**, because a server
disabled in the host looks exactly the same. Rule that out first
([#13](#13-the-taskhub-mcp-tools-are-missing-while-the-token-is-fine)); it's one
command, and it's the cheaper hypothesis.

### 8a. …and "restart from a fresh terminal" does nothing under VS Code

**A new terminal is not a new environment.** A process inherits its parent's environment
block *at spawn*, and the parent of a VS Code integrated terminal is `Code.exe` — which
snapshotted its environment whenever VS Code launched, possibly days ago. Opening a new
tab, or even restarting Claude Code, re-inherits that same stale block. The token is set
at the User level and *still* invisible. The advice above ("restart from a fresh
terminal") is only true for a terminal launched fresh from Explorer or the Start menu.

**Diagnose it — don't guess which process is stale.** Walk the ancestry and compare start
times against when you set the variable:

```powershell
$cur = $PID
for ($i=0; $i -lt 7 -and $cur; $i++) {
  $p = Get-CimInstance Win32_Process -Filter "ProcessId = $cur"; if (-not $p) { break }
  "$($p.Name) (pid $cur) started $((Get-Process -Id $cur -EA SilentlyContinue).StartTime)"
  $cur = $p.ParentProcessId
}
```

Any ancestor that started **before** you set the variable is the culprit — everything
below it inherits the old block. Confirm the variable is genuinely persisted, and that
the process just can't see it:

```powershell
[Environment]::GetEnvironmentVariable('TASKHUB_TOKEN','User')   # persisted value
$env:TASKHUB_TOKEN                                              # what this process sees
```

**Fix — inject it into the current shell, then relaunch the host from that shell.** This
works without closing VS Code and losing your window state:

```powershell
$env:TASKHUB_TOKEN = [Environment]::GetEnvironmentVariable('TASKHUB_TOKEN','User')
claude
```

The alternative is to fully quit VS Code (**all** windows — one lingering window keeps
the old `Code.exe` alive) and reopen it. Same for Windows Terminal: a new tab inherits
from the running `WindowsTerminal.exe`, so tabs don't refresh the environment either.

*First hit: 2026-07-14. Entry 8a added 2026-07-15, after a correct restart failed to fix
it — Claude Code was genuinely fresh, but its VS Code grandparent was 7 hours old.*

---

## 9. Agent payload arrives with every field empty

**Symptom** — you add a new agent command, republish, and the round trip *works*: no
error, no timeout, no exception, and even the **count is right**. But every field is
blank:

```jsonc
// GET /api/tasks/folders
{ "folders": [ { "path": "", "taskCount": 0, "writable": false },   // x161
               { "path": "", "taskCount": 0, "writable": false } ] }
```

**Cause** — the agent emitted a **C# object directly**:

```csharp
var folders = _scheduler.ListFolders();                    // List<AgentFolderInfo>
await _socket.EmitAsync("task:folders_list", new[] { new { folders = folders } });
```

The socket serializer does **not** camelCase. So the wire carries the C# property names —
`Path`, `TaskCount`, `Writable` — while the backend reads `f.path`, `f.taskCount`,
`f.writable`. Every lookup is `undefined`, and the connector's defensive mapping
(`String(f.path ?? '')`, `!!f.writable`) turns each one into a plausible empty value.

Nothing throws. You get a **well-formed payload of empty values** — the confident lie, in
its purest form. Worse, it reads as a *product* answer ("no folder on this machine is
usable") rather than a bug.

**Fix** — project every emit into an anonymous type with **explicit lowercase names**, the
way `task:full_list` already does:

```csharp
var folders = _scheduler.ListFolders()
    .Select(f => new { path = f.Path, taskCount = f.TaskCount, writable = f.Writable })
    .ToList();
```

> [!WARNING]
> **The mocked tests cannot catch this**, and that is the real lesson. The agent's tests
> mock `ITaskScheduler`; the backend's mock the socket. Neither crosses the real JSON
> boundary, so **both sides pass while disagreeing about the wire format**. Assert the
> **serialized** shape instead — see `TaskFolders_Event_EmitsCamelCaseKeysTheBackendCanRead`,
> which checks the lowercase keys are present, the PascalCase ones are not, and the values
> survive. A green suite is not evidence that two processes agree.

**The tell that separates this from a stale agent** ([#7](#7-new-agent-command-502-times-out-until-the-agent-is-republished)):
a stale agent **times out** (no handler). This *answers* — instantly, and with the right
row count. If the shape is right and the content is empty, suspect casing, not staleness.

*First hit: 2026-07-14 (`task:folders`, found only by driving it against a real machine —
161 folders, all blank).*

---

## 10. Cannot delete a Task Scheduler folder (`E_ACCESSDENIED`)

**Symptom** — removing an **empty** Task Scheduler folder fails, even though you created it
and even though your shell can see it:

```
Access is denied. (0x80070005 (E_ACCESSDENIED))
```

**Cause** — Task Scheduler **folder** deletion requires elevation. Task *deletion* through
TaskHub works fine (the agent runs elevated and does it for you), but nothing hands your
unelevated shell the right to remove the containing folder.

**Fix** — from an **Administrator** prompt:

```powershell
$svc = New-Object -ComObject Schedule.Service; $svc.Connect()
$svc.GetFolder('\Parent').DeleteFolder('Child', 0)   # deepest first
$svc.GetFolder('\').DeleteFolder('Parent', 0)
```

The folder must be empty (no tasks **and** no subfolders) or the call fails for that reason
instead.

> [!NOTE]
> **This is why TaskHub refuses to create folders.** It creates exactly one — its own
> `\TaskHub`, the same one it prunes when the last task leaves. Any other folder it created
> would be a **one-way door**: TaskHub could make it but never remove it, leaving litter only
> you could clear from an elevated prompt. *Never create what you cannot remove.* A folder
> you made is yours and is deliberately left alone — the fix was to stop creating them, not
> to start deleting them.

*First hit: 2026-07-14 (a dogfood left `\ManualTest`, `\MicrosoftEdgeBackups`, and `\Work`
behind; they had to be removed by hand).*

---

## 11. After a System Restore, the republish task and MCP tools are gone

**Symptom** — one or both, with a repo that looks completely healthy (`git status` clean, the
build fine, the agent running):

```
Start-ScheduledTask : No MSFT_ScheduledTask objects found with property 'TaskName' equal to
'TaskHubRepublish'
```

...and/or every `taskhub` MCP tool is simply **missing** from the host — not erroring, not
403-ing (that's [#8](#8-every-mcp-tool-returns-403-invalid-or-expired-token)), just absent.

**Cause** — both are **per-machine state on `C:` that git cannot protect**:

| Wiped | Where it actually lives |
|:---|:---|
| `\Task-Hub\TaskHubRepublish` (and the other `\Task-Hub\` tasks) | Task Scheduler store on `C:` |
| `TASKHUB_TOKEN` | `HKCU\Environment` (User env var) on `C:` |

The *scripts* that register the task are committed and survive; only the **registration** is
lost. Likewise the MCP server, its `dist/`, and `.mcp.json` all survive — only the token is
gone. So a restore of `C:` leaves a repo on `D:` untouched and every symptom points somewhere
other than the real cause. The token loss is silent by design: since the 2026-07-14 hardening,
`configFromEnv()` **refuses to start** rather than forward a literal `${TASKHUB_TOKEN}`, so the
tools disappear instead of returning a misleading 403.

**Fix** — re-register the task (once, **elevated** — a UAC prompt is expected):

```powershell
.\scripts\startup-task\Register-RepublishTask.ps1
```

Re-mint the token and persist it. Mint it **inside the running container** so it's signed with
the secret the live backend actually uses, rather than a file that may not be what's loaded:

```powershell
$token = docker exec -w /app taskhub-backend-1 node -e "console.log(require('jsonwebtoken').sign({id:'<userId>',email:'<email>'}, process.env.JWT_SECRET, {expiresIn:'30d'}))"
[Environment]::SetEnvironmentVariable('TASKHUB_TOKEN', $token.Trim(), 'User')
```

Confirm it authenticates *before* blaming MCP — this separates an auth problem from an MCP one:

```powershell
Invoke-RestMethod -Uri 'http://localhost:3000/api/tasks' -Headers @{ Authorization = "Bearer $token" }
```

Then **restart your MCP host from a fresh terminal**. Setting a User env var does not reach an
already-running process, so restarting the host inside an old terminal won't pick it up.

> [!TIP]
> **The tell:** if several unrelated-looking things broke at once and the repo is clean, ask
> what lives on `C:` rather than in git. Scheduled tasks, User env vars, and anything under
> `%TEMP%` are all outside the repo's blast radius — and outside its protection.

*First hit: 2026-07-15 (a System Restore took `\Task-Hub\TaskHubRepublish` and `TASKHUB_TOKEN`
with it; the repo on `D:` was untouched, so the two failures looked unrelated).*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 12. A template passes every test and still hangs on the target

**Symptom** — a task created from a template never finishes. It sits in `Running`
indefinitely while consuming no CPU, and TaskHub's UI reports the run as **`SUCCESS`**:

```
state       : Running
last result : 267009   (0x00041301 = SCHED_S_TASK_RUNNING)
cpu(s)      : 0.484375   <- frozen; it is blocked, not working
```

Meanwhile `npm test` is green — including the whole-catalog **resolvability** sweep.

**Cause** — two things compounding:

1. **The command is broken on the target.** Resolvability proves a `commandTemplate`
   *tokenizes and substitutes*; it does **not** prove the command runs. The concrete case:
   `Invoke-WebRequest` in **Windows PowerShell 5.1** parses responses with the **Internet
   Explorer engine**, which **Windows 11 no longer ships**. The call dies on
   `Invoke-WebRequest : Object reference not set to an instance of an object.`
   (`System.NullReferenceException`).
2. **A scheduled run has no console.** Interactively that error prints and the process
   exits. Under Task Scheduler there is nowhere to write it, so the process **blocks
   forever** rather than failing. `TaskHub` reports `SUCCESS` because the agent only
   observes that the task *started* — it never claimed the command *worked*.

The tell: `Running` + flat CPU = blocked. A task that is genuinely working accrues CPU.

**Fix** — for this class of command:

```powershell
# broken on Windows 11 — needs the IE engine
powershell.exe -Command "Invoke-WebRequest -Uri 'https://…' -Method GET"

# correct
powershell.exe -NoProfile -Command "Invoke-WebRequest -Uri 'https://…' -Method GET -UseBasicParsing"
```

- **`Invoke-WebRequest` → always `-UseBasicParsing`.** Prefer **`Invoke-RestMethod`** for
  JSON/XML: it parses directly and never touches IE (verified working on 5.1 here).
- **`powershell.exe` → always `-NoProfile`** so an unattended run doesn't depend on the
  user's profile.

To clear a stuck one: `Stop-ScheduledTask -TaskPath '\TaskHub\' -TaskName '<name>'`.

> [!IMPORTANT]
> **A green suite is not evidence a template works.** The only proof is applying it and
> watching the task actually run to completion. This bug shipped in a **core** template —
> one of the 5 every fresh install gets — on a `*/15 * * * *` default, so it would have
> stranded a `powershell.exe` every 15 minutes on a new user's machine, forever, while the
> dashboard showed `SUCCESS`.

*First hit: 2026-07-15 (found by the first live end-to-end exercise of the MCP
`create_task_from_template` + `run_task` tools — the read-only tests that preceded it could
not have surfaced it).*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 13. The `taskhub` MCP tools are missing while the token is fine

**Symptom** — `mcp__taskhub__*` is absent from the tool list and `/mcp` doesn't list
`taskhub` at all. Unlike [#8](#8-every-mcp-tool-returns-403-invalid-or-expired-token),
**every downstream check passes**:

```powershell
[Environment]::GetEnvironmentVariable('TASKHUB_TOKEN','User')   # set
$env:TASKHUB_TOKEN                                              # the host sees it too
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health   # 200
node ./mcp-server/dist/index.js                                 # boots clean by hand
```

That last one is the discriminator: **if the server answers `initialize` when you run it
yourself, the server is not the problem** — the host never started it.

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}' \
  | node ./mcp-server/dist/index.js
# TaskHub MCP server running on stdio
# {"result":{...,"serverInfo":{"name":"taskhub","version":"1.0.0"}},"jsonrpc":"2.0","id":1}
```

**Cause** — the server is **disabled in the host**, not broken. Claude Code prompts once
per project: *"this project defines MCP servers, do you trust them?"* Declining writes
**every** server in `.mcp.json` into `disabledMcpjsonServers` in
`.claude/settings.local.json` — and that file is **gitignored per-machine state** (§8a of
`CLAUDE.md`), so nothing in the repo hints that it happened:

```json
{
  "disabledMcpjsonServers": [
    "taskhub", "playwright", "nanobanana", "serper",
    "github", "notion", "context7", "elevenlabs"
  ]
}
```

The tell: **all** of the project's MCP servers are missing at once, not just `taskhub`. One
broken server fails alone; a declined trust prompt takes the whole file with it. If
`context7` and `github` are gone too, stop debugging `taskhub`.

**Fix** — remove the server from the list and **restart the host** (the list is read at
launch):

```powershell
# check first — this is the one-line diagnosis
node -e "console.log(require('./.claude/settings.local.json').disabledMcpjsonServers)"
```

Then delete the entry (or the whole key, to restore all of them) and relaunch. Re-approving
via the trust prompt works too, but only fires on first encounter — once the answer is
recorded, editing the file is the way back.

> [!WARNING]
> **This masks #8 and #8a completely.** A disabled server never runs, so a broken
> `TASKHUB_TOKEN` produces the *identical* symptom — missing tools — and you can spend a
> session fixing an environment variable that was never the blocker. **Check
> `disabledMcpjsonServers` first**: it's one command, it's the cheaper hypothesis, and it
> rules out the whole token branch before you touch it.

*First hit: 2026-07-15, after #8a's env fix landed correctly and the tools were still gone.
Both faults were real and stacked — the token was genuinely unset **and** the server was
disabled — which is exactly why the missing-tools symptom can't be used to identify either
one.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## ➕ Adding a new entry

Keep it short and greppable. For each problem, capture:

1. **Symptom** — the exact error text / observable behavior (so it's searchable).
2. **Cause** — the underlying reason, and any "tell" that distinguishes it.
3. **Fix** — the concrete commands/edits that resolved it.
4. Add a row to the **Quick lookup** table and date it (`*First hit: YYYY-MM-DD.*`).

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

<p align="center">
  <a href="../README.md">Docs Home</a> ·
  <a href="../setup/README.md">Setup</a> ·
  <a href="../install/README.md">Install</a>
</p>
