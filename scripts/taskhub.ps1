<#
.SYNOPSIS
    Single control surface for the local TaskHub stack: bring it up, take it down,
    restart it, or see one combined status for every service.

.DESCRIPTION
    The local stack is five pieces: Postgres + Redis (Docker), the backend and
    frontend dev servers (host Node processes), and the Windows agent (host .exe,
    which needs Task Scheduler access so it can't be containerized). This script
    is the one place to control and inspect all of them, so you stop wondering
    "which part is down?".

    Usage:
      taskhub up        Start anything that isn't already running (idempotent)
      taskhub down      Stop the backend, frontend, and agent (leaves db/redis up)
      taskhub down -All Also stop the Docker db/redis containers
      taskhub restart   down (app tier) then up
      taskhub status    One table showing every service + a health check (default)
      taskhub logs      Tail the backend/frontend/launcher logs

    Run it from anywhere:  pwsh <repo>\scripts\taskhub.ps1 status
#>

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('up', 'down', 'restart', 'status', 'logs')]
    [string]$Command = 'status',

    [switch]$All
)

$ErrorActionPreference = 'Continue'

# --- Paths & tools -----------------------------------------------------------
$RepoRoot    = Split-Path -Parent (Split-Path -Parent $PSCommandPath)  # scripts\ -> repo
$BackendDir  = Join-Path $RepoRoot 'backend'
$FrontendDir = Join-Path $RepoRoot 'frontend'
$AgentExe    = Join-Path $RepoRoot 'agent\publish\TaskHub.Agent.exe'
$LogDir      = Join-Path $RepoRoot 'logs'
$Compose     = Join-Path $RepoRoot 'docker-compose.yml'

$Npm = 'C:\Program Files\nodejs\npm.cmd'
if (-not (Test-Path $Npm)) { $Npm = 'npm.cmd' }
$Docker = 'D:\GDrive\Repos\Docker\resources\bin\docker.exe'
if (-not (Test-Path $Docker)) { $Docker = 'docker' }

if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }

# --- Probes ------------------------------------------------------------------
function Test-Port([int]$Port) {
    try { [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop) } catch { $false }
}
function Test-Health {
    try { (Invoke-WebRequest 'http://localhost:3000/api/health' -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 }
    catch { $false }
}
function Test-Container([string]$Name) {
    $out = & $Docker ps --filter "name=taskhub-$Name" --format '{{.Names}}' 2>$null
    [bool]($out -match "taskhub-$Name")
}
function Test-Agent { [bool](Get-Process -Name 'TaskHub.Agent' -ErrorAction SilentlyContinue) }

function Stop-Port([int]$Port, [string]$Label) {
    $conn = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) {
        Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
        Write-Host "  stopped $Label (pid $($conn.OwningProcess))"
    } else {
        Write-Host "  $Label already stopped"
    }
}

# --- Commands ----------------------------------------------------------------
function Invoke-Status {
    $rows = @(
        [pscustomobject]@{ Service = 'Postgres (db)';   Where = 'docker'; Up = (Test-Container 'db') }
        [pscustomobject]@{ Service = 'Redis';           Where = 'docker'; Up = (Test-Container 'redis') }
        [pscustomobject]@{ Service = 'Backend :3000';   Where = 'host';   Up = (Test-Port 3000) }
        [pscustomobject]@{ Service = 'Frontend :5173';  Where = 'host';   Up = (Test-Port 5173) }
        [pscustomobject]@{ Service = 'Windows agent';   Where = 'host';   Up = (Test-Agent) }
    )
    $health = Test-Health

    Write-Host ''
    Write-Host '  TaskHub stack' -ForegroundColor Cyan
    Write-Host '  -------------'
    foreach ($r in $rows) {
        $mark  = if ($r.Up) { '[ UP ]' } else { '[DOWN]' }
        $color = if ($r.Up) { 'Green' } else { 'Red' }
        Write-Host ('  {0}  {1,-16} ({2})' -f $mark, $r.Service, $r.Where) -ForegroundColor $color
    }
    $hmark  = if ($health) { '[ OK ]' } else { '[FAIL]' }
    $hcolor = if ($health) { 'Green' } else { 'Red' }
    Write-Host ('  {0}  {1}' -f $hmark, 'API /health') -ForegroundColor $hcolor

    $upCount = ($rows | Where-Object Up).Count
    Write-Host ''
    if ($upCount -eq $rows.Count -and $health) {
        Write-Host '  => ALL UP' -ForegroundColor Green
    } elseif ($upCount -eq 0) {
        Write-Host '  => DOWN' -ForegroundColor Red
    } else {
        Write-Host "  => PARTIAL ($upCount/$($rows.Count) services) - run: taskhub up" -ForegroundColor Yellow
    }
    Write-Host ''
}

