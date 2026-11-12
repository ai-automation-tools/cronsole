# Cronsole Startup Tasks

Auto-starts the **entire local Cronsole stack** at Windows logon and keeps it up, so
`http://localhost:7373` is live after you sign in — no manual `npm run dev` in three
terminals.

Up to four scheduled tasks live in `\Cronsole-Stack\`. One is a keeper that runs on a timer,
two are on-demand chores that need elevation, and one optional hourly task rebuilds the
dashboard the phone sees:

| Task | Trigger | Runs | Purpose |
|---|---|---|---|
| **`CronsoleStack`** | logon + **every 5 min** (its own time trigger, armed at registration, #102) | `cronsole.ps1 up` | The keeper. Idempotent, so it starts only what is down. |
| **`CronsoleAgentKeeper`** | logon + **every 5 min** | `cronsole.ps1 agent` | Starts the agent if it is not running. The only recurring task that is elevated. |
| **`CronsoleRepublish`** | none (on-demand) | `Republish-Agent.ps1` | Rebuild + republish the agent, then relaunch. |
| **`CronsoleRestart`** | none (on-demand) | `cronsole.ps1 restart` | Stop the stack (agent included) and bring it back. |
| **`CronsoleRebuild`** | **every 60 min** (optional, since 2026-11-09) | `cronsole.ps1 rebuild` | Rebuild `frontend/dist` when the proxy is serving a stale one. A no-op unless `cronsole remote on` and `check-dist-fresh.mjs` reports stale. RunLevel **Limited**, no elevation. |

All of them launch through `run-hidden.vbs` so nothing flashes on screen, and run in the
interactive user's session. **`CronsoleStack` and `CronsoleRebuild` run without elevation**
(`Limited`); `CronsoleAgentKeeper`, `CronsoleRepublish` and `CronsoleRestart` run at
**RunLevel Highest**, because the agent does.

**Only the agent is elevated, and that is deliberate.** The backend runs Cronsole-native jobs,
so a backend started from an elevated task made every native job an administrator. `up`
therefore runs without elevation and asks `CronsoleAgentKeeper` for the agent; an elevated
`restart` stops everything, starts the agent, and hands the web tier back to `CronsoleStack`.
Registered before 2026-11-11? Re-run `Register-CronsoleStack.ps1` (elevated), then start
`CronsoleRestart` once so the backend comes back without administrator rights.

## Contents

| File | Purpose |
|---|---|
| `run-hidden.vbs` | **No-flash launcher.** Runs a PowerShell script hidden from creation via `WScript.Shell.Run(cmd, 0, True)`, so no console/conhost window flashes on recurring triggers. It waits for the script and returns its exit code (since 2026-11-03; it was fire-and-forget before), so `IgnoreNew` stops overlapping runs. `cronsole.ps1 up` returns 0 even when something stayed down, so Last Result is not a health check: use `cronsole.ps1 status`. All three tasks launch through it. |
| `Register-CronsoleStack.ps1` | Registers **`CronsoleStack`**, the recurring self-heal. Also removes the obsolete `CronsoleAgent` (see below). Run once, **as Administrator**. |
| `Register-RepublishTask.ps1` | Registers **`CronsoleRepublish`**, the on-demand elevated agent rebuild. Run once, **as Administrator**. |
| `Register-RestartTask.ps1` | Registers **`CronsoleRestart`**, the on-demand elevated stack restart. Run once, **as Administrator**. |
| `Register-RebuildTask.ps1` | Registers **`CronsoleRebuild`**, the hourly `dist` rebuild for the phone/tailnet page. Run once, **no elevation**. `-Unregister` removes it. |
| `Protect-RepoFolder.ps1` | Leaves write access to this clone to you, Administrators and SYSTEM, because the elevated tasks run files from it. `-Check` only lists who else can write. Run once; elevation only if you do not own the folder. Undo: `icacls <folder> /reset`. |
| `Migrate-RepoFolder.ps1` | **The only supported way to move this checkout.** Three tasks embed the repo path twice each and fail *silently* when it moves by hand. |
| `Migrate-ToCronsole.ps1` | **One-time machine migration** for the 2026-07-31 rename: moved the launcher tasks from `\Task-Hub\` to `\Cronsole-Stack\` and `TASKHUB_TOKEN` → `CRONSOLE_TOKEN`. Already run on this machine; kept as the record of what moved and as the template for the next such migration. |

## `CronsoleAgent` is gone, and why that matters

*(Removed 2026-08-25.)* There used to be a fourth task, `\Cronsole-Stack\CronsoleAgent`.
It was removed because **two different scripts registered the same task name with
incompatible definitions**, and whichever ran last won:

- `agent\setup-agent-startup.ps1` registered it to run **`Cronsole.Agent.exe` directly**,
  with the description *"Handles WebSocket communication with Cronsole backend."*
- `Register-CronsoleStack.ps1` overwrote it to run **the stack launcher**
  (`Start-Cronsole.ps1` → Docker engine → `cronsole.ps1 up`), keeping the old description.

On a machine where the launcher won — which is what shipped — the task's description was
simply false, and the bounce that `docs/troubleshooting/README.md` and the Agent Setup
Guide both told you to use was **a complete no-op in both halves**:

```powershell
Stop-ScheduledTask  -TaskPath '\Cronsole-Stack\' -TaskName 'CronsoleAgent'   # stopped nothing
Start-ScheduledTask -TaskPath '\Cronsole-Stack\' -TaskName 'CronsoleAgent'   # started nothing
```

- **Stop** had nothing to stop. The task launched through `run-hidden.vbs`, which is
  fire-and-forget (`WScript.Shell.Run(cmd, 0, False)`), so `wscript.exe` exited within a
  second and the task instance was long gone while the agent it started ran on as an
  unrelated process. The task sat at `Ready` while the agent held a pid — so
  `Stop-ScheduledTask` returned success having killed nothing.
- **Start** would not restart it. It ended in `cronsole.ps1 up`, and `up` is idempotent by
  design: it starts what is **down** and leaves what is **up** alone. Seeing a live agent
  it printed *"agent already up"* and returned `0`.

That was the documented recovery for [troubleshooting #74](../../docs/troubleshooting/README.md#74-dozens-of-windows-tasks-go-missing-in-one-sync-and-the-agent-is-healthy)
(an unelevated agent that cannot see ACL'd folders, so dozens of tasks flip to MISSING) —
a gesture that **reported success while changing nothing**, which is worse than an error,
because the next step is to believe it and go looking somewhere else.

Its only other unique job was starting the Docker engine, and that moved into
`cronsole.ps1 up` (`Start-DockerEngine`), which is where it belonged: **the engine had no
keeper**, because the only thing that started it ran at logon while the thing that runs
every 5 minutes could merely warn that it was down. Quit Docker Desktop mid-session and
the self-heal logged `WARNING: docker compose up for the database failed` every 5 minutes
forever — [troubleshooting #70](../../docs/troubleshooting/README.md#70-the-tailscale-url-is-dead-for-days-while-every-other-service-is-healthy)'s
shape (an opt-in with no keeper) one layer further down.

Once `up` starts the engine, `CronsoleAgent` is a pure duplicate of `CronsoleStack`'s logon
trigger — and a harmful one: both fired at logon, both called `up`, and
`MultipleInstancesPolicy` is per-**task**, so two `npm run dev` could race for `:3000`.

Both scripts now retire it: `Register-CronsoleStack.ps1`, and `agent\setup-agent-startup.ps1`,
which unregisters a leftover `CronsoleAgent` at **any** path so a second agent never starts at
logon. The setup script registers nothing itself; it builds the agent, says whether
`CronsoleStack` is registered (and the command if not), and runs `up`.

**To restart the agent now, use `CronsoleRestart`** — `cronsole.ps1 restart` force-stops the
agent (which needs the elevation the task supplies) and brings the stack back. **To rebuild it,
use `CronsoleRepublish`** rather than re-running `setup-agent-startup.ps1`: it is elevated, so it
can stop an agent running at `RunLevel Highest` and overwrite its locked exe.

## No console flash (why `run-hidden.vbs` exists)

The recurring task fires every 5 minutes. Running it as `powershell.exe -WindowStyle Hidden`
**still flashes** a window every time: PowerShell is a console app, so Windows creates a
`conhost` window and only *then* applies `-WindowStyle Hidden`. `run-hidden.vbs` launches
PowerShell through `WScript.Shell.Run(cmd, 0, True)`, which creates the process with the
window **hidden from the start** (never shown), and `wscript.exe` is itself windowless — so
nothing appears on screen.

The same shim is used by the two on-demand tasks, for consistency rather than for flashing:
they fire rarely, but a republish or a restart has no console to attach to either, which is
why both write their own log. Since 2026-11-03 the shim waits, so the exit code reaches Task Scheduler too; `CronsoleStack` has a 10-minute limit so a hung `up` can't block every later run.

## The `\Cronsole-Stack\` tasks are deliberately NOT tracked in the dashboard

*(Decided 2026-07-31.)* These are **infrastructure — the thing that runs Cronsole, not work
Cronsole runs.** Importing them puts the app in its own task list, where the obvious actions
are wrong in the obvious way: disabling `CronsoleStack` from the dashboard stops the
self-heal that would bring the backend back, which is also what breaks the dashboard's
ability to re-enable it.

They were tracked before the rename (as `\Task-Hub\*`), so a dashboard row for them is a
state this machine has actually been in; the three stale rows left behind by the rename are
what prompted the call. Two independent reasons to leave the folder out:

- **Scope.** The dashboard answers *"what is scheduled on this machine on my behalf?"*
  The launcher is the answer to *"why does anything answer at all?"* Mixing them makes the
  count less meaningful and buries real tasks a little deeper.
- **Blast radius.** `\Cronsole-Stack\` is kept separate from the app's own `\Cronsole\`
  precisely so the prune-its-own-folder logic can never reach it. Not tracking it keeps that
  separation true at the UI layer too, rather than relying on a user not clicking Delete.

**Nothing enforces this** — Import will happily discover `Cronsole-Stack` as a category and
it appears ticked under the *Non-system* preset. It is a standing choice, not a guard, which
is why it is written down here. Health and status for these tasks come from
`cronsole.ps1 status` and Task Scheduler, not from the dashboard.

## What `cronsole.ps1 up` starts

Host-process architecture (matches how the stack actually runs), dev mode:

| # | Component | How | Endpoint |
|---|---|---|---|
| 0 | Docker engine | starts Docker Desktop and waits up to 120s if it's down | — |
| 1 | Postgres | `docker compose up -d db` | `:5432` |
| 2 | Backend | `npm run dev` (host) | `http://localhost:3000` |
| 3 | Frontend | `npm run dev` (host, Vite) | `http://localhost:7373` |
| 4 | Agent | `agent\publish\Cronsole.Agent.exe` (host) | outbound WebSocket → backend |
| 5 | Reverse proxy | only where `cronsole remote on` said so | `127.0.0.1:8080` |

