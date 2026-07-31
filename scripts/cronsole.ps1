<#
.SYNOPSIS
    Single control surface for the local Cronsole stack: bring it up, take it down,
    restart it, or see one combined status for every service.

.DESCRIPTION
    The local stack is five pieces: Postgres + Redis (Docker), the backend and
    frontend dev servers (host Node processes), and the Windows agent (host .exe,
    which needs Task Scheduler access so it can't be containerized). This script
    is the one place to control and inspect all of them, so you stop wondering
    "which part is down?".

    Usage:
      cronsole up        Start anything that isn't already running (idempotent)
      cronsole down      Stop the backend, frontend, and agent (leaves db/redis up)
      cronsole down -All Also stop the Docker db/redis containers
      cronsole restart   down (app tier) then up
      cronsole status    One table showing every service (default)
      cronsole logs      Tail the backend/frontend/launcher logs

    Every service is probed by asking the SERVICE, not by checking whether its port
    is bound - /api/health for the backend, an HTTP GET for the frontend, pg_isready
    for Postgres, a RESP PING for Redis. The port is corroboration only. `status`
    prints the signal it used next to each row, and reports WARN (never a confident
    UP or DOWN) when something is clearly present but cannot be confirmed serving.
    See the Probes section below for why this matters in both directions.

    Run it from anywhere:  pwsh <repo>\scripts\cronsole.ps1 status
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
$AgentExe    = Join-Path $RepoRoot 'agent\publish\Cronsole.Agent.exe'
$LogDir      = Join-Path $RepoRoot 'logs'
$Compose     = Join-Path $RepoRoot 'docker-compose.yml'

$Npm = 'C:\Program Files\nodejs\npm.cmd'
if (-not (Test-Path $Npm)) { $Npm = 'npm.cmd' }
$Docker = 'D:\GDrive\Repos\Docker\resources\bin\docker.exe'
if (-not (Test-Path $Docker)) { $Docker = 'docker' }

if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }

# --- Probes ------------------------------------------------------------------
# A PORT IS NOT A SERVICE. This script has been wrong in both directions from that
# one mistake, and a control surface that is wrong in both directions is worse than
# no control surface, because it is consulted first and believed:
#
#   * false POSITIVE - a dead container's proxy still held :3000, so `Test-Port`
#     reported "backend already up" and `up` refused to start the real one. That is
#     the 12-minute outage in troubleshooting #23.
#   * false NEGATIVE - `status` called Postgres, Redis, backend and frontend all
#     DOWN while /api/health returned 200 and the frontend served 200. The listener
#     table needs the NetTCPIP CIM provider and the container checks need a working
#     docker CLI; when either is unavailable the probe fails, and "the probe failed"
#     was being rendered as "the service is down".
#
# So: every probe asks the SERVICE (HTTP, pg_isready, RESP PING), names the signal
# it used, and treats the port only as corroboration. Where something is clearly
# present but cannot be confirmed to be serving, the answer is WARN - never a
# confident UP or DOWN.

# State is one of 'UP' | 'WARN' | 'DOWN'. Present = "something is there at all",
# which tells a wait loop to keep waiting rather than give up. Verifiable = $false
# means the probe could not be run at all (no docker CLI, no CIM provider) - waiting
# cannot change that answer, so a wait loop must stop instead of burning its timeout.
function New-Probe([string]$State, [string]$Signal, [string]$Hint = '', [bool]$Present = $true, [bool]$Verifiable = $true) {
    [pscustomobject]@{ State = $State; Signal = $Signal; Hint = $Hint; Present = $Present; Verifiable = $Verifiable }
}

function Test-Listener([int]$Port) {
    # The Windows listener table. Needs the NetTCPIP CIM provider, which is not
    # available in every shell or sandbox - a failure here means UNKNOWN, not down,
    # which is exactly why it must never be the only signal.
    try { [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop) } catch { $false }
}

function Test-TcpConnect([int]$Port, [int]$TimeoutMs = 800) {
    # Does anything actually accept a connection? Proves more than the listener
    # table does, and works without the CIM provider.
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $async = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne($TimeoutMs)) { return $false }
        $client.EndConnect($async)
        return $true
    } catch { return $false } finally { $client.Dispose() }
}

function Test-PortBound([int]$Port) { (Test-TcpConnect $Port) -or (Test-Listener $Port) }

