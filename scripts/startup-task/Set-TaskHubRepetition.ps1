<#
.SYNOPSIS
    Adds a repeating trigger to the \Task-Hub\TaskHubAgent scheduled task so the
    idempotent launcher (Start-TaskHub.ps1) re-runs periodically and self-heals
    any dead component (agent, backend, frontend, db/redis).

.DESCRIPTION
    The task fires AtLogon and the launcher exits once everything is started, so a
    component that crashes mid-session would otherwise stay down until the next
    logon. Start-TaskHub.ps1 skips anything already running, so re-running it every
    few minutes is safe and only relaunches what actually died.

    This preserves the existing AtLogon trigger and only adds a repetition to it;
    actions, settings, and principal are left untouched. Idempotent: re-running
    just re-applies the same repetition.

    REQUIRES ELEVATION: the task runs at RunLevel Highest, so editing its
    definition needs an administrator PowerShell.

.PARAMETER IntervalMinutes
    Minutes between launcher re-runs. Default 10.
#>
[CmdletBinding()]
param(
    [int]$IntervalMinutes = 10
)

$ErrorActionPreference = 'Stop'

$taskPath = '\Task-Hub\'
$taskName = 'TaskHubAgent'

# Fail early with a clear message if not elevated.
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "This script must be run from an elevated (Administrator) PowerShell."
}

# Rebuild the AtLogon trigger with a repetition. Borrow the Repetition object from
# a throwaway -Once trigger (the documented way to attach one). Leaving the
# duration unset makes Task Scheduler repeat indefinitely.
$logon = New-ScheduledTaskTrigger -AtLogOn
$logon.Repetition = (New-ScheduledTaskTrigger -Once -At (Get-Date) `
    -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)).Repetition

Set-ScheduledTask -TaskPath $taskPath -TaskName $taskName -Trigger $logon | Out-Null

# Verify.
$t = Get-ScheduledTask -TaskPath $taskPath -TaskName $taskName
foreach ($trg in $t.Triggers) {
    $dur = if ($trg.Repetition.Duration) { $trg.Repetition.Duration } else { '(indefinite)' }
    Write-Host ("Trigger: {0}  Enabled={1}  RepeatEvery={2}  Duration={3}" -f `
        $trg.CimClass.CimClassName, $trg.Enabled, $trg.Repetition.Interval, $dur)
}
Write-Host "Done. Launcher will now re-run every $IntervalMinutes min (plus at logon) and self-heal dead components."
