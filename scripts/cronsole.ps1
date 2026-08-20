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
      cronsole up          Start anything that isn't already running (idempotent)
      cronsole down        Stop the backend, frontend, and agent (leaves db/redis up)
      cronsole down -All   Also stop the Docker db/redis + proxy containers
      cronsole restart     down (app tier) then up
      cronsole status      One table showing every service (default)
      cronsole logs        Tail the backend/frontend/launcher logs
      cronsole remote on   Publish the dashboard through the reverse proxy, and
                           keep it published (see Remote access below)
      cronsole remote off  Stop publishing it
      cronsole remote      Say whether this machine publishes it

    REMOTE ACCESS

    The single-origin reverse proxy (docker compose profile `proxy`, listening on
    127.0.0.1:8080) is deliberately opt-in: a plain `docker compose up -d` does not
    start it, and neither did `up` until this machine said it wanted it. Saying so
    is `cronsole remote on`, which records the choice in `.cronsole-remote` at the
    repo root - per-machine and gitignored, because whether a machine publishes its
    dashboard is a property of the machine, not of the checkout.

    Once recorded, `up` starts the proxy alongside db and redis, which is what makes
    it SURVIVE. The container carries `restart: unless-stopped`, so it comes back on
    its own after a reboot or a Docker restart - but NOT after an explicit
    `docker compose stop`, which is Docker working as designed and how the tailnet
    URL went dark for two days with every other service healthy. `up` is idempotent
    and the \Cronsole-Stack\CronsoleStack task re-runs it every 5 minutes, so an
    explicit stop now self-heals within one interval instead of lasting until
    somebody notices (troubleshooting #70).

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
    [ValidateSet('up', 'down', 'restart', 'status', 'logs', 'remote')]
    [string]$Command = 'status',

    # Only meaningful for `remote`. Defaults to reporting rather than changing:
    # a bare `cronsole remote` should never turn remote access on by accident.
    [Parameter(Position = 1)]
    [ValidateSet('on', 'off', 'status')]
    [string]$Mode = 'status',

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
$DistDir     = Join-Path $FrontendDir 'dist'

# Per-machine opt-in for the reverse proxy. A FILE rather than an environment
# variable because the reader is a Scheduled Task: it runs with a bare environment
# that never sees anything exported in a terminal, and an opt-in the self-heal
# cannot see is not an opt-in. Gitignored - see .gitignore.
$RemoteMarker = Join-Path $RepoRoot '.cronsole-remote'
$ProxyPort    = 8080

function Test-RemoteEnabled { Test-Path $RemoteMarker }

# The agent exe was renamed TaskHub.Agent -> Cronsole.Agent on 2026-07-31. A process
# that STARTED before that rename is still named TaskHub.Agent, and it holds every
# handle and Task Scheduler connection a Cronsole.Agent would - so looking only for
# the new name is how "agent already stopped" gets printed at a running agent, and
# how a folder rename then fails on a handle nothing admits to holding. We only ever
# start the new name; the legacy entry exists solely to be FOUND and stopped.
$AgentProcNames = @('Cronsole.Agent', 'TaskHub.Agent')

function Get-AgentProcess {
    Get-Process -Name $AgentProcNames -ErrorAction SilentlyContinue
}

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

function Get-ProxyProbe {
    # Ask the proxy for a PAGE, not for the port. Caddy answers on :8080 whether or
    # not /srv has anything in it, so a bare port check would report UP at a proxy
    # serving 404 to every phone on the tailnet - the frontend/dist staleness trap
    # (troubleshooting #53) one step worse, because dist can be absent entirely.
    $code = Get-HttpStatus ("http://127.0.0.1:{0}/" -f $ProxyPort)
    if ($code -ge 200 -and $code -lt 400) {
        if (-not (Test-Path (Join-Path $DistDir 'index.html'))) {
            return New-Probe 'WARN' "GET / -> $code" 'serving, but frontend\dist has no index.html - run: npm run build:remote'
        }
        return New-Probe 'UP' "GET / -> $code"
    }
    if ($code -gt 0) { return New-Probe 'WARN' "GET / -> $code" 'the proxy answers but not with a page - is frontend\dist built? (npm run build:remote)' }
    if (Test-PortBound $ProxyPort) {
        return New-Probe 'WARN' ":$ProxyPort bound, no HTTP answer" 'something holds the port while the proxy behind it is dead'
    }
    return New-Probe 'DOWN' "nothing on :$ProxyPort" 'run: cronsole up' $false
}

function Get-AgentProbe {
    # The agent binds nothing - it dials OUT - so the process is the only signal
    # available locally. Whether it is CONNECTED is a different question, and only
    # the app can answer it; say so rather than let "process running" read as "paired".
    $p = Get-AgentProcess | Select-Object -First 1
    if ($p) {
        # Say WHICH binary is running. A legacy-named process is a real agent doing real
        # work, so it is honestly UP - but it predates the rename, which means it is also
        # running code older than anything in the checkout. Reporting a bare "UP" would
        # hide the staler of the two facts.
        if ($p.ProcessName -eq 'Cronsole.Agent') {
            return New-Probe 'UP' 'process Cronsole.Agent running' 'process only - connection state is visible in the app sidebar, not here'
        }
        return New-Probe 'WARN' ("process {0} running (pre-rename binary, pid {1})" -f $p.ProcessName, $p.Id) `
            'this agent started before the Cronsole rename, so it is running stale code - republish: scripts\Republish-Agent.ps1'
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

# Stop-Port kills whatever owns the LISTENING SOCKET. Under `npm run dev` that is the
# innermost node; `tsx watch` and its cmd.exe wrapper are its ANCESTORS, so they survive
# with a working-directory handle still open inside backend\ or frontend\. Nothing here
# notices, and nothing should: the port really is free and the service really is stopped.
# The cost lands somewhere else entirely - a surviving watcher is what makes a later
# rename of the checkout fail with "Access to the path is denied", an error that blames
# the folder instead of the process still sitting in it (Migrate-RepoFolder.ps1).
#
# Match on the repo path in the command line, and only for node.exe/cmd.exe. A process
# whose CWD merely happens to be the repo - an editor, a terminal, an AI agent - holds
# the same kind of handle but is not ours to kill, and its command line does not name us.
function Stop-DevServerTree {
    $dirs  = @($BackendDir, $FrontendDir)
    $stale = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $proc = $_
        $proc.ProcessId -ne $PID -and
        $proc.Name -in @('node.exe', 'cmd.exe') -and
        $proc.CommandLine -and
        ($dirs | Where-Object { $proc.CommandLine.IndexOf($_, [StringComparison]::OrdinalIgnoreCase) -ge 0 })
    })
    foreach ($p in $stale) {
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
        Write-Host "  stopped leftover watcher (pid $($p.ProcessId), $($p.Name))"
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

    # The proxy is a row only on a machine that opted in. On every other machine
    # there is nothing to measure, and a check with nothing to measure is omitted -
    # rendering it as DOWN would put a permanent red line under a stack that is
    # completely healthy, and rendering it as UP would be a lie.
    if (Test-RemoteEnabled) {
        $rows += [pscustomobject]@{ Service = "Proxy :$ProxyPort"; Where = 'docker'; Probe = (Get-ProxyProbe) }
    }

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
    # Ask for the PROCESS, not the probe state: a legacy-named agent probes WARN, and
    # branching on 'UP' would start a second agent alongside it. Two agents on one
    # machine both answer task:run.
    $running = Get-AgentProcess | Select-Object -First 1
    if ($running) {
        Write-Host ("  agent already up ({0}, pid {1})" -f $running.ProcessName, $running.Id)
        if ($running.ProcessName -ne 'Cronsole.Agent') {
            Write-Host '  WARNING: that is the pre-rename binary - it is running stale code.' -ForegroundColor Yellow
            Write-Host '           republish to swap it: scripts\Republish-Agent.ps1' -ForegroundColor Yellow
        }
    } elseif (Test-Path $AgentExe) {
        Start-Process -FilePath $AgentExe -WorkingDirectory (Split-Path -Parent $AgentExe) -WindowStyle Hidden | Out-Null
        Write-Host '  started agent'
    } else {
        Write-Host "  WARNING: agent exe not found at $AgentExe (publish it first)" -ForegroundColor Yellow
    }

    # 5. Reverse proxy - only where this machine asked for it (`cronsole remote on`).
    # This step is the whole reason remote access is durable. `restart: unless-stopped`
    # survives reboots but NOT an explicit `docker compose stop`, so without a starter
    # that runs on a schedule the proxy stays down until a human notices the tailnet
    # URL is dead - which took two days (troubleshooting #70).
    if (Test-RemoteEnabled) { Start-Proxy }

    Start-Sleep -Seconds 2
    Invoke-Status
}

function Start-Proxy {
    $proxy = Get-ProxyProbe
    if ($proxy.State -eq 'UP') { Write-Host "  proxy already up ($($proxy.Signal))"; return }

    # Name the profile AND the service. The service carries `profiles:`, so a bare
    # `up -d proxy` is silently a no-op on compose versions that do not auto-enable
    # a named service's profile - a no-op that prints success is the failure mode
    # this whole change exists to remove.
    & $Docker compose -f $Compose --profile proxy up -d proxy 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host '  WARNING: docker compose up for the proxy failed - is Docker running?' -ForegroundColor Yellow
        return
    }
    Write-Host "  proxy up (docker, 127.0.0.1:$ProxyPort)"

    if (-not (Test-Path (Join-Path $DistDir 'index.html'))) {
        Write-Host '  WARNING: frontend\dist has no index.html - the proxy will serve 404 to every' -ForegroundColor Yellow
        Write-Host '           remote device. Build it:  cd frontend; npm run build:remote' -ForegroundColor Yellow
    }
}

function Invoke-Down {
    Write-Host 'Stopping the Cronsole app tier...'
    $agents = @(Get-AgentProcess)
    if ($agents.Count -gt 0) {
        foreach ($a in $agents) {
            Stop-Process -Id $a.Id -Force -ErrorAction SilentlyContinue
            Write-Host ("  stopped agent ({0}, pid {1})" -f $a.ProcessName, $a.Id)
        }
        # Confirm rather than assume. The agent runs at RunLevel Highest, so an
        # unelevated `down` gets Access Denied from Stop-Process and -SilentlyContinue
        # swallows it - which prints "stopped agent" at an agent that is still running.
        Start-Sleep -Milliseconds 500
        $left = @(Get-AgentProcess)
        if ($left.Count -gt 0) {
            Write-Host ("  WARNING: agent still running (pid {0}) - Stop-Process was refused." -f ($left.Id -join ', ')) -ForegroundColor Yellow
            Write-Host '           it runs elevated; re-run this from an Administrator prompt.' -ForegroundColor Yellow
        }
    } else { Write-Host '  agent already stopped' }
    Stop-Port 3000 'backend'
    Stop-Port 7373 'frontend'
    Stop-DevServerTree

    if ($All) {
        Write-Host 'Stopping data services (docker)...'
        & $Docker compose -f $Compose stop db redis 2>&1 | Out-Null
        Write-Host '  db + redis stopped'
        if (Test-RemoteEnabled) {
            & $Docker compose -f $Compose stop proxy 2>&1 | Out-Null
            Write-Host '  proxy stopped'
            # Deliberately does NOT clear the marker. `down -All` is "stop things now",
            # not "stop publishing this machine" - and the next `up`, including the
            # 5-minute one, is meant to bring the proxy back. Use `cronsole remote off`
            # to actually revoke the opt-in.
            Write-Host '  (still opted in - the next "cronsole up" restarts it; "cronsole remote off" to opt out)'
        }
    } else {
        Write-Host '  (db/redis left running - use "-All" to stop them too)'
    }
}

function Invoke-Remote {
    switch ($Mode) {
        'on' {
            if (Test-RemoteEnabled) {
                Write-Host 'Remote access is already on for this machine.'
            } else {
                # Content is for the human who finds this file, not for the script -
                # Test-Path is the whole read. Timestamped so "when did this machine
                # start publishing?" has an answer.
                Set-Content -Path $RemoteMarker -Encoding ASCII -Value @(
                    '# Cronsole: this machine publishes its dashboard through the reverse proxy.',
                    '# Created by: cronsole remote on',
                    ('# On: {0}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')),
                    '#',
                    '# Presence of this file is the whole signal. `cronsole up` reads it and starts',
                    '# the docker compose `proxy` service; delete it (or run `cronsole remote off`)',
                    '# and `up` leaves the proxy alone. Per-machine and gitignored on purpose.'
                )
                Write-Host 'Remote access ON for this machine.' -ForegroundColor Green
                Write-Host "  marker: $RemoteMarker"
            }
            Start-Proxy
            Write-Host ''
            Write-Host 'The proxy is loopback-only by design. To reach it from another device you'
            Write-Host 'still need a tunnel in front of it - see docs\user-guides\guides\Remote_Access_Guide.md'
            Write-Host '  Tailscale:  tailscale serve --bg --http=8080 http://127.0.0.1:8080'
        }
        'off' {
            if (Test-RemoteEnabled) {
                Remove-Item $RemoteMarker -Force -ErrorAction SilentlyContinue
                Write-Host 'Remote access OFF for this machine.' -ForegroundColor Yellow
            } else {
                Write-Host 'Remote access is already off for this machine.'
            }
            & $Docker compose -f $Compose stop proxy 2>&1 | Out-Null
            Write-Host '  proxy stopped'
            Write-Host ''
            Write-Host 'The tunnel in front of it is separate and is STILL PUBLISHED. Stop it too,'
            Write-Host 'or the tailnet URL stays live and answers 502:'
            Write-Host '  tailscale serve --https=443 off   (or: tailscale serve reset)'
        }
        default {
            if (Test-RemoteEnabled) {
                $proxy = Get-ProxyProbe
                Write-Host 'Remote access: ON for this machine.' -ForegroundColor Green
                Write-Host "  marker: $RemoteMarker"
                Write-Host ("  proxy : {0} ({1})" -f $proxy.State, $proxy.Signal)
                if ($proxy.Hint) { Write-Host "          $($proxy.Hint)" -ForegroundColor DarkGray }
            } else {
                Write-Host 'Remote access: OFF for this machine.'
                Write-Host '  turn it on with:  cronsole remote on'
            }
        }
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
    'remote'  { Invoke-Remote }
}
