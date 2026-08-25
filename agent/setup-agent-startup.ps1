# Cronsole Agent Setup Script
# Compiles the C# Agent and hands it to the launcher that keeps it running.
#
# The agent is NOT its own scheduled task any more. It used to be registered here as
# \Cronsole-Stack\CronsoleAgent, running Cronsole.Agent.exe directly -- but
# Register-CronsoleStack.ps1 later overwrote that SAME task name with a completely
# different action (the stack launcher), so the two scripts fought over one name and
# whichever ran last won. On a machine where the launcher won, the task's description
# still said "Handles WebSocket communication" while its action started the whole
# stack, and the documented `Stop-ScheduledTask CronsoleAgent` bounce did nothing at
# all. One owner per task name; the agent's owner is \Cronsole-Stack\CronsoleStack,
# whose idempotent `cronsole.ps1 up` starts the agent if it is not running and
# re-checks every 5 minutes.

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ProjectDir = Join-Path $ScriptDir "Cronsole.Agent"
$PublishDir = Join-Path $ScriptDir "publish"
$RepoRoot   = Split-Path -Parent $ScriptDir
$ControlPs1 = Join-Path $RepoRoot "scripts\cronsole.ps1"

Write-Host "1. Building Cronsole C# Agent in Release mode..." -ForegroundColor Cyan

# Stop any running agent first -- publish fails if Cronsole.Agent.exe is locked.
# Both names: an agent launched before the 2026-07-31 exe rename is still called
# TaskHub.Agent and locks the same files, while being invisible to a lookup for the
# new name (troubleshooting #35a).
Stop-Process -Name "Cronsole.Agent","TaskHub.Agent" -Force -Confirm:$false -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

dotnet publish $ProjectDir -c Release -r win-x64 --self-contained false -o $PublishDir

if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to build and publish the agent."
    Exit 1
}

$ExePath = Join-Path $PublishDir "Cronsole.Agent.exe"
Write-Host "Agent successfully built at: $ExePath" -ForegroundColor Green

Write-Host "2. Checking the launcher that keeps the agent running..." -ForegroundColor Cyan

# Retire the obsolete per-agent task wherever it still exists, at any path. Leaving it
# means a second thing starts a second agent at logon, and two agents on one machine
# both answer task:run.
$Stale = Get-ScheduledTask -TaskName "CronsoleAgent" -ErrorAction SilentlyContinue
foreach ($Task in $Stale) {
    Write-Host "Removing obsolete CronsoleAgent task from $($Task.TaskPath)..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $Task.TaskName -TaskPath $Task.TaskPath -Confirm:$false -ErrorAction SilentlyContinue
}

$Stack = Get-ScheduledTask -TaskPath "\Cronsole-Stack\" -TaskName "CronsoleStack" -ErrorAction SilentlyContinue
if ($Stack) {
    Write-Host "  \Cronsole-Stack\CronsoleStack is registered (State: $($Stack.State))." -ForegroundColor Green
    Write-Host "  It runs 'cronsole.ps1 up' at logon and every 5 minutes, which starts the agent." -ForegroundColor Green
} else {
    Write-Host "  \Cronsole-Stack\CronsoleStack is NOT registered - nothing will start the agent at logon." -ForegroundColor Yellow
    Write-Host "  Register it once from an Administrator prompt:" -ForegroundColor Yellow
    Write-Host "    powershell -ExecutionPolicy Bypass -File scripts\startup-task\Register-CronsoleStack.ps1" -ForegroundColor Yellow
}

Write-Host "3. Starting the stack now..." -ForegroundColor Cyan
if (Test-Path $ControlPs1) {
    & $ControlPs1 up
} else {
    Write-Warning "Control script not found at $ControlPs1 - start the agent with: $ExePath"
}

Write-Host ""
Write-Host "Setup complete." -ForegroundColor Green
Write-Host "To rebuild the agent later, use the elevated republish task instead of this script:" -ForegroundColor Cyan
Write-Host "  Start-ScheduledTask -TaskPath '\Cronsole-Stack\' -TaskName 'CronsoleRepublish'" -ForegroundColor Cyan

