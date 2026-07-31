<#
.SYNOPSIS
    One-time machine migration for the TaskHub -> Cronsole rename (stage 2).

.DESCRIPTION
    Stage 1 renamed the repo. This moves the state the OS points at:

      \Task-Hub\TaskHubAgent      -> \Cronsole-Stack\CronsoleAgent
      \Task-Hub\TaskHubRepublish  -> \Cronsole-Stack\CronsoleRepublish
      \Task-Hub\TaskHubStack      -> \Cronsole-Stack\CronsoleStack
      TASKHUB_TOKEN (User env)    -> CRONSOLE_TOKEN

    Registers the new tasks FIRST and only removes the old ones once each
    replacement is confirmed present. If a registration fails, the old task is
    left exactly where it is — a half-migrated machine that still starts is a far
    better outcome than a tidy one that doesn't.

    The three tasks run at RunLevel Highest, so registering them requires
    elevation; the script refuses to start without it rather than failing
    halfway through.

    Idempotent: re-running it re-registers from the current scripts and skips
    what is already migrated.

.NOTES
    The app's own task folder (\TaskHub) needs no migration — Cronsole prunes it
    when its last task is deleted, so on a machine with no app-created tasks it
    does not exist, and the next created task lands in \Cronsole by itself.
#>
[CmdletBinding()]
param(
    [switch]$WhatIfOnly
)

$ErrorActionPreference = 'Stop'

$RepoRoot   = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$OldPath    = '\Task-Hub\'
$NewPath    = '\Cronsole-Stack\'
$Migrations = @(
    @{ Old = 'TaskHubAgent';     New = 'CronsoleAgent';     Registrar = (Join-Path $RepoRoot 'agent\setup-agent-startup.ps1') },
    @{ Old = 'TaskHubRepublish'; New = 'CronsoleRepublish'; Registrar = (Join-Path $PSScriptRoot 'Register-RepublishTask.ps1') },
    @{ Old = 'TaskHubStack';     New = 'CronsoleStack';     Registrar = (Join-Path $PSScriptRoot 'Register-CronsoleStack.ps1') }
)

function Test-Elevated {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    (New-Object Security.Principal.WindowsPrincipal $id).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Elevated)) {
    Write-Error 'Run this from an Administrator prompt: it registers RunLevel Highest tasks.'
    exit 1
}

Write-Host "=== Cronsole machine migration ===" -ForegroundColor Cyan

# --- 1. Register the new tasks -------------------------------------------------
foreach ($m in $Migrations) {
    $existing = Get-ScheduledTask -TaskPath $NewPath -TaskName $m.New -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host ("  [skip] {0} already registered" -f $m.New) -ForegroundColor DarkGray
        continue
    }
    if ($WhatIfOnly) {
        Write-Host ("  [plan] register {0} via {1}" -f $m.New, (Split-Path -Leaf $m.Registrar)) -ForegroundColor Yellow
        continue
    }
    Write-Host ("  [ run] {0} -> {1}" -f (Split-Path -Leaf $m.Registrar), $m.New) -ForegroundColor Cyan

    # Each registrar runs in its OWN process, deliberately.
    #
    # agent\setup-agent-startup.ps1 ends with `Stop-Process -Id $PID` — it closes
    # its own window when a user double-clicks it. Called in-process with `&`,
    # that kills the CALLER: the first registrar took this script down with it,
    # and the run looked like it had simply stopped after one task. A child
    # process can only ever kill itself.
    #
    # The exit code is not checked for the same reason — a script that ends by
    # killing its host has no meaningful one. Success is verified below by asking
    # Task Scheduler whether the task exists, which is the thing we actually care
    # about.
    & pwsh -NoProfile -ExecutionPolicy Bypass -File $m.Registrar *>&1 | Out-Null
}

# --- 2. Remove the old tasks, but only where the replacement exists ------------
foreach ($m in $Migrations) {
    $old = Get-ScheduledTask -TaskPath $OldPath -TaskName $m.Old -ErrorAction SilentlyContinue
    if (-not $old) { continue }

    $new = Get-ScheduledTask -TaskPath $NewPath -TaskName $m.New -ErrorAction SilentlyContinue
    if (-not $new) {
        Write-Warning ("KEEPING {0}{1}: its replacement {2}{3} is not registered." -f $OldPath, $m.Old, $NewPath, $m.New)
        continue
    }
    if ($WhatIfOnly) {
        Write-Host ("  [plan] remove {0}{1}" -f $OldPath, $m.Old) -ForegroundColor Yellow
        continue
    }
    Unregister-ScheduledTask -TaskPath $OldPath -TaskName $m.Old -Confirm:$false
    Write-Host ("  [ del] {0}{1}" -f $OldPath, $m.Old) -ForegroundColor DarkGray
}

# --- 3. Drop the empty old folder ---------------------------------------------
if (-not $WhatIfOnly) {
    $remaining = @(Get-ScheduledTask -TaskPath $OldPath -ErrorAction SilentlyContinue)
    if ($remaining.Count -eq 0) {
        try {
            $svc = New-Object -ComObject 'Schedule.Service'
            $svc.Connect()
            $svc.GetFolder('\').DeleteFolder($OldPath.Trim('\'), 0)
            Write-Host ("  [ del] folder {0}" -f $OldPath) -ForegroundColor DarkGray
        } catch {
            Write-Warning ("Could not remove {0}: {1}" -f $OldPath, $_.Exception.Message)
        }
    } else {
        Write-Warning ("{0} still holds {1} task(s); leaving the folder in place." -f $OldPath, $remaining.Count)
    }
}

# --- 4. Migrate the User env var ----------------------------------------------
# Copy before delete, and verify the copy reads back, so an interrupted run can
# never lose the token. The code accepts the old name anyway, which is what makes
# this safe to do at all.
$legacyName = 'TASK' + 'HUB' + '_TOKEN'
$legacy = [Environment]::GetEnvironmentVariable($legacyName, 'User')
$current = [Environment]::GetEnvironmentVariable('CRONSOLE_TOKEN', 'User')

if ($legacy -and -not $current) {
    if ($WhatIfOnly) {
        Write-Host "  [plan] copy $legacyName -> CRONSOLE_TOKEN (User)" -ForegroundColor Yellow
    } else {
        [Environment]::SetEnvironmentVariable('CRONSOLE_TOKEN', $legacy, 'User')
        if ([Environment]::GetEnvironmentVariable('CRONSOLE_TOKEN', 'User') -eq $legacy) {
            [Environment]::SetEnvironmentVariable($legacyName, $null, 'User')
            Write-Host "  [ env] $legacyName -> CRONSOLE_TOKEN" -ForegroundColor DarkGray
        } else {
            Write-Warning "CRONSOLE_TOKEN did not read back; leaving $legacyName in place."
        }
    }
} elseif ($current) {
    Write-Host "  [skip] CRONSOLE_TOKEN already set" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "Tasks now registered:" -ForegroundColor Cyan
Get-ScheduledTask -TaskPath $NewPath -ErrorAction SilentlyContinue |
    Select-Object TaskName, State | Format-Table -AutoSize

Write-Host "A shell started before this run still has the old variable — open a new terminal." -ForegroundColor Yellow
