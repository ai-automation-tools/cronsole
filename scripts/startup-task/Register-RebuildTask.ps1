<#
.SYNOPSIS
    Register \Cronsole-Stack\CronsoleRebuild - an hourly task that rebuilds
    frontend\dist when the reverse proxy is serving a stale one.

.DESCRIPTION
    The proxy (tailnet / phone access) serves the BUILT dashboard in frontend\dist,
    and nothing rebuilt it: `cronsole up` starts the proxy and never builds. So after
    any frontend change the phone showed the old UI while :7373 on the desktop was
    current (troubleshooting #53). This task runs `cronsole.ps1 rebuild` hourly,
    which builds only when scripts\check-dist-fresh.mjs says dist is stale or missing,
    and only on a machine that ran `cronsole remote on`.

    Hourly rather than inside the 5-minute `up`: a build costs ~30s of CPU, and an
    hour is an acceptable lag for a UI change to reach the phone. Run
    `cronsole rebuild` by hand when you want it now.

    No elevation needed or used: building is an ordinary user action. Same no-flash
    launch as the other \Cronsole-Stack\ tasks (wscript -> run-hidden.vbs).

        pwsh -File scripts\startup-task\Register-RebuildTask.ps1
        pwsh -File scripts\startup-task\Register-RebuildTask.ps1 -Unregister

    Idempotent. Pure ASCII on purpose (troubleshooting #6).
#>
[CmdletBinding()]
param(
    [int]$IntervalMinutes = 60,
    [switch]$Unregister
)

$ErrorActionPreference = 'Stop'
$TaskName = 'CronsoleRebuild'
$TaskPath = '\Cronsole-Stack\'

if ($Unregister) {
    if (Get-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -Confirm:$false
        Write-Host "Removed $TaskPath$TaskName"
    } else { Write-Host "$TaskPath$TaskName is not registered; nothing to do." }
    return
}

$RepoRoot   = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$ControlPs1 = Join-Path $RepoRoot 'scripts\cronsole.ps1'
$HiddenVbs  = Join-Path $PSScriptRoot 'run-hidden.vbs'
$q          = '"'

$action = New-ScheduledTaskAction -Execute 'C:\Windows\System32\wscript.exe' `
    -Argument "$q$HiddenVbs$q $q$ControlPs1$q rebuild" -WorkingDirectory $RepoRoot
# Repetition on a -Once trigger, never on a logon trigger (troubleshooting #102).
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) `
    -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

$description = @"
REBUILDS frontend\dist WHEN THE PROXY IS SERVING A STALE ONE. Runs scripts\cronsole.ps1 rebuild every $IntervalMinutes minutes.

Builds only when scripts\check-dist-fresh.mjs reports dist older than the source (or missing), and only on a machine that ran 'cronsole remote on'. Otherwise a no-op. Build output: logs\rebuild.log.

Exists because the proxy serves the built dashboard and nothing else rebuilds it, so the phone kept showing an old UI after every frontend change (troubleshooting #53).

Registered by scripts\startup-task\Register-RebuildTask.ps1.
"@

Register-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal -Description $description -Force | Out-Null

$t = Get-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName
Write-Host "Registered $TaskPath$TaskName (State: $($t.State)) - every $IntervalMinutes min."
