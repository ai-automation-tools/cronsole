<#
.SYNOPSIS
    Installs/repairs the Cronsole self-heal scheduled tasks so the local stack
    stays up - with NO PowerShell console flashing on screen.

.DESCRIPTION
    Registers \Cronsole-Stack\CronsoleStack - a watchdog that runs `scripts\cronsole.ps1 up`
    at logon and every few minutes. `up` is idempotent (it starts only what's down
    and exits), so re-running it on a short interval is safe and cheap.

    NO-FLASH LAUNCH: instead of running `powershell.exe -WindowStyle Hidden` (whose
    conhost window still flashes on every recurring fire), the task launches
    `wscript.exe run-hidden.vbs`, which starts PowerShell hidden from creation -
    nothing appears on screen. See run-hidden.vbs.

    DEDUPE: \Cronsole-Stack\CronsoleAgent is REMOVED (when -RemoveAgentTask is on, the
    default). It was a logon-only bootstrap whose one unique job was starting the Docker
    engine before calling the same `cronsole.ps1 up` CronsoleStack calls. That job now
    lives in `up` itself (Start-DockerEngine), which is the correct home for it: the
    engine had no keeper, because the only thing that ever started it ran at logon while
    the thing that runs every 5 minutes could merely warn that it was down. Once `up`
    starts the engine, CronsoleAgent is a pure duplicate of this task's logon trigger -
    and a harmful one, since both fired on logon, both called `up`, and MultipleInstances
    is per-task, so two `npm run dev` could race for :3000.

    Its name was also actively misleading: it did not run the agent and had nothing to do
    with WebSocket communication, yet the docs told you to bounce the agent by stopping
    and starting it - which did nothing at all. See Register-RestartTask.ps1, which
    registers the task that actually restarts things.

    LEAST PRIVILEGE (2026-11-11): this registers TWO recurring tasks. CronsoleStack runs
    `cronsole.ps1 up` WITHOUT elevation and starts the database, backend, frontend and
    proxy. CronsoleAgentKeeper runs `cronsole.ps1 agent` at RunLevel Highest and starts
    only the agent. Before this, one elevated task started everything, so the backend -
    and every Cronsole-native job it ran - held administrator rights. Work that needs
    them belongs in a Windows Task Scheduler task, not a native job.

    After re-registering on a machine that ran the old single task, restart once so the
    backend comes back un-elevated:
        Start-ScheduledTask -TaskPath '\Cronsole-Stack\' -TaskName 'CronsoleRestart'

    REQUIRES ELEVATION: the \Cronsole-Stack\ folder and Highest-run-level tasks need an
    administrator PowerShell. Run:

        powershell -ExecutionPolicy Bypass -File scripts\startup-task\Register-CronsoleStack.ps1

    Idempotent: re-running just re-applies the same definitions (-Force).

.PARAMETER IntervalMinutes
    Minutes between self-heal runs for CronsoleStack. Default 5.

.PARAMETER RemoveAgentTask
    Also unregister the obsolete \Cronsole-Stack\CronsoleAgent. Default: on. Set to
    $false only if you are deliberately keeping it on a machine whose `up` predates
    Start-DockerEngine - there, removing it would leave the Docker engine with no
    starter at all.
#>
[CmdletBinding()]
param(
    [int]$IntervalMinutes = 5,
    [bool]$RemoveAgentTask = $true
)

$ErrorActionPreference = 'Stop'

# Fail early with a clear message if not elevated.
$me = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "This script must be run from an elevated (Administrator) PowerShell."
}

# Repo root = startup-task -> scripts -> repo
$RepoRoot   = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$ControlPs1 = Join-Path $RepoRoot 'scripts\cronsole.ps1'
$HiddenVbs  = Join-Path $PSScriptRoot 'run-hidden.vbs'
$WScript    = 'C:\Windows\System32\wscript.exe'
$q          = '"'   # a literal double-quote, so argument strings need no backtick escaping (Windows PowerShell 5.1-safe)

if (-not (Test-Path $ControlPs1)) { throw "Control script not found at $ControlPs1" }
if (-not (Test-Path $HiddenVbs))  { throw "Hidden launcher not found at $HiddenVbs" }

