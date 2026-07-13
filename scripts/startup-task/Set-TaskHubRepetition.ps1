<#
.SYNOPSIS
    DEPRECATED - adds a repeating trigger to \Task-Hub\TaskHubAgent.

.DESCRIPTION
    Superseded by \Task-Hub\TaskHubStack (see Register-TaskHubStack.ps1), which now
    owns the recurring self-heal (`taskhub.ps1 up` every few minutes) and launches
    hidden via run-hidden.vbs so nothing flashes on screen. Adding a repetition to
    TaskHubAgent as well makes BOTH tasks re-run `up` on an interval - redundant
    work and double the PowerShell console flashing. TaskHubAgent should stay a
    flash-free, logon-only bootstrap (Docker + up); Register-TaskHubStack.ps1
    -RepairAgentTask already resets it to exactly that.

    Only use this script if you deliberately want a SECOND recurring self-heal on
    TaskHubAgent (you almost certainly don't). Pass -Force to proceed.

    REQUIRES ELEVATION: the task runs at RunLevel Highest, so editing its
    definition needs an administrator PowerShell.

.PARAMETER IntervalMinutes
    Minutes between launcher re-runs. Default 10.

.PARAMETER Force
    Proceed despite the deprecation (this script is a no-op without it).
#>
[CmdletBinding()]
param(
    [int]$IntervalMinutes = 10,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

if (-not $Force) {
    Write-Warning "DEPRECATED: TaskHubStack owns recurring self-heal now (Register-TaskHubStack.ps1)."
    Write-Warning "Adding a repetition to TaskHubAgent duplicates it and doubles the console flashing."
    Write-Warning "Re-run with -Force only if you truly want a second recurring self-heal task."
    return
}

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
