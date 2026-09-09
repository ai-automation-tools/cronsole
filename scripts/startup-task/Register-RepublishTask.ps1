<#
.SYNOPSIS
    Register \Cronsole-Stack\CronsoleRepublish - an on-demand, elevated task that
    rebuilds and republishes the Cronsole agent. DEV TOOL. Run once, elevated.

.DESCRIPTION
    The .NET agent never hot-reloads and runs at RunLevel Highest, so every agent
    change needs an elevated stop + publish + restart (troubleshooting #7). That
    means opening an Administrator prompt by hand, every time - which in practice
    means agent changes get tested against a stale agent, which is the exact bug
    class #7 exists to describe.

    This registers that chore as a **no-trigger** scheduled task that runs
    elevated. Afterwards anyone (including an unelevated shell, or an AI agent
    working in this repo) can run:

        Start-ScheduledTask -TaskPath '\Cronsole-Stack\' -TaskName 'CronsoleRepublish'
        Get-Content "$env:TEMP\cronsole-republish.log" -Tail 20

    One elevated registration; unlimited republishes after that.

    The task has NO trigger. It only ever runs when explicitly started - it will
    not fire on logon, on a schedule, or on idle.

.NOTES
    SECURITY - read this before running.

    A no-trigger task at RunLevel Highest that an unelevated caller can start is,
    by construction, a way to run code elevated without a UAC prompt. Be honest
    about that rather than pretend otherwise.

    Why it is an acceptable trade HERE:
      * It runs ONE fixed script from this repo (scripts\Republish-Agent.ps1),
        not arbitrary input.
      * Cronsole ALREADY does this. \Cronsole-Stack\CronsoleStack runs scripts\cronsole.ps1
        elevated on a recurring trigger. Anyone who can write to this repo already
        has elevated code execution on this machine; this adds no new capability,
        it just adds a second entry point to the same one.
      * It is a DEV tool for this working copy. It is not part of the product and
        is not registered by any installer or by Register-CronsoleStack.ps1.

    When that trade is NOT acceptable: a machine where the repo is writable by
    someone who should not have admin. Don't register it there. Unregister with:

        Unregister-ScheduledTask -TaskPath '\Cronsole-Stack\' -TaskName 'CronsoleRepublish' -Confirm:$false

    Pure ASCII on purpose (troubleshooting #6).
#>

param(
    # Remove the task instead of registering it.
    [switch]$Unregister
)

$ErrorActionPreference = 'Stop'

# Fail early with a clear message if not elevated - registering a RunLevel
# Highest task requires it, and the raw error is opaque.
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not (New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error 'This must run from an Administrator prompt (it registers a RunLevel Highest task).'
    exit 1
}

$TaskName = 'CronsoleRepublish'
$TaskPath = '\Cronsole-Stack\'

if ($Unregister) {
    $existing = Get-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($existing) {
        Unregister-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -Confirm:$false
        Write-Host "Removed $TaskPath$TaskName"
    } else {
        Write-Host "$TaskPath$TaskName is not registered; nothing to do."
    }
    exit 0
}

# Repo root = startup-task -> scripts -> repo
$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Script   = Join-Path $RepoRoot 'scripts\Republish-Agent.ps1'
$Shim     = Join-Path $PSScriptRoot 'run-hidden.vbs'
$WScript  = Join-Path $env:SystemRoot 'System32\wscript.exe'

foreach ($p in @($Script, $Shim, $WScript)) {
    if (-not (Test-Path $p)) { Write-Error "Missing required file: $p"; exit 1 }
}

# Run through run-hidden.vbs so nothing flashes on screen (troubleshooting #6's
# sibling: powershell.exe is a console app and creates a conhost window even with
# -WindowStyle Hidden).
$argument = '"{0}" "{1}"' -f $Shim, $Script

$action = New-ScheduledTaskAction -Execute $WScript -Argument $argument -WorkingDirectory $RepoRoot

# Interactive user + Highest: the republish must stop an elevated process, write
# the locked exe, and relaunch the stack in the user's session.
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive -RunLevel Highest

# IgnoreNew: two concurrent republishes would race on the same exe.
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

# The description is what someone reads in taskschd.msc before deciding what this does, so it
# names the log - this task has no console attached, so its exit code is not the story - and
# says plainly that it rebuilds from source, which is what separates it from CronsoleRestart.
$description = @"
REBUILDS THE CRONSOLE WINDOWS AGENT FROM SOURCE, then relaunches the stack. Runs scripts\Republish-Agent.ps1: stops the running agent, 'dotnet publish' into agent\publish, removes pre-rename leftovers, then cronsole.ps1 up. Takes about 20 seconds.

USE IT AFTER ANY CHANGE UNDER agent\. The .NET agent is a published exe and NEVER hot-reloads - editing agent code and restarting the stack leaves the old binary running, which is troubleshooting #7. This is the only path that swaps the binary.

ON DEMAND ONLY - THIS TASK HAS NO TRIGGER. It never fires on logon, on a schedule, or on idle. Start it by hand (no elevation needed to START it):
    Start-ScheduledTask -TaskPath '\Cronsole-Stack\' -TaskName 'CronsoleRepublish'

READ THE LOG, NOT THE EXIT CODE. This task has no console attached, and it launches fire-and-forget through run-hidden.vbs, so its State and LastTaskResult describe the launcher shim rather than the build. Everything it did is here:
    Get-Content "`$env:TEMP\cronsole-republish.log" -Tail 20
It proves the swap by comparing the published DLL timestamp before and after, and refuses to relaunch if the publish failed - a half-swapped agent is worse than a stopped one.

Runs elevated (RunLevel Highest) because the agent runs elevated: an unelevated shell can neither stop it nor overwrite its locked exe.

To restart the agent WITHOUT rebuilding it, use CronsoleRestart instead.

DEV TOOL - not part of what ships to users. Registered by scripts\startup-task\Register-RepublishTask.ps1 (pass -Unregister to remove).
"@

# NOTE: no -Trigger. On-demand only.
Register-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath `
    -Action $action -Principal $principal -Settings $settings `
    -Description $description -Force | Out-Null

$t = Get-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName
Write-Host ""
Write-Host "Registered $TaskPath$TaskName"
Write-Host ("  runs as : {0} (RunLevel {1})" -f $t.Principal.UserId, $t.Principal.RunLevel)
Write-Host ("  triggers: {0}" -f $(if ($t.Triggers) { $t.Triggers.Count } else { 'none (on-demand only)' }))
Write-Host ("  action  : {0}" -f $Script)
Write-Host ""
Write-Host "Republish from any prompt (no elevation needed):"
Write-Host "  Start-ScheduledTask -TaskPath '$TaskPath' -TaskName '$TaskName'"
Write-Host "  Get-Content `"`$env:TEMP\cronsole-republish.log`" -Tail 20"
Write-Host ""
Write-Host "Remove it with:  .\scripts\startup-task\Register-RepublishTask.ps1 -Unregister"