# Two principals, and the difference is the point. Both run in the interactive user's
# session (the host backend, frontend and agent need it). Only the AGENT is elevated:
# it has to enumerate and change ACL'd Task Scheduler folders (troubleshooting #74).
# The web tier is not, because the backend runs Cronsole-native jobs - launched from an
# elevated task, every native job and every npm package behind it ran as administrator.
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive -RunLevel Limited
$agentPrincipal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

# --- \Cronsole-Stack\CronsoleStack: recurring self-heal via the no-flash shim ---------
# Argument: "run-hidden.vbs" "cronsole.ps1" up  (the shim launches PowerShell hidden).
$stackArg    = "$q$HiddenVbs$q $q$ControlPs1$q up"
$stackAction = New-ScheduledTaskAction -Execute $WScript -Argument $stackArg -WorkingDirectory $RepoRoot

# Two triggers, and the repetition lives on the time-based one (troubleshooting #102).
# It used to hang off the AtLogon trigger, and a logon trigger's repetition only starts AT
# a logon - so re-running this script mid-session (as every fix to these tasks asks) left
# the self-heal disarmed until the next logon, possibly days, with State 'Ready' and no
# error anywhere. A -Once trigger with an unset duration repeats forever from the moment
# it is registered; the bare AtLogon trigger only makes a fresh session start the stack
# straight away instead of within $IntervalMinutes minutes.
$stackTrigger = @(
    New-ScheduledTaskTrigger -AtLogOn
    New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
        -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)
)

# The description is what someone reads in taskschd.msc before deciding what this does, so it
# states the two facts that are NOT visible there: what `up` actually starts, and that the
# task's State and LastTaskResult are about one `up` run, not the stack (troubleshooting #86 -
# reading them as a claim about the stack is how this folder went wrong the first time).
$stackDescription = @"
KEEPS THE LOCAL CRONSOLE STACK UP. Runs scripts\cronsole.ps1 up at logon and every $IntervalMinutes minutes.

Starts whatever is currently DOWN and leaves what is up alone (idempotent, so it never spawns duplicates): the Docker engine, Postgres, the backend (:3000), the frontend (:7373), the Windows agent, and the reverse proxy on machines that ran 'cronsole remote on'.

STATE AND LAST RESULT DESCRIBE ONE 'up' RUN, NEVER THE STACK. run-hidden.vbs waits for 'up' (seconds, normally), so the task reads Running only while that run lasts, and a run past 10 minutes is ended. What it started is launched with Start-Process and runs on independently. 'up' returns 0 even when something stayed down, so a Last Result of 0 is not a health check. To ask whether the stack is up:  pwsh scripts\cronsole.ps1 status

Do not use Stop-ScheduledTask on this task to stop the stack - at most it ends an 'up' in progress; the services keep running. Use 'cronsole.ps1 down' (elevated), and disable this task first or it will restart everything within $IntervalMinutes minutes.

Registered by scripts\startup-task\Register-CronsoleStack.ps1. Runs as the interactive user WITHOUT elevation, on purpose: the backend runs native jobs, and they must not be administrators. The agent, which does need elevation, is started by \Cronsole-Stack\CronsoleAgentKeeper; 'up' asks that task for it.
"@

Register-ScheduledTask -TaskName 'CronsoleStack' -TaskPath '\Cronsole-Stack\' `
    -Action $stackAction -Trigger $stackTrigger -Settings $settings -Principal $principal `
    -Description $stackDescription `
    -Force | Out-Null

$t = Get-ScheduledTask -TaskPath '\Cronsole-Stack\' -TaskName 'CronsoleStack'
Write-Host "Registered \Cronsole-Stack\CronsoleStack (State: $($t.State), RunLevel $($t.Principal.RunLevel)) - recurring self-heal every $IntervalMinutes min, no console flash."