The agent runs on the host (not in Docker) because it needs direct access to the Windows
Task Scheduler.

**Idempotent:** anything already running is detected (by *asking the service* — `/api/health`,
`pg_isready`, a RESP `PING` — never by checking whether a port is bound) and left alone. Safe
to run repeatedly; it never spawns duplicates.

Child output goes to `logs\*.log` at the repo root (`backend.out.log`, `backend.err.log`,
`frontend.*.log`). The `logs\` folder is gitignored.

## Registering the tasks (fresh clone)

Creating anything under `\Cronsole-Stack\` needs elevation. From an **Administrator**
PowerShell, once:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\startup-task\Register-CronsoleStack.ps1
powershell -ExecutionPolicy Bypass -File scripts\startup-task\Register-RepublishTask.ps1
powershell -ExecutionPolicy Bypass -File scripts\startup-task\Register-RestartTask.ps1
```

Verify — always by asking Task Scheduler, never by a registrar's exit code:

```powershell
Get-ScheduledTask -TaskPath '\Cronsole-Stack\' | ForEach-Object {
  '{0} [{1}]' -f $_.TaskName, $_.State
  $_.Actions | ForEach-Object { "  $($_.Execute) $($_.Arguments)" }
}
```

Each registrar takes `-Unregister` to remove its task (`Register-CronsoleStack.ps1` uses
`Unregister-ScheduledTask` directly).