function Get-HttpStatus([string]$Url, [int]$TimeoutSec = 3) {
    # The status code, or 0 when nothing answered. A 4xx/5xx still proves something
    # is serving, which is a different problem from "nothing is there".
    try { [int](Invoke-WebRequest $Url -UseBasicParsing -TimeoutSec $TimeoutSec).StatusCode }
    catch {
        $resp = $_.Exception.Response
        if ($resp -and $resp.StatusCode) { return [int]$resp.StatusCode }
        return 0
    }
}

function Test-RedisPing([int]$Port = 6379, [int]$TimeoutMs = 800) {
    # Speak RESP directly, because a port that accepts a connection is not a Redis.
    # Doing it over the socket rather than `docker exec redis-cli` also keeps the
    # probe working when the docker CLI is the thing that is broken.
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $async = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne($TimeoutMs)) { return $false }
        $client.EndConnect($async)
        $stream = $client.GetStream()
        $stream.ReadTimeout = $TimeoutMs
        $ping = [Text.Encoding]::ASCII.GetBytes("PING`r`n")
        $stream.Write($ping, 0, $ping.Length)
        $buf = New-Object byte[] 16
        $read = $stream.Read($buf, 0, $buf.Length)
        return ([Text.Encoding]::ASCII.GetString($buf, 0, $read) -match 'PONG')
    } catch { return $false } finally { $client.Dispose() }
}

$script:DockerOk = $null
function Test-DockerCli {
    # Cached: every docker call costs ~200ms, and `status` would otherwise make five.
    if ($null -ne $script:DockerOk) { return $script:DockerOk }
    try { & $Docker version --format '{{.Server.Version}}' *> $null; $script:DockerOk = ($LASTEXITCODE -eq 0) }
    catch { $script:DockerOk = $false }
    return $script:DockerOk
}

