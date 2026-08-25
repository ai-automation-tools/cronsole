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

# Shared principal/settings for the self-heal tasks: run in the interactive
# user's session (host backend/frontend/agent need it), elevated so a (re)started
# agent can manage Windows Task Scheduler.
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

# --- \Cronsole-Stack\CronsoleStack: recurring self-heal via the no-flash shim ---------
# Argument: "run-hidden.vbs" "cronsole.ps1" up  (the shim launches PowerShell hidden).
$stackArg    = "$q$HiddenVbs$q $q$ControlPs1$q up"
$stackAction = New-ScheduledTaskAction -Execute $WScript -Argument $stackArg -WorkingDirectory $RepoRoot

# AtLogon trigger + an indefinite repetition (borrow the Repetition object from a
# throwaway -Once trigger - the documented way to attach one; unset duration = forever).
$stackTrigger = New-ScheduledTaskTrigger -AtLogOn
$stackTrigger.Repetition = (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)).Repetition

Register-ScheduledTask -TaskName 'CronsoleStack' -TaskPath '\Cronsole-Stack\' `
    -Action $stackAction -Trigger $stackTrigger -Settings $settings -Principal $principal `
    -Description "Self-heals the local Cronsole stack via scripts\cronsole.ps1 up (at logon + every $IntervalMinutes min), launched hidden via run-hidden.vbs." `
    -Force | Out-Null

$t = Get-ScheduledTask -TaskPath '\Cronsole-Stack\' -TaskName 'CronsoleStack'
Write-Host "Registered \Cronsole-Stack\CronsoleStack (State: $($t.State)) - recurring self-heal every $IntervalMinutes min, no console flash."

# --- \Cronsole-Stack\CronsoleAgent: remove (obsolete - see DEDUPE above) --------------
# Order matters: CronsoleStack is registered ABOVE, so the machine is never left with
# neither. Migrate-ToCronsole.ps1's rule - register the replacement before removing what
# it replaces, because a half-migrated machine that still starts beats a tidy one that
# does not.
if ($RemoveAgentTask) {
    $agent = Get-ScheduledTask -TaskPath '\Cronsole-Stack\' -TaskName 'CronsoleAgent' -ErrorAction SilentlyContinue
    if ($agent) {
        # It launches fire-and-forget through wscript, so there is nothing running to
        # stop - but the processes it started (agent, dev servers) are independent of
        # the task and survive this untouched. Removing it stops nothing.
        Unregister-ScheduledTask -TaskPath '\Cronsole-Stack\' -TaskName 'CronsoleAgent' -Confirm:$false
        Write-Host 'Removed \Cronsole-Stack\CronsoleAgent - obsolete; "cronsole up" now starts the Docker engine itself.'
    } else {
        Write-Host "No \Cronsole-Stack\CronsoleAgent found - already removed."
    }
}

Write-Host ""
Write-Host "Run CronsoleStack now with:  Start-ScheduledTask -TaskPath '\Cronsole-Stack\' -TaskName 'CronsoleStack'"
Write-Host "Register the on-demand restart task with:  .\scripts\startup-task\Register-RestartTask.ps1"
