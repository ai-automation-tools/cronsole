# Cronsole Startup Task

Auto-starts the **entire local Cronsole stack** at Windows logon via a single
Scheduled Task, so `http://localhost:7373` is live after you sign in — no manual
`npm run dev` in three terminals.

This replaced the old task, which only launched the .NET agent (which is why the
dashboard would come up empty and **Sync tasks now** failed: the backend the
frontend talks to was never started).

## Contents

| File | Purpose |
|---|---|
| `Start-Cronsole.ps1` | The launcher. Brings up every component in order; idempotent. Now delegates to `..\cronsole.ps1 up`. |
| `run-hidden.vbs` | **No-flash launcher.** Runs a PowerShell script hidden from creation via `WScript.Shell.Run(cmd, 0, False)`, so no console/conhost window flashes on recurring triggers. Both self-heal tasks launch through this. |
| `Register-CronsoleStack.ps1` | Registers the **`\Cronsole-Stack\CronsoleStack`** self-heal watchdog (recurring `cronsole.ps1 up`, launched via `run-hidden.vbs`) **and** repairs `CronsoleAgent` to a flash-free, logon-only bootstrap. Run once, **as Administrator**. |
| `Migrate-ToCronsole.ps1` | **One-time machine migration** for the 2026-07-31 rename: moves the three launcher tasks from `\Task-Hub\` to `\Cronsole-Stack\` and `TASKHUB_TOKEN` → `CRONSOLE_TOKEN`. Already run on this machine; kept as the record of what moved and as the template for the next such migration. Registers the new tasks **before** removing the old, and keeps any old task whose replacement didn't appear. Idempotent, `-WhatIfOnly` to preview, **Administrator** required. Runs each registrar as a **child process** — `setup-agent-startup.ps1` ends with `Stop-Process -Id $PID` and would otherwise kill the caller. |
| `Set-CronsoleRepetition.ps1` | **Deprecated** — CronsoleStack now owns recurring self-heal. Adding a repetition to `CronsoleAgent` duplicates it (and doubles the flashing); no-op without `-Force`. |
| `CronsoleAgent.updated.xml` | Reference/legacy Scheduled Task definition (runs the launcher via `powershell.exe`). Superseded by the programmatic repair in `Register-CronsoleStack.ps1` — kept for history. |
| `CronsoleAgent.backup.xml` | The **original** task definition (agent-only), kept for rollback. |

## No console flash (why `run-hidden.vbs` exists)

The self-heal tasks run on a short recurring trigger. Running them as
`powershell.exe -WindowStyle Hidden` **still flashes** a window every few minutes:
PowerShell is a console app, so Windows creates a `conhost` window and only *then*
applies `-WindowStyle Hidden` — a brief flash on each fire. `run-hidden.vbs`
launches PowerShell through `WScript.Shell.Run(cmd, 0, False)`, which creates the
process with the window **hidden from the start** (never shown), and `wscript.exe`
is itself windowless — so nothing appears on screen.

`Register-CronsoleStack.ps1` points **both** self-heal tasks at `run-hidden.vbs`:

- **`\Cronsole-Stack\CronsoleStack`** — the single **recurring** self-heal (`cronsole.ps1 up`
  at logon + every 5 min). Idempotent, so it only relaunches what actually died.
- **`\Cronsole-Stack\CronsoleAgent`** — a **logon-only** bootstrap (`Start-Cronsole.ps1`:
  Docker engine + `up`). It no longer carries a recurring repetition, so the two
  tasks don't both re-run `up` on an interval (that redundancy was the second
  source of flashing).

Re-run `Register-CronsoleStack.ps1` (elevated) once to apply the no-flash + dedupe
fix to an existing install.

## `\Cronsole-Stack\CronsoleStack` — the self-heal watchdog

A lighter, clearly-named companion to `CronsoleAgent`. It runs the idempotent
`scripts\cronsole.ps1 up` at logon and every 5 minutes, so if the backend or
frontend dies mid-session it's back within minutes (vs. the launcher's 10). Both
tasks call the same `up`, so they never fight or spawn duplicates.

Creating a task under `\Cronsole-Stack\` needs elevation, so register it once from an
**Administrator** PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\startup-task\Register-CronsoleStack.ps1
# then, optionally, run it immediately:
Start-ScheduledTask -TaskPath '\Cronsole-Stack\' -TaskName 'CronsoleStack'
```

To remove it: `Unregister-ScheduledTask -TaskPath '\Cronsole-Stack\' -TaskName 'CronsoleStack' -Confirm:$false` (elevated).

## What the launcher starts

Host-process architecture (matches how the stack actually runs), dev mode:

| # | Component | How | Endpoint |
|---|---|---|---|
| 1 | Docker engine | starts Docker Desktop and waits if it's down | — |
| 2 | Postgres + Redis | `docker compose up -d db redis` | `:5432` / `:6379` |
| 3 | Backend | `npm run dev` (host) | `http://localhost:3000` |
| 4 | Frontend | `npm run dev` (host, Vite) | `http://localhost:7373` |
| 5 | Agent | `agent\publish\Cronsole.Agent.exe` (host) | outbound WebSocket → backend |

