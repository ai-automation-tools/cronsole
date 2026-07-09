<#
.SYNOPSIS
    Registers the \Task-Hub\TaskHubStack scheduled task: a self-heal watchdog that
    runs `scripts\taskhub.ps1 up` at logon and every few minutes, so a component
    that dies mid-session comes back on its own (faster than the 10-min launcher).

.DESCRIPTION
    `taskhub.ps1 up` is idempotent — it starts only what's actually down and exits —
    so re-running it on a short interval is safe and cheap. This is a lighter,
    clearly-named companion to \Task-Hub\TaskHubAgent (which boots the full stack at
    logon and bootstraps Docker Desktop). Both call the same idempotent `up`, so
    they never fight or spawn duplicates.

    REQUIRES ELEVATION: the \Task-Hub\ folder and a Highest-run-level task need an
    administrator PowerShell to create. Run:

        powershell -ExecutionPolicy Bypass -File scripts\startup-task\Register-TaskHubStack.ps1

    Idempotent: re-running just re-applies the same definition (-Force).

.PARAMETER IntervalMinutes
    Minutes between self-heal runs. Default 5.
#>
[CmdletBinding()]
param(
    [int]$IntervalMinutes = 5
)

$ErrorActionPreference = 'Stop'

# Fail early with a clear message if not elevated.
$me = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "This script must be run from an elevated (Administrator) PowerShell."
}

# Repo root = startup-task -> scripts -> repo
$RepoRoot   = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$ControlPs1 = Join-Path $RepoRoot 'scripts\taskhub.ps1'
$PsExe      = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'

if (-not (Test-Path $ControlPs1)) { throw "Control script not found at $ControlPs1" }

$argument = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ControlPs1`" up"
$action   = New-ScheduledTaskAction -Execute $PsExe -Argument $argument -WorkingDirectory $RepoRoot

# AtLogon trigger + an indefinite repetition (borrow the Repetition object from a
# throwaway -Once trigger — the documented way to attach one; unset duration = forever).
$trigger = New-ScheduledTaskTrigger -AtLogOn
$trigger.Repetition = (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)).Repetition

$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

# Run in the interactive user's session (host backend/frontend/agent need it),
# elevated so a (re)started agent can manage Windows Task Scheduler.
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive -RunLevel Highest

Register-ScheduledTask -TaskName 'TaskHubStack' -TaskPath '\Task-Hub\' `
    -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
    -Description "Self-heals the local TaskHub stack via scripts\taskhub.ps1 up (at logon + every $IntervalMinutes min)." `
    -Force | Out-Null

$t = Get-ScheduledTask -TaskPath '\Task-Hub\' -TaskName 'TaskHubStack'
Write-Host "Registered \Task-Hub\TaskHubStack (State: $($t.State))."
Write-Host "It runs 'taskhub.ps1 up' at logon and every $IntervalMinutes minutes."
Write-Host "Run it now with:  Start-ScheduledTask -TaskPath '\Task-Hub\' -TaskName 'TaskHubStack'"
