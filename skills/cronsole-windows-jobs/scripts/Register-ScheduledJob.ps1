<#
.SYNOPSIS
    Register (or re-register) a job's Windows Task Scheduler task, pointing it at
    Invoke-ScheduledJob.ps1 rather than at the job's own script.

.DESCRIPTION
    The registrar half of the cronsole-windows-jobs skill. Reads <JobsRoot>\<Job>\job.json
    and creates the task with the settings an unattended job actually needs -- each of
    which differs from the Windows default for a reason:

      StartWhenAvailable    A weekly job whose machine was asleep at 03:00 Sunday
                            otherwise just does not run, and says nothing about it.
      ExecutionTimeLimit    Bounded well under the cadence, so a hung run cannot still be
                            going when the next one starts. The Windows default is 72h.
      batteries allowed     The default both refuses to start on battery AND stops a
                            running task when you unplug. Both are wrong for this.
      IgnoreNew             One run at a time.
      Interactive, as you   A user-scoped environment variable (an API key for the
                            notifier, most often) is invisible to SYSTEM, and the send
                            then fails silently while the job itself works perfectly.
      RunLevel Limited      "Highest" stamps an admin ACE on the task and you then need
                            elevation to delete your own task. Set "runLevel": "Highest"
                            in job.json only when a non-elevated run would quietly do
                            LESS rather than fail.

    Idempotent: re-running it is how you apply a schedule change you just made to
    job.json.

.PARAMETER Job
    Folder name under <JobsRoot>, e.g. "cleanup-cdrive".

.PARAMETER JobsRoot
    Folder holding one subfolder per job. Defaults to $env:SCHEDULED_JOBS_ROOT, then to
    "$HOME\.claude\jobs".

.PARAMETER WhatIf
    Print what would be registered without touching Task Scheduler.

.EXAMPLE
    pwsh -File Register-ScheduledJob.ps1 -Job cleanup-cdrive -WhatIf

.NOTES
    ASCII only, no BOM. Re-registering uses -Force, which RE-ENABLES a task you had
    deliberately disabled -- re-disable it afterwards if it was parked on purpose.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)][string]$Job,
    [string]$JobsRoot
)

$ErrorActionPreference = 'Stop'

if (-not $JobsRoot) {
    $JobsRoot = if ($env:SCHEDULED_JOBS_ROOT) { $env:SCHEDULED_JOBS_ROOT }
                else { Join-Path $HOME '.claude\jobs' }
}

$JobDir     = Join-Path $JobsRoot $Job
$ConfigFile = Join-Path $JobDir 'job.json'
$Runner     = Join-Path $PSScriptRoot 'Invoke-ScheduledJob.ps1'

if (-not (Test-Path -LiteralPath $ConfigFile)) { throw "No job.json at $ConfigFile" }
if (-not (Test-Path -LiteralPath $Runner))     { throw "No runner at $Runner" }

$cfg = Get-Content -LiteralPath $ConfigFile -Raw | ConvertFrom-Json

$taskName = if ($cfg.taskName) { $cfg.taskName } else { $cfg.name }
if (-not $taskName) { throw "job.json needs a 'taskName' (or 'name')" }
$taskPath = if ($cfg.taskPath) { $cfg.taskPath } else { '\' }
if (-not $taskPath.EndsWith('\')) { $taskPath += '\' }

if ($taskPath -like '\Microsoft\*') {
    throw "Refusing to register under \Microsoft\ -- RegisterTaskDefinition silently overwrites a same-named task there."
}

# --- Action -----------------------------------------------------------------
# The task points at the RUNNER. Pointing it at the job's own script is the one
# hand-edit that silently removes the transcript, the classification and the report.

$pwsh = (Get-Command pwsh -ErrorAction SilentlyContinue).Source
if (-not $pwsh) { $pwsh = (Get-Command powershell.exe).Source }

$actionArgs = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -Job "{1}" -JobsRoot "{2}"' -f $Runner, $Job, $JobsRoot
$action = New-ScheduledTaskAction -Execute $pwsh -Argument $actionArgs -WorkingDirectory $JobDir

# --- Trigger ----------------------------------------------------------------
#   { "dayOfWeek": "Sunday", "at": "03:00" }   weekly
#   { "daily": true, "at": "07:00" }           daily
#   { "everyMinutes": 15 }                     repeating, indefinitely
#   { "atLogon": true }                        at logon (add everyMinutes to re-assert)

$s = $cfg.schedule
if (-not $s) { throw "job.json needs a 'schedule'" }

if ($s.dayOfWeek) {
    $trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $s.dayOfWeek -At $s.at
}
elseif ($s.daily) {
    $trigger = New-ScheduledTaskTrigger -Daily -At $s.at
}
elseif ($s.atLogon) {
    $trigger = New-ScheduledTaskTrigger -AtLogOn
}
elseif ($s.everyMinutes) {
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date)
}
else {
    throw "schedule needs one of: dayOfWeek+at, daily+at, atLogon, everyMinutes"
}

# A repetition interval is set on the trigger, not expressed as a cron string. Cronsole
# reads it back as */N -- but never re-create the task FROM that cron; the round trip is
# lossy.
# No -RepetitionDuration: left empty it means "indefinitely". [TimeSpan]::MaxValue serializes
# to P99999999DT23H59M59S, which Task Scheduler rejects at registration on Windows 10 and 11.
if ($s.everyMinutes) {
    $trigger.Repetition = (New-ScheduledTaskTrigger -Once -At (Get-Date) `
        -RepetitionInterval (New-TimeSpan -Minutes ([int]$s.everyMinutes))).Repetition
}

# --- Settings ---------------------------------------------------------------

# Catch-up is opt-in ("catchUp": true). Off, a run the machine slept through is skipped, not
# fired late at wake-up, which is the safer default for anything that writes or sends.
$hours = if ($cfg.executionTimeLimitHours) { [int]$cfg.executionTimeLimitHours } else { 2 }
$catchUp = [bool]$cfg.catchUp
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable:$catchUp `
    -ExecutionTimeLimit (New-TimeSpan -Hours $hours) `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -MultipleInstances IgnoreNew

# --- Principal --------------------------------------------------------------

$runLevel  = if ($cfg.runLevel -eq 'Highest') { 'Highest' } else { 'Limited' }
$principal = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive `
    -RunLevel $runLevel

# --- Register ---------------------------------------------------------------

$target = "$taskPath$taskName"

if ($PSCmdlet.ShouldProcess($target, 'Register scheduled task')) {
    Register-ScheduledTask -TaskName $taskName -TaskPath $taskPath `
        -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
        -Description "Runs job '$Job' via Invoke-ScheduledJob.ps1" -Force | Out-Null
    Write-Host "Registered: $target"
    Write-Host "  runs:     $pwsh $actionArgs"
    Write-Host "  runLevel: $runLevel"
    Write-Host "  catchUp:  $catchUp"
} else {
    Write-Host "Would register: $target"
    Write-Host "  runs:     $pwsh $actionArgs"
    Write-Host "  runLevel: $runLevel"
    Write-Host "  catchUp:  $catchUp"
}
