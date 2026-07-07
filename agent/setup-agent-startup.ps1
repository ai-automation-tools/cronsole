# TaskHub Agent Startup Registration Script
# This script compiles the C# Agent and registers it to run automatically on user logon via Windows Task Scheduler.

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ProjectDir = Join-Path $ScriptDir "TaskHub.Agent"
$PublishDir = Join-Path $ScriptDir "publish"

Write-Host "1. Building TaskHub C# Agent in Release mode..." -ForegroundColor Cyan

# Stop any running agent first — publish fails if TaskHub.Agent.exe is locked.
Stop-ScheduledTask -TaskPath "\Task-Hub\" -TaskName "TaskHubAgent" -ErrorAction SilentlyContinue
Stop-Process -Name "TaskHub.Agent" -Force -Confirm:$false -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

dotnet publish $ProjectDir -c Release -r win-x64 --self-contained false -o $PublishDir

if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to build and publish the agent."
    Exit 1
}

$ExePath = Join-Path $PublishDir "TaskHub.Agent.exe"
Write-Host "Agent successfully built at: $ExePath" -ForegroundColor Green

Write-Host "2. Registering Windows Task Scheduler startup task..." -ForegroundColor Cyan

$TaskName = "TaskHubAgent"
$TaskPath = "\Task-Hub\"
$Description = "TaskHub Local Control Plane Agent - Handles WebSocket communication with TaskHub backend."

# Create trigger (At Logon)
$Trigger = New-ScheduledTaskTrigger -AtLogon

# Create action (Execute the built agent exe)
$Action = New-ScheduledTaskAction -Execute $ExePath -WorkingDirectory $PublishDir

# Settings (Run in background, restart if failed, don't stop if idle, allow start on batteries)
# ExecutionTimeLimit 0 = no limit. Without it, Task Scheduler defaults to PT72H and
# silently kills the long-running agent after 3 days (restart-on-failure does NOT
# apply to time-limit kills), leaving TaskHub offline until the next logon.
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Seconds 0)

# Register the task (Run with highest privileges under the current user context)
$Principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Highest

# Unregister existing task if it exists
$ExistingTasks = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
foreach ($Task in $ExistingTasks) {
    Write-Host "Removing existing TaskHubAgent task from path $($Task.TaskPath)..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $Task.TaskName -TaskPath $Task.TaskPath -Confirm:$false
}

Register-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -Trigger $Trigger -Action $Action -Settings $Settings -Principal $Principal -Description $Description

Write-Host "Startup task registered successfully!" -ForegroundColor Green
Write-Host "Starting TaskHub Agent task in the background..." -ForegroundColor Cyan
Start-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath

Write-Host "The TaskHub agent will now launch automatically in the background whenever you log into Windows." -ForegroundColor Green
Write-Host "Startup complete! Closing this terminal window in 3 seconds..." -ForegroundColor Yellow

Start-Sleep -Seconds 3
Stop-Process -Id $PID