function Start-HostService([string]$Name, [string]$WorkDir) {
    $out = Join-Path $LogDir "$Name.out.log"
    $err = Join-Path $LogDir "$Name.err.log"
    Start-Process -FilePath $Npm -ArgumentList @('run', 'dev') -WorkingDirectory $WorkDir `
        -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err | Out-Null
    Write-Host "  started $Name (logs: $LogDir\$Name.*.log)"
}

function Invoke-Up {
    Write-Host 'Bringing the TaskHub stack up...'

    # 1. Data services (Docker). restart: unless-stopped keeps them self-healing.
    & $Docker compose -f $Compose up -d db redis 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Host '  db + redis up (docker)' }
    else { Write-Host '  WARNING: docker compose up for db/redis failed - is Docker running?' -ForegroundColor Yellow }

    # 2. Backend
    if (Test-Port 3000) { Write-Host '  backend already up' } else { Start-HostService 'backend' $BackendDir }

    # 3. Frontend
    if (Test-Port 5173) { Write-Host '  frontend already up' } else { Start-HostService 'frontend' $FrontendDir }

    # 4. Agent (host .exe - needs Task Scheduler access)
    if (Test-Agent) {
        Write-Host '  agent already up'
    } elseif (Test-Path $AgentExe) {
        Start-Process -FilePath $AgentExe -WorkingDirectory (Split-Path -Parent $AgentExe) -WindowStyle Hidden | Out-Null
        Write-Host '  started agent'
    } else {
        Write-Host "  WARNING: agent exe not found at $AgentExe (publish it first)" -ForegroundColor Yellow
    }

    Start-Sleep -Seconds 2
    Invoke-Status
}

function Invoke-Down {
    Write-Host 'Stopping the TaskHub app tier...'
    if (Test-Agent) {
        Stop-Process -Name 'TaskHub.Agent' -Force -ErrorAction SilentlyContinue
        Write-Host '  stopped agent'
    } else { Write-Host '  agent already stopped' }
    Stop-Port 3000 'backend'
    Stop-Port 5173 'frontend'

    if ($All) {
        Write-Host 'Stopping data services (docker)...'
        & $Docker compose -f $Compose stop db redis 2>&1 | Out-Null
        Write-Host '  db + redis stopped'
    } else {
        Write-Host '  (db/redis left running - use "-All" to stop them too)'
    }
}

function Invoke-Logs {
    $files = Get-ChildItem $LogDir -Filter '*.log' -ErrorAction SilentlyContinue
    if (-not $files) { Write-Host "No logs in $LogDir yet."; return }
    Write-Host "Tailing $LogDir\*.log (Ctrl+C to stop)..." -ForegroundColor Cyan
    Get-Content ($files.FullName) -Tail 20 -Wait
}

# --- Dispatch ----------------------------------------------------------------
switch ($Command) {
    'up'      { Invoke-Up }
    'down'    { Invoke-Down }
    'restart' { Invoke-Down; Start-Sleep -Seconds 2; Invoke-Up }
    'status'  { Invoke-Status }
    'logs'    { Invoke-Logs }
}