# --- \Cronsole-Stack\CronsoleAgentKeeper: the one elevated keeper ---------------------
# Same triggers and settings as CronsoleStack, a different verb and a different token.
# `cronsole.ps1 agent` starts the agent if it is not running and does nothing else, so
# this is the only recurring thing in the folder that holds administrator rights.
# The name is deliberately NOT CronsoleAgent: that name is retired, removed below and by
# agent\setup-agent-startup.ps1, and one script owns one task name (troubleshooting #86).
$agentArg    = "$q$HiddenVbs$q $q$ControlPs1$q agent"
$agentAction = New-ScheduledTaskAction -Execute $WScript -Argument $agentArg -WorkingDirectory $RepoRoot
$agentTrigger = @(
    New-ScheduledTaskTrigger -AtLogOn
    New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
        -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)
)
$agentDescription = @"
KEEPS THE CRONSOLE WINDOWS AGENT RUNNING, ELEVATED. Runs scripts\cronsole.ps1 agent at logon and every $IntervalMinutes minutes, which starts agent\publish\Cronsole.Agent.exe if it is not already running and does nothing else.

This is the only recurring Cronsole task with administrator rights. The agent needs them to see and change every Task Scheduler folder (troubleshooting #74). The database, backend and dashboard are started by \Cronsole-Stack\CronsoleStack without them.

STATE AND LAST RESULT DESCRIBE ONE RUN OF THE SCRIPT, NEVER THE AGENT. The agent is launched with Start-Process and outlives the run. To restart it use \Cronsole-Stack\CronsoleRestart.

Registered by scripts\startup-task\Register-CronsoleStack.ps1.
"@
Register-ScheduledTask -TaskName 'CronsoleAgentKeeper' -TaskPath '\Cronsole-Stack\' `
    -Action $agentAction -Trigger $agentTrigger -Settings $settings -Principal $agentPrincipal `
    -Description $agentDescription `
    -Force | Out-Null
$k = Get-ScheduledTask -TaskPath '\Cronsole-Stack\' -TaskName 'CronsoleAgentKeeper'
Write-Host "Registered \Cronsole-Stack\CronsoleAgentKeeper (State: $($k.State), RunLevel $($k.Principal.RunLevel)) - starts only the agent, elevated."
Write-Host ""
Write-Host "If the backend was started by the old elevated task it is still elevated until restarted:"
Write-Host "  Start-ScheduledTask -TaskPath '\Cronsole-Stack\' -TaskName 'CronsoleRestart'"

# --- \Cronsole-Stack\CronsoleAgent: remove (obsolete - see DEDUPE above) --------------
# Order matters: CronsoleStack is registered ABOVE, so the machine is never left with
# neither. Migrate-ToCronsole.ps1's rule - register the replacement before removing what
# it replaces, because a half-migrated machine that still starts beats a tidy one that
# does not.
if ($RemoveAgentTask) {
    $agent = Get-ScheduledTask -TaskPath '\Cronsole-Stack\' -TaskName 'CronsoleAgent' -ErrorAction SilentlyContinue
    if ($agent) {
        # The processes it started (agent, dev servers) were launched with Start-Process
        # and are independent of the task, so they survive this untouched. Removing it
        # stops nothing.
        Unregister-ScheduledTask -TaskPath '\Cronsole-Stack\' -TaskName 'CronsoleAgent' -Confirm:$false
        Write-Host 'Removed \Cronsole-Stack\CronsoleAgent - obsolete; "cronsole up" now starts the Docker engine itself.'
    } else {
        Write-Host "No \Cronsole-Stack\CronsoleAgent found - already removed."
    }
}

# The elevated keeper runs files from this folder, so who can write here matters as much
# as who can run the task. Reported, not applied: locking the folder also removes access
# other tools on the machine may have been given (a coding agent's sandbox account, say),
# and that is the owner's call.
Write-Host ""
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Protect-RepoFolder.ps1') -Check
if ($LASTEXITCODE -ne 0) {
    Write-Host "An account listed above can replace what the elevated agent task runs. Lock the folder:" -ForegroundColor Yellow
    Write-Host "  .\scripts\startup-task\Protect-RepoFolder.ps1" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Run CronsoleStack now with:  Start-ScheduledTask -TaskPath '\Cronsole-Stack\' -TaskName 'CronsoleStack'"
Write-Host "Register the on-demand restart task with:  .\scripts\startup-task\Register-RestartTask.ps1"