function Get-DbProbe {
    # Readiness, not existence: after an unclean shutdown Postgres accepts TCP while
    # refusing every query with "the database system is starting up" (#23).
    if (Test-DockerCli) {
        $cid = & $Docker compose -f $Compose ps -q db 2>$null | Select-Object -First 1
        if ($cid) {
            $health = & $Docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' $cid 2>$null
            if ($health -eq 'healthy') { return New-Probe 'UP' 'docker healthcheck: healthy' }
            if ($health -and $health -ne 'none') {
                return New-Probe 'WARN' "docker healthcheck: $health" 'container is up but Postgres is not accepting connections yet'
            }
        }
        # Compose file predates the healthcheck (or no container) - ask Postgres itself.
        & $Docker compose -f $Compose exec -T db pg_isready -U cronsole -d cronsole *> $null
        if ($LASTEXITCODE -eq 0) { return New-Probe 'UP' 'pg_isready' }
    }
    if (Test-PortBound 5432) {
        return New-Probe 'WARN' ':5432 accepts connections, readiness unverified' `
            'a Postgres is reachable but pg_isready could not run (docker CLI unavailable?)' $true $false
    }
    return New-Probe 'DOWN' 'nothing on :5432' 'run: cronsole up' $false
}

function Get-RedisProbe {
    if (Test-RedisPing) { return New-Probe 'UP' 'RESP PING -> PONG' }
    if (Test-PortBound 6379) {
        return New-Probe 'WARN' ':6379 bound, PING unanswered' 'something holds the port but it is not answering as Redis'
    }
    return New-Probe 'DOWN' 'nothing on :6379' 'run: cronsole up' $false
}

function Get-BackendProbe {
    $code = Get-HttpStatus 'http://localhost:3000/api/health'
    if ($code -eq 200) { return New-Probe 'UP' 'GET /api/health -> 200' }
    if ($code -gt 0) { return New-Probe 'WARN' "GET /api/health -> $code" 'the API answers but is unhealthy - see logs\backend.err.log' }
    if (Test-PortBound 3000) {
        return New-Probe 'WARN' ':3000 bound, no HTTP answer' 'something holds the port while the app behind it is dead'
    }
    return New-Probe 'DOWN' 'nothing on :3000' 'run: cronsole up' $false
}

function Get-FrontendProbe {
    $code = Get-HttpStatus 'http://localhost:7373/'
    if ($code -ge 200 -and $code -lt 400) { return New-Probe 'UP' "GET / -> $code" }
    if ($code -gt 0) { return New-Probe 'WARN' "GET / -> $code" 'the dev server answers but not with a page' }
    if (Test-PortBound 7373) {
        return New-Probe 'WARN' ':7373 bound, no HTTP answer' 'a dead dev server or a stale container proxy holds the port'
    }
    return New-Probe 'DOWN' 'nothing on :7373' 'run: cronsole up' $false
}

function Get-AgentProbe {
    # The agent binds nothing - it dials OUT - so the process is the only signal
    # available locally. Whether it is CONNECTED is a different question, and only
    # the app can answer it; say so rather than let "process running" read as "paired".
    if (Get-Process -Name 'Cronsole.Agent' -ErrorAction SilentlyContinue) {
        return New-Probe 'UP' 'process Cronsole.Agent running' 'process only - connection state is visible in the app sidebar, not here'
    }
    return New-Probe 'DOWN' 'no Cronsole.Agent process' 'publish + start it, or run: cronsole up' $false
}

function Stop-Port([int]$Port, [string]$Label) {
    $conn = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) {
        Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
        Write-Host "  stopped $Label (pid $($conn.OwningProcess))"
    } elseif (Test-TcpConnect $Port) {
        # No host process owns it, yet something still accepts connections - usually a
        # container's port proxy, which Stop-Process cannot reach. Reporting "already
        # stopped" here would be the same lie pointing the other way.
        Write-Host "  WARNING: :$Port still accepts connections but no host process owns it" -ForegroundColor Yellow
        Write-Host '           (a container port proxy?) try:  docker compose stop backend frontend' -ForegroundColor Yellow
    } else {
        Write-Host "  $Label already stopped"
    }
}

# --- Commands ----------------------------------------------------------------
function Invoke-Status {
    $rows = @(
        [pscustomobject]@{ Service = 'Postgres (db)';  Where = 'docker'; Probe = (Get-DbProbe) }
        [pscustomobject]@{ Service = 'Redis';          Where = 'docker'; Probe = (Get-RedisProbe) }
        [pscustomobject]@{ Service = 'Backend :3000';  Where = 'host';   Probe = (Get-BackendProbe) }
        [pscustomobject]@{ Service = 'Frontend :7373'; Where = 'host';   Probe = (Get-FrontendProbe) }
        [pscustomobject]@{ Service = 'Windows agent';  Where = 'host';   Probe = (Get-AgentProbe) }
    )

    Write-Host ''
    Write-Host '  Cronsole stack' -ForegroundColor Cyan
    Write-Host '  -------------'
    foreach ($r in $rows) {
        switch ($r.Probe.State) {
            'UP'   { $mark = '[ UP ]'; $color = 'Green' }
            'WARN' { $mark = '[WARN]'; $color = 'Yellow' }
            default { $mark = '[DOWN]'; $color = 'Red' }
        }
        # Always print the signal. "Backend UP" is a claim; "GET /api/health -> 200"
        # is the evidence for it, and the evidence is what you need when it is wrong.
        Write-Host ('  {0}  {1,-15} {2,-7} {3}' -f $mark, $r.Service, $r.Where, $r.Probe.Signal) -ForegroundColor $color
    }

    $notes = $rows | Where-Object { $_.Probe.Hint -and $_.Probe.State -ne 'DOWN' }
    if ($notes) {
        Write-Host ''
        foreach ($n in $notes) {
            Write-Host ('     {0}: {1}' -f $n.Service, $n.Probe.Hint) -ForegroundColor DarkGray
        }
    }

    # The one combination that looks fine and isn't: something holds :3000 but nothing
    # answers. Docker's port proxy keeps the port bound after the app inside it crashed,
    # so a port check reads as UP while every request dies (troubleshooting #23/#3).
    # Say it out loud - this is precisely the state that hid a 12-minute outage.
    $backend = ($rows | Where-Object Service -eq 'Backend :3000').Probe
    if ($backend.State -eq 'WARN' -and $backend.Signal -like '*bound*') {
        Write-Host ''
        Write-Host '  !! :3000 is bound but /api/health does not answer.' -ForegroundColor Red
        Write-Host '     Something holds the port while the app behind it is dead -' -ForegroundColor Red
        Write-Host '     usually a crashed backend CONTAINER (its proxy keeps the port).' -ForegroundColor Red
        Write-Host '     Check:  docker logs taskhub-backend-1' -ForegroundColor Red
        Write-Host '     This stack runs the backend on the HOST; the container should' -ForegroundColor Red
        Write-Host '     not be running at all:  docker compose stop backend frontend' -ForegroundColor Red
    }

    $upCount   = ($rows | Where-Object { $_.Probe.State -eq 'UP' }).Count
    $warnCount = ($rows | Where-Object { $_.Probe.State -eq 'WARN' }).Count
    Write-Host ''
    if ($upCount -eq $rows.Count) {
        Write-Host '  => ALL UP' -ForegroundColor Green
    } elseif ($warnCount -gt 0) {
        Write-Host "  => DEGRADED ($upCount/$($rows.Count) confirmed serving, $warnCount unconfirmed)" -ForegroundColor Yellow
    } elseif ($upCount -eq 0) {
        Write-Host '  => DOWN' -ForegroundColor Red
    } else {
        Write-Host "  => PARTIAL ($upCount/$($rows.Count) services) - run: cronsole up" -ForegroundColor Yellow
    }
    Write-Host ''
}

function Wait-Db([int]$TimeoutSec = 90) {
    # `compose up -d` returns when the CONTAINER has started, NOT when Postgres will
    # answer a query - and after an unclean shutdown Postgres spends seconds in crash
    # recovery refusing every connection. The backend's boot seed queries immediately
    # and dies on that refusal, leaving nothing on :3000 (troubleshooting #23).
    # So gate on readiness, not existence - which is exactly what Get-DbProbe means
    # by UP, so this loop just waits for it rather than re-deriving readiness here.
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $probe = Get-DbProbe
        if ($probe.State -eq 'UP') { Write-Host "  db ready ($($probe.Signal))"; return $true }
        if (-not $probe.Present) {
            Write-Host '  WARNING: no db found on :5432 - starting backend anyway' -ForegroundColor Yellow
            return $false
        }
        if (-not $probe.Verifiable) {
            # A Postgres is answering the port but we cannot ask it whether it is
            # ready. Waiting will not change that, so say so and move on.
            Write-Host "  WARNING: db reachable but readiness unverifiable ($($probe.Signal)) - starting backend anyway" -ForegroundColor Yellow
            return $false
        }
        Start-Sleep -Seconds 1
    }
    Write-Host "  WARNING: db not ready after ${TimeoutSec}s - starting backend anyway" -ForegroundColor Yellow
    return $false
}

function Start-HostService([string]$Name, [string]$WorkDir) {
    $out = Join-Path $LogDir "$Name.out.log"
    $err = Join-Path $LogDir "$Name.err.log"
    Start-Process -FilePath $Npm -ArgumentList @('run', 'dev') -WorkingDirectory $WorkDir `
        -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err | Out-Null
    Write-Host "  started $Name (logs: $LogDir\$Name.*.log)"
}

function Invoke-Up {
    Write-Host 'Bringing the Cronsole stack up...'

    # 1. Data services (Docker). restart: unless-stopped keeps them self-healing.
    & $Docker compose -f $Compose up -d db redis 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Host '  db + redis up (docker)' }
    else { Write-Host '  WARNING: docker compose up for db/redis failed - is Docker running?' -ForegroundColor Yellow }

    # 2. Backend - only once Postgres will actually answer (see Wait-Db).
    # The gate asks /api/health, not the port: "the port is taken" was read as
    # "the backend is already up" while a dead container's proxy held it, and this
    # function then refused to start the real one for 12 minutes (#23).
    $backend = Get-BackendProbe
    if ($backend.State -eq 'UP') {
        Write-Host "  backend already up ($($backend.Signal))"
    } elseif ($backend.Present) {
        # Something holds :3000. Starting a second backend would only fail to bind
        # and leave you debugging the wrong process, so name the holder instead.
        Write-Host "  ERROR: :3000 is held but the backend does not answer ($($backend.Signal))" -ForegroundColor Red
        Write-Host '         Clear it first:  docker compose stop backend frontend' -ForegroundColor Red
        Write-Host '         or stop the holder:  cronsole down' -ForegroundColor Red
    } else {
        Wait-Db | Out-Null
        Start-HostService 'backend' $BackendDir
    }

    # 3. Frontend - same rule.
    $frontend = Get-FrontendProbe
    if ($frontend.State -eq 'UP') {
        Write-Host "  frontend already up ($($frontend.Signal))"
    } elseif ($frontend.Present) {
        Write-Host "  ERROR: :7373 is held but the frontend does not answer ($($frontend.Signal))" -ForegroundColor Red
        Write-Host '         Clear it first:  cronsole down' -ForegroundColor Red
    } else {
        Start-HostService 'frontend' $FrontendDir
    }

    # 4. Agent (host .exe - needs Task Scheduler access)
    if ((Get-AgentProbe).State -eq 'UP') {
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
    Write-Host 'Stopping the Cronsole app tier...'
    if ((Get-AgentProbe).State -eq 'UP') {
        Stop-Process -Name 'Cronsole.Agent' -Force -ErrorAction SilentlyContinue
        Write-Host '  stopped agent'
    } else { Write-Host '  agent already stopped' }
    Stop-Port 3000 'backend'
    Stop-Port 7373 'frontend'

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
