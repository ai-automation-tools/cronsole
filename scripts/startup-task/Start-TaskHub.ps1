<#
.SYNOPSIS
    Launches the full local TaskHub stack (data services, backend, frontend, agent).

.DESCRIPTION
    Single entry point used by the Windows Scheduled Task \Task-Hub\TaskHubAgent.
    Brings up every component in dependency order and is fully idempotent: any
    component already running is left alone, so the task can be re-run or triggered
    manually without spawning duplicates.

    Components (host-process architecture, dev mode):
      1. Docker engine  - started/awaited if not already up
      2. db + redis      - `docker compose up -d db redis`   (Postgres :5432, Redis :6379)
      3. backend         - `npm run dev`  (host)  -> http://localhost:3000
      4. frontend        - `npm run dev`  (host)  -> http://localhost:5173
      5. agent           - TaskHub.Agent.exe (host, needs Windows Task Scheduler access)

    All child output is written to <repo>\logs\*.log.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'

# --- Paths -------------------------------------------------------------------
# Resolve the repo root by walking up from this script until docker-compose.yml
# is found. Robust to where under the repo this script lives (currently
# scripts\startup-task\), so moving it doesn't break path resolution.
$RepoRoot = $PSScriptRoot
while ($RepoRoot -and -not (Test-Path (Join-Path $RepoRoot 'docker-compose.yml'))) {
    $parent = Split-Path -Parent $RepoRoot
    if ($parent -eq $RepoRoot) { break }   # reached filesystem root
    $RepoRoot = $parent
}
$BackendDir  = Join-Path $RepoRoot 'backend'
$FrontendDir = Join-Path $RepoRoot 'frontend'
$AgentExe    = Join-Path $RepoRoot 'agent\publish\TaskHub.Agent.exe'
$LogDir      = Join-Path $RepoRoot 'logs'

# Tool locations (resolved explicitly so the script works under a bare Task
# Scheduler PATH, not just an interactive shell).
$Npm          = 'C:\Program Files\nodejs\npm.cmd'
if (-not (Test-Path $Npm)) { $Npm = 'npm.cmd' }
$DockerExe    = 'D:\GDrive\Repos\Docker\resources\bin\docker.exe'
if (-not (Test-Path $DockerExe)) { $DockerExe = 'docker' }
$DockerDesktop = 'D:\GDrive\Repos\Docker\Docker Desktop.exe'

if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
$MainLog = Join-Path $LogDir 'launcher.log'

function Write-Log {
    param([string]$Message, [string]$Level = 'INFO')
    $line = "[{0}] [{1}] {2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
    Write-Host $line
    Add-Content -Path $MainLog -Value $line -Encoding UTF8
}

function Test-Listening {
    param([int]$Port)
    try { [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop) }
    catch { $false }
}

function Start-HostProcess {
    param([string]$Name, [string]$WorkDir, [string[]]$NpmArgs)
    # Launch a long-running npm process hidden, redirecting stdout/stderr to logs.
    # Start-Process on npm.cmd directly (no cmd /c) avoids nested-quote mangling.
    $out = Join-Path $LogDir "$Name.out.log"
    $err = Join-Path $LogDir "$Name.err.log"
    Start-Process -FilePath $Npm -ArgumentList $NpmArgs -WorkingDirectory $WorkDir `
        -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err | Out-Null
    Write-Log "Started $Name (logs: $out / $err)"
}

Write-Log "===== TaskHub launcher starting ====="
Write-Log "Repo root: $RepoRoot"

# --- 1. Docker engine --------------------------------------------------------
function Wait-Docker {
    param([int]$TimeoutSeconds = 120)
    & $DockerExe info *> $null
    if ($LASTEXITCODE -eq 0) { Write-Log 'Docker engine already running.'; return $true }

    if (Test-Path $DockerDesktop) {
        Write-Log 'Docker engine down - launching Docker Desktop...'
        Start-Process -FilePath $DockerDesktop -WindowStyle Hidden | Out-Null
    } else {
        Write-Log "Docker Desktop exe not found at $DockerDesktop; will keep polling engine." 'WARN'
    }

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
        Start-Sleep -Seconds 5
        & $DockerExe info *> $null
        if ($LASTEXITCODE -eq 0) {
            Write-Log ("Docker engine ready after {0:N0}s." -f $sw.Elapsed.TotalSeconds)
            return $true
        }
    }
    Write-Log "Docker engine not ready after ${TimeoutSeconds}s." 'ERROR'
    return $false
}

if (Wait-Docker) {
    Write-Log 'Bringing up data services (db, redis)...'
    $dockerLog = Join-Path $LogDir 'docker.log'
    & $DockerExe compose -f (Join-Path $RepoRoot 'docker-compose.yml') up -d db redis *> $dockerLog
    if ($LASTEXITCODE -eq 0) { Write-Log 'db + redis are up.' }
    else { Write-Log 'docker compose up for db/redis returned a non-zero exit code.' 'WARN' }
} else {
    Write-Log 'Skipping db/redis start - Docker engine unavailable. Backend will fail to reach Postgres.' 'ERROR'
}

# --- 2. Backend (:3000) ------------------------------------------------------
if (Test-Listening -Port 3000) {
    Write-Log 'Backend already listening on :3000 - skipping.'
} else {
    Start-HostProcess -Name 'backend' -WorkDir $BackendDir -NpmArgs @('run', 'dev')
}

# --- 3. Frontend (:5173) -----------------------------------------------------
if (Test-Listening -Port 5173) {
    Write-Log 'Frontend already listening on :5173 - skipping.'
} else {
    Start-HostProcess -Name 'frontend' -WorkDir $FrontendDir -NpmArgs @('run', 'dev')
}

# --- 4. Agent ----------------------------------------------------------------
if (Get-Process -Name 'TaskHub.Agent' -ErrorAction SilentlyContinue) {
    Write-Log 'Agent (TaskHub.Agent) already running - skipping.'
} elseif (Test-Path $AgentExe) {
    Start-Process -FilePath $AgentExe -WorkingDirectory (Split-Path -Parent $AgentExe) -WindowStyle Hidden | Out-Null
    Write-Log "Started agent: $AgentExe"
} else {
    Write-Log "Agent exe not found at $AgentExe" 'ERROR'
}

Write-Log "===== TaskHub launcher finished ====="
