<#
.SYNOPSIS
    Rebuild and republish the Cronsole Windows agent, then relaunch the stack.

.DESCRIPTION
    The .NET agent is a host process running the published exe and it NEVER
    hot-reloads (troubleshooting #7). It also runs at RunLevel Highest, so an
    unelevated shell can neither Stop-Process it nor overwrite its locked exe.
    That makes every agent change a manual, elevated chore.

    This script is that chore, scripted. It is normally invoked by the on-demand
    scheduled task \Cronsole-Stack\CronsoleRepublish (see
    scripts/startup-task/Register-RepublishTask.ps1), which runs elevated and can
    therefore be triggered from an ordinary prompt:

        Start-ScheduledTask -TaskPath '\Cronsole-Stack\' -TaskName 'CronsoleRepublish'

    It can also be run directly from an Administrator prompt.

    DEV TOOL. Not part of what ships to users.

    Everything is logged to $env:TEMP\cronsole-republish.log so the caller - which
    has no console attached when run via the task - can read what actually
    happened instead of assuming an exit code told the whole story.

.NOTES
    Pure ASCII on purpose (troubleshooting #6): a non-ASCII char in a BOM-less
    UTF-8 .ps1 makes Windows PowerShell 5.1 decode it into a curly quote and fail
    to parse.
#>

param(
    # Skip relaunching the stack (useful when you only want the new binaries).
    [switch]$NoStart
)

$ErrorActionPreference = 'Continue'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$Log      = Join-Path $env:TEMP 'cronsole-republish.log'

function Write-Log($msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    Write-Host $line
    Add-Content -Path $Log -Value $line -ErrorAction SilentlyContinue
}

Set-Content -Path $Log -Value "=== Cronsole agent republish ===" -ErrorAction SilentlyContinue
Write-Log "repo: $RepoRoot"

# --- Refuse honestly if not elevated -----------------------------------------
# Without this the failure is a confusing "file in use" from dotnet publish
# rather than the real reason.
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$isAdmin  = (New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
Write-Log ("elevated: {0} (user {1})" -f $isAdmin, $identity.Name)
if (-not $isAdmin) {
    Write-Log 'ABORT: not elevated. The agent runs at RunLevel Highest, so stopping it and replacing its locked exe both require elevation.'
    Write-Log 'Run this from an Administrator prompt, or trigger \Cronsole-Stack\CronsoleRepublish (which runs elevated).'
    exit 2
}

# --- 1. Record the current build so the swap can be proven -------------------
$Dll = Join-Path $RepoRoot 'agent\publish\Cronsole.Agent.dll'
$before = if (Test-Path $Dll) { (Get-Item $Dll).LastWriteTime } else { $null }
Write-Log ("current published dll: {0}" -f $(if ($before) { $before } else { '(none)' }))

# --- 2. Stop the running agent so its exe can be replaced --------------------
# Both names. An agent that started before the 2026-07-31 exe rename is still called
# TaskHub.Agent and still locks files in agent\publish - stopping only the new name
# leaves it running, and the "no agent process running" line below would be a lie
# told right before a publish that then fails on a locked file.
$AgentProcNames = @('Cronsole.Agent', 'TaskHub.Agent')
$proc = @(Get-Process -Name $AgentProcNames -ErrorAction SilentlyContinue)
if ($proc.Count -gt 0) {
    Write-Log ("stopping agent: {0}" -f (($proc | ForEach-Object { "$($_.ProcessName) (pid $($_.Id))" }) -join ', '))
    $proc | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    $left = @(Get-Process -Name $AgentProcNames -ErrorAction SilentlyContinue)
    if ($left.Count -gt 0) {
        Write-Log ("ABORT: agent still running (pid {0}); publish would fail on the locked exe." -f ($left.Id -join ', '))
        exit 3
    }
    Write-Log 'agent stopped'
} else {
    Write-Log 'no agent process running'
}

# --- 3. Rebuild + publish ----------------------------------------------------
Write-Log 'dotnet publish ...'
Push-Location $RepoRoot
try {
    $output = & dotnet publish '.\agent\Cronsole.Agent' -c Release -r win-x64 --self-contained false -o '.\agent\publish' 2>&1
    $exit = $LASTEXITCODE
} finally {
    Pop-Location
}
$output | ForEach-Object { Add-Content -Path $Log -Value ("    " + $_) -ErrorAction SilentlyContinue }
Write-Log "dotnet publish exit: $exit"

if ($exit -ne 0) {
    Write-Log 'ABORT: publish failed; NOT relaunching the stack (a half-swapped agent is worse than a stopped one).'
    exit $exit
}

# Prove the binary actually moved. A publish can "succeed" without replacing a
# locked file, and a stale dll is exactly the bug this script exists to avoid.
if (Test-Path $Dll) {
    $after = (Get-Item $Dll).LastWriteTime
    Write-Log "new published dll: $after"
    if ($before -and $after -le $before) {
        Write-Log 'WARN: dll timestamp did not advance - the swap may not have happened.'
    }
}

# --- 3b. Remove pre-rename leftovers from the publish folder -----------------
# `dotnet publish` writes into the output dir; it does not clean it. So the old
# TaskHub.Agent.exe/.dll survive the rename and sit next to the new ones, launchable
# by a double-click into a process nothing here would find under the new name. Its
# runtimeconfig/deps are gone, so it can no longer even start - it is purely a trap.
$stale = @(Get-ChildItem (Join-Path $RepoRoot 'agent\publish') -Filter 'TaskHub.Agent.*' -File -ErrorAction SilentlyContinue)
foreach ($f in $stale) {
    Remove-Item $f.FullName -Force -ErrorAction SilentlyContinue
    Write-Log ("removed pre-rename leftover: {0}" -f $f.Name)
}

# --- 4. Relaunch the stack ---------------------------------------------------
if ($NoStart) {
    Write-Log 'NoStart set; skipping stack relaunch.'
} else {
    Write-Log 'relaunching stack (cronsole.ps1 up) ...'
    $up = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $RepoRoot 'scripts\cronsole.ps1') up 2>&1
    $up | ForEach-Object { Add-Content -Path $Log -Value ("    " + $_) -ErrorAction SilentlyContinue }
    Write-Log "cronsole.ps1 up exit: $LASTEXITCODE"

    Start-Sleep -Seconds 3
    $new = Get-Process -Name 'Cronsole.Agent' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($new) {
        Write-Log ("agent running: pid {0}, started {1}" -f $new.Id, $new.StartTime)
    } else {
        Write-Log 'WARN: no Cronsole.Agent process after relaunch. Check the backend health endpoint before assuming it failed - the agent may still be starting.'
    }
}

Write-Log 'DONE'
exit 0