The agent runs on the host (not in Docker) because it needs direct access to the
Windows Task Scheduler.

**Idempotent:** anything already running is detected (by listening port /
process name / `docker info`) and left alone. Safe to run the task, or the
script, repeatedly — it never spawns duplicates.

All child output goes to `logs\*.log` at the repo root (`launcher.log`,
`backend.out.log`, `backend.err.log`, `frontend.*.log`, `docker.log`). The
`logs\` folder is gitignored.

## The Scheduled Task

- **Location:** `\Cronsole-Stack\CronsoleAgent` (Task Scheduler → Task Scheduler Library → Cronsole-Stack)
- **Trigger:** At logon (current user)
- **Action:** `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "…\scripts\startup-task\Start-Cronsole.ps1"`
- **Run as:** `mikes`, **Highest** privileges, Interactive
- **On failure:** restart up to 3× every 1 min; **Start when available**; multiple-instances = *Ignore new*

Because the task runs at **Highest** privileges, any change to the task itself
(action, trigger, path) requires an **elevated** PowerShell — you'll get a UAC
prompt. Editing the launcher *script* does **not**.

## How to use

**It's automatic** — just log in. To test or run it on demand:

- **Task Scheduler UI:** find `\Cronsole-Stack\CronsoleAgent`, right-click → **Run**.
- **PowerShell (no elevation needed to *run* it):**
  ```powershell
  Start-ScheduledTask -TaskName "CronsoleAgent" -TaskPath "\Cronsole-Stack\"
  ```
- **Watch it come up:**
  ```powershell
  Get-Content .\logs\launcher.log -Tail 20 -Wait
  ```
- **Run the launcher directly** (equivalent, foreground, for debugging):
  ```powershell
  .\scripts\startup-task\Start-Cronsole.ps1
  ```

Give Docker ~15–30s on a cold boot — the launcher waits for the engine before
starting db/redis.

## How to update

### Change what the launcher does (add a component, tweak a command)
Just **edit `Start-Cronsole.ps1` and save.** The task runs the script by path on
every trigger, so it always picks up the latest version — no re-registration.

Tool locations are resolved near the top of the script (Node, Docker, Docker
Desktop). The repo root is auto-detected by walking up to the folder containing
`docker-compose.yml`, so the script keeps working even if this folder moves.

### Change the task itself (action, trigger, run level, or script path)
1. Edit `CronsoleAgent.updated.xml`.
2. Re-register it from an **elevated** PowerShell (accept the UAC prompt):
   ```powershell
   Register-ScheduledTask -TaskName "CronsoleAgent" -TaskPath "\Cronsole-Stack\" `
     -Xml (Get-Content ".\scripts\startup-task\CronsoleAgent.updated.xml" -Raw) -Force
   ```
3. Verify:
   ```powershell
   (Get-ScheduledTask -TaskName "CronsoleAgent" -TaskPath "\Cronsole-Stack\").Actions
   ```

### Revert to the original (agent-only) task
From an **elevated** PowerShell:
```powershell
Register-ScheduledTask -TaskName "CronsoleAgent" -TaskPath "\Cronsole-Stack\" `
  -Xml (Get-Content ".\scripts\startup-task\CronsoleAgent.backup.xml" -Raw) -Force
```

## Stop the stack (e.g. to test a cold start)

```powershell
# frontend + backend (by listening port)
foreach ($port in 7373,3000) {
  $procId = (Get-NetTCPConnection -State Listen -LocalPort $port -EA SilentlyContinue).OwningProcess | Select-Object -First 1
  if ($procId) { Stop-Process -Id $procId -Force }
}
# agent
Get-Process -Name 'Cronsole.Agent' -EA SilentlyContinue | Stop-Process -Force
# data services
& 'D:\GDrive\Repos\Docker\resources\bin\docker.exe' compose -f .\docker-compose.yml stop db redis
```

## Troubleshooting

| Symptom | Check |
|---|---|
| Dashboard empty / red "Can't reach backend" banner | Is `:3000` listening? See `logs\backend.err.log`. |
| Backend up but **Sync tasks now** fails | Is the agent running & connected? `curl http://localhost:3000/api/tasks/health` should show `WINDOWS_TASK_SCHEDULER: HEALTHY`. |
| Nothing starts at logon | `Get-ScheduledTaskInfo -TaskName CronsoleAgent -TaskPath "\Cronsole-Stack\"` → check `LastTaskResult` (`0x0` = success). Read `logs\launcher.log`. |
| `db + redis` never come up | Docker Desktop not installed at the expected path, or engine slow to start — see `logs\docker.log`. |
| "Access is denied" editing the task | You're not elevated. Re-run in an **Administrator** PowerShell. |

> **Paths are machine-specific.** `Start-Cronsole.ps1` and the XMLs hardcode this
> machine's Node, Docker, and repo paths (and the task XML embeds the user SID).
> Adjust them before using on another machine.