> **The two on-demand tasks are dev tools.** A no-trigger task at RunLevel Highest that an
> unelevated caller can start is, by construction, a way to run code elevated without a UAC
> prompt. That is an acceptable trade here — each runs *one fixed script from this repo*, and
> `CronsoleAgentKeeper` already runs `cronsole.ps1` elevated every 5 minutes, so they add an entry
> point rather than a capability. Do not register them on a machine where the repo is
> writable by someone who should not have admin.

## How to use

**It's automatic** — just log in. On demand:

```powershell
# self-heal now (starts only what is down)
Start-ScheduledTask -TaskPath '\Cronsole-Stack\' -TaskName 'CronsoleStack'

# restart everything, agent included (~15s)
Start-ScheduledTask -TaskPath '\Cronsole-Stack\' -TaskName 'CronsoleRestart'

# rebuild the agent from source, then relaunch (~20s)
Start-ScheduledTask -TaskPath '\Cronsole-Stack\' -TaskName 'CronsoleRepublish'
Get-Content "$env:TEMP\cronsole-republish.log" -Tail 20
```

Confirm the result by asking the stack, not the task's exit code:

```powershell
pwsh .\scripts\cronsole.ps1 status
```

Give Docker ~15–30s on a cold boot — `up` waits for the engine before starting the database.

