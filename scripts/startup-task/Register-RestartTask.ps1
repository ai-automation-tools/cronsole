<#
.SYNOPSIS
    Register \Cronsole-Stack\CronsoleRestart - an on-demand, elevated task that
    restarts the whole local stack via `cronsole.ps1 restart`. Run once, elevated.

.DESCRIPTION
    Until this existed, NOTHING in \Cronsole-Stack\ could restart anything, and the
    docs said otherwise. Both `docs/troubleshooting/README.md` and the Agent Setup
    Guide told you to bounce the agent with:

        Stop-ScheduledTask  -TaskPath '\Cronsole-Stack\' -TaskName 'CronsoleAgent'
        Start-ScheduledTask -TaskPath '\Cronsole-Stack\' -TaskName 'CronsoleAgent'

    Both halves were no-ops, for two independent reasons:

      * STOP had nothing to stop. That task launched through run-hidden.vbs, which
        is fire-and-forget (`WScript.Shell.Run(cmd, 0, False)`), so wscript.exe
        exited within a second and the task instance was long gone while the agent
        it had started ran on as an unrelated process. The task sat at `Ready`
        while the agent held a pid - so `Stop-ScheduledTask` returned success
        having killed nothing.
      * START would not restart it. It ended in `cronsole.ps1 up`, and `up` is
        idempotent by design: it starts what is DOWN and leaves what is UP alone.
        Seeing a live agent it printed "agent already up" and returned 0.

    So the one recovery gesture named for troubleshooting #74 (an unelevated agent
    that cannot see ACL'd folders, so dozens of tasks flip to MISSING) reported
    success while changing nothing - which is worse than an error, because the
    next step is to believe it and go looking somewhere else.

    `cronsole.ps1 restart` is the verb that actually does it (Invoke-Down, which
    force-stops the agent, then Invoke-Up). It only needs ELEVATION: the agent runs
    at RunLevel Highest, so an unelevated Stop-Process is refused - and `Invoke-Down`
    is careful enough to say so rather than print "stopped agent" at a live one.
    A RunLevel Highest task is exactly how that elevation gets supplied without a
    UAC prompt per bounce.

.NOTES
    SECURITY - same trade as Register-RepublishTask.ps1, read that one's NOTES.

    A no-trigger task at RunLevel Highest that an unelevated caller can start is,
    by construction, a way to run code elevated without a UAC prompt. It is an
    acceptable trade here for the same three reasons: it runs ONE fixed script from
    this repo, \Cronsole-Stack\CronsoleStack ALREADY runs that same script elevated
    every 5 minutes (so this adds an entry point, not a capability), and anyone who
    can write to this repo already has elevated execution on this machine.

    Do not register it on a machine where the repo is writable by someone who
    should not have admin.

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

$TaskName = 'CronsoleRestart'
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
$Script   = Join-Path $RepoRoot 'scripts\cronsole.ps1'
$Shim     = Join-Path $PSScriptRoot 'run-hidden.vbs'
$WScript  = Join-Path $env:SystemRoot 'System32\wscript.exe'

foreach ($p in @($Script, $Shim, $WScript)) {
    if (-not (Test-Path $p)) { Write-Error "Missing required file: $p"; exit 1 }
}

# Through run-hidden.vbs so nothing flashes on screen, same as its two siblings.
$argument = '"{0}" "{1}" restart' -f $Shim, $Script

$action = New-ScheduledTaskAction -Execute $WScript -Argument $argument -WorkingDirectory $RepoRoot

# Interactive user + Highest: the restart must stop an elevated agent process and
# relaunch the dev servers in the user's own session.
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive -RunLevel Highest

# IgnoreNew: two concurrent restarts would have one's `down` racing the other's `up`,
# which is how you end up with the stack stopped and both runs reporting success.
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

# The description is what someone reads in taskschd.msc before deciding what this does, so it
# spends most of its length on the thing that is NOT visible there: that Stop/Start on a task in
# this folder does nothing, which is the mistake this task exists to replace.
$description = @"
RESTARTS THE WHOLE LOCAL CRONSOLE STACK. Runs scripts\cronsole.ps1 restart - stops the Windows agent, the backend and the frontend, then brings all of them back. Takes about 15 seconds. Leaves Postgres and Redis running.

ON DEMAND ONLY - THIS TASK HAS NO TRIGGER. It never fires on logon, on a schedule, or on idle. Start it by hand (no elevation needed to START it):
    Start-ScheduledTask -TaskPath '\Cronsole-Stack\' -TaskName 'CronsoleRestart'

THIS IS THE CORRECT WAY TO BOUNCE THE AGENT. Stop-ScheduledTask / Start-ScheduledTask on a task in this folder stops and starts NOTHING: every one of them launches fire-and-forget through run-hidden.vbs, so there is no instance left to stop, and 'up' is idempotent so it will not replace an agent that is already running. That pair returned success while changing nothing for months - see troubleshooting #86.

Runs elevated (RunLevel Highest) because the agent itself runs elevated, so an unelevated Stop-Process against it is refused.

Use this when: an E2E run took the agent's socket and Windows reads Offline; the agent came up unelevated and tasks flipped to MISSING (troubleshooting #74); or the backend was restarted and you want a clean reconnect. To rebuild the agent FROM SOURCE instead, use CronsoleRepublish.

STATE READS 'READY', NEVER 'RUNNING' - that is correct, and LastTaskResult describes the launcher shim rather than the stack. Confirm the real result with:  pwsh scripts\cronsole.ps1 status

Registered by scripts\startup-task\Register-RestartTask.ps1 (pass -Unregister to remove).
"@

# NOTE: no -Trigger. On-demand only. A restart on a timer would be a way to lose
# work on a schedule; the recurring task is CronsoleStack, and its verb is `up`.
Register-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath `
    -Action $action -Principal $principal -Settings $settings `
    -Description $description -Force | Out-Null

$t = Get-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName
Write-Host ""
Write-Host "Registered $TaskPath$TaskName"
Write-Host ("  runs as : {0} (RunLevel {1})" -f $t.Principal.UserId, $t.Principal.RunLevel)
Write-Host ("  triggers: {0}" -f $(if ($t.Triggers) { $t.Triggers.Count } else { 'none (on-demand only)' }))
Write-Host ("  action  : {0} restart" -f $Script)
Write-Host ""
Write-Host "Restart the stack from any prompt (no elevation needed):"
Write-Host "  Start-ScheduledTask -TaskPath '$TaskPath' -TaskName '$TaskName'"
Write-Host ""
Write-Host "It takes ~15s. Confirm with:  pwsh scripts\cronsole.ps1 status"
Write-Host ""
Write-Host "Remove it with:  .\scripts\startup-task\Register-RestartTask.ps1 -Unregister"
