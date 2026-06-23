# TaskHub Agent Startup Registration Script
# This script compiles the C# Agent and registers it to run automatically on user logon via Windows Task Scheduler.

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ProjectDir = Join-Path $ScriptDir "TaskHub.Agent"
$PublishDir = Join-Path $ScriptDir "publish"

Write-Host "1. Building TaskHub C# Agent in Release mode..." -ForegroundColor Cyan
dotnet publish $ProjectDir -c Release -r win-x64 --self-contained false -o $PublishDir

if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to build and publish the agent."
    Exit 1
}

$ExePath = Join-Path $PublishDir "TaskHub.Agent.exe"
Write-Host "Agent successfully built at: $ExePath" -ForegroundColor Green

Write-Host "2. Registering Windows Task Scheduler startup task..." -ForegroundColor Cyan

$TaskName = "TaskHubAgent"
$Description = "TaskHub Local Control Plane Agent - Handles WebSocket communication with TaskHub backend."

# Create trigger (At Logon)
$Trigger = New-ScheduledTaskTrigger -AtLogon

# Create action (Execute the built agent exe)
$Action = New-ScheduledTaskAction -Execute $ExePath -WorkingDirectory $PublishDir

# Settings (Run in background, restart if failed, don't stop if idle, allow start on batteries)
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

# Register the task (Run with highest privileges under the current user context)
$Principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Highest

# Unregister existing task if it exists
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Write-Host "Removing existing TaskHubAgent task..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask -TaskName $TaskName -Trigger $Trigger -Action $Action -Settings $Settings -Principal $Principal -Description $Description

Write-Host "Startup task registered successfully!" -ForegroundColor Green
Write-Host "The TaskHub agent will now launch automatically in the background whenever you log into Windows." -ForegroundColor Green
Write-Host "You can also launch it manually right now or find it in the Windows Task Scheduler under the name: $TaskName" -ForegroundColor Cyan
