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

    DEDUPE: \Cronsole-Stack\CronsoleAgent (the logon bootstrap that also starts Docker
    Desktop) used to carry its own recurring repetition via Set-CronsoleRepetition.ps1,
    so BOTH tasks re-ran `cronsole.ps1 up` on an interval - redundant work and double
    the flashing. CronsoleStack now owns the recurring self-heal, so this script (when
    -RepairAgentTask is on, the default) resets any existing CronsoleAgent to a clean
    logon-only trigger and points it at run-hidden.vbs too - leaving one recurring
    self-heal task and one flash-free logon bootstrap.

    REQUIRES ELEVATION: the \Cronsole-Stack\ folder and Highest-run-level tasks need an
    administrator PowerShell. Run:

        powershell -ExecutionPolicy Bypass -File scripts\startup-task\Register-CronsoleStack.ps1

    Idempotent: re-running just re-applies the same definitions (-Force).

.PARAMETER IntervalMinutes
    Minutes between self-heal runs for CronsoleStack. Default 5.

.PARAMETER RepairAgentTask
    Also reset an existing \Cronsole-Stack\CronsoleAgent to a flash-free, logon-only
    definition (removes its redundant recurring repetition). Default: on.
#>
[CmdletBinding()]
param(
    [int]$IntervalMinutes = 5,
    [bool]$RepairAgentTask = $true
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
$StartPs1   = Join-Path $PSScriptRoot 'Start-Cronsole.ps1'
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

# --- \Cronsole-Stack\CronsoleAgent: repair to a flash-free, logon-only bootstrap ------
if ($RepairAgentTask) {
    $agent = Get-ScheduledTask -TaskPath '\Cronsole-Stack\' -TaskName 'CronsoleAgent' -ErrorAction SilentlyContinue
    if ($agent) {
        if (Test-Path $StartPs1) {
            # Launch the Docker-bootstrap-plus-up launcher hidden, at logon only -
            # CronsoleStack owns the recurring self-heal now, so no repetition here.
            $agentArg    = "$q$HiddenVbs$q $q$StartPs1$q"
            $agentAction = New-ScheduledTaskAction -Execute $WScript -Argument $agentArg -WorkingDirectory $RepoRoot
            $agentTrigger = New-ScheduledTaskTrigger -AtLogOn
            Set-ScheduledTask -TaskPath '\Cronsole-Stack\' -TaskName 'CronsoleAgent' `
                -Action $agentAction -Trigger $agentTrigger -Settings $settings -Principal $principal | Out-Null
            Write-Host "Repaired \Cronsole-Stack\CronsoleAgent - logon-only bootstrap (Docker + up), no recurring repetition, no console flash."
        } else {
            Write-Warning "CronsoleAgent exists but Start-Cronsole.ps1 was not found at $StartPs1 - left it unchanged."
        }
    } else {
        Write-Host "No \Cronsole-Stack\CronsoleAgent found - nothing to dedupe (CronsoleStack alone covers self-heal)."
    }
}

Write-Host ""
Write-Host "Run CronsoleStack now with:  Start-ScheduledTask -TaskPath '\Cronsole-Stack\' -TaskName 'CronsoleStack'"