## How to update

### Change what the tasks do
**Edit `scripts\cronsole.ps1` and save.** Every task runs a script *by path* on each
trigger, so it always picks up the latest version — no re-registration. Tool locations
(Node, Docker, Docker Desktop) are resolved near the top of that script; the repo root is
derived from `$PSCommandPath`.

### Change a task itself (action, trigger, run level, or path)
Re-run its registrar from an elevated prompt. They are idempotent (`-Force`), and they
resolve the repo root at run time — which is why there are no task XML files here any more.
The two that used to be kept as history (`CronsoleAgent.backup.xml`, `.updated.xml`) named
the pre-2026-07-31 checkout path and a script that no longer exists; registering either one
**succeeded** and then failed *silently* at the next logon, because Windows does not
validate an action's path at registration time. They were deleted along with the task they
described.

### Move the checkout
Use [`Migrate-RepoFolder.ps1`](Migrate-RepoFolder.ps1), never Explorer. Three things hold
this repo by absolute path — the `\Cronsole-Stack\` tasks, the published agent, and the
`.claude\skills\cronsole` junction — and **all three fail silently** when it moves by hand.

## Stop the stack (e.g. to test a cold start)

```powershell
pwsh .\scripts\cronsole.ps1 down        # backend, frontend, agent
pwsh .\scripts\cronsole.ps1 down -All   # also the database and the proxy
```

`down` must be **elevated** to stop the agent — it runs at RunLevel Highest, so an
unelevated `Stop-Process` is refused. `Invoke-Down` checks and says so rather than printing
*"stopped agent"* at a live one. Note that `CronsoleStack` will bring everything back within
5 minutes; disable it first if you want the stack to stay down.

## Troubleshooting

| Symptom | Check |
|---|---|
| Dashboard empty / red "Can't reach backend" banner | Is `:3000` listening? See `logs\backend.err.log`. |
| Backend up but **Sync tasks now** fails | Is the agent running & connected? `curl http://localhost:3000/api/tasks/health` should show `WINDOWS_TASK_SCHEDULER: HEALTHY`. |
| Nothing starts at logon | `Get-ScheduledTaskInfo -TaskName CronsoleStack -TaskPath '\Cronsole-Stack\'` → check `LastRunTime` and `NextRunTime`. An empty `NextRunTime` means the 5-minute repetition is disarmed (#102): re-run `Register-CronsoleStack.ps1` elevated. `LastTaskResult` `0x0` only means `up` finished; `cronsole.ps1 status` says what is up. |
| The database never comes up | Docker Desktop not installed at the expected path — `up` says so by name rather than retrying silently. |
| Dozens of Windows tasks flip to MISSING | The agent is running **unelevated**. `Start-ScheduledTask … CronsoleRestart`, then Sync. See [troubleshooting #74](../../docs/troubleshooting/README.md#74-dozens-of-windows-tasks-go-missing-in-one-sync-and-the-agent-is-healthy). |
| Agent changes have no effect | The agent never hot-reloads. `Start-ScheduledTask … CronsoleRepublish`. |
| "Access is denied" editing a task | You're not elevated. Re-run in an **Administrator** PowerShell. |
