<#
.SYNOPSIS
    Single control surface for the local Cronsole stack: bring it up, take it down,
    restart it, or see one combined status for every service.

.DESCRIPTION
    The local stack is four pieces: Postgres (Docker), the backend and
    frontend dev servers (host Node processes), and the Windows agent (host .exe,
    which needs Task Scheduler access so it can't be containerized). This script
    is the one place to control and inspect all of them, so you stop wondering
    "which part is down?".

    Usage:
      cronsole up          Start anything that isn't already running (idempotent),
                           including the Docker engine itself if it is down
      cronsole down        Stop the backend, frontend, and agent (leaves the database up)
      cronsole down -All   Also stop the Docker database + proxy containers
      cronsole restart     down (app tier) then up
      cronsole update      git pull, then everything a pull leaves stale: npm
                           install, the MCP build, a restart (which applies
                           database migrations), the proxied bundle and, when
                           its source changed, the agent
      cronsole update -NoRestart   Pull, install and build only; say what is
                           still waiting for a restart
      cronsole agent       Start only the Windows agent (what the elevated
                           \Cronsole-Stack\CronsoleAgentKeeper task runs)
      cronsole status      One table showing every service (default)
      cronsole logs        Tail the backend/frontend logs
      cronsole rebuild     Rebuild frontend\dist if the proxy is serving a stale
                           one (no-op unless remote access is on)
      cronsole mode built  Run the built app instead of the dev servers, on this
                           machine (see Run mode below)
      cronsole mode dev    Go back to the dev servers
      cronsole mode        Say which one this machine runs
      cronsole remote on   Publish the dashboard through the reverse proxy, and
                           keep it published (see Remote access below)
      cronsole remote off  Stop publishing it
      cronsole remote      Say whether this machine publishes it

    RUN MODE

    By default the backend and the dashboard run as DEV servers (tsx watch, Vite):
    they reload when a source file changes. That suits working on Cronsole. It does
    not suit only using it, because any change to the checkout - a git pull, a
    branch switch - restarts the backend under whatever native job is running.

    `cronsole mode built` builds both and records the choice in `.cronsole-built`
    (per-machine, gitignored, a file for the same reason as remote access). From the
    next restart, `up` runs the compiled backend (npm start) and serves the built
    dashboard (vite preview) on the same two ports. Source changes then do nothing
    until `cronsole update`, which rebuilds before it restarts. `status` says when
    the source is newer than the build.

    REMOTE ACCESS

    The single-origin reverse proxy (docker compose profile `proxy`, listening on
    127.0.0.1:8080) is deliberately opt-in: a plain `docker compose up -d` does not
    start it, and neither did `up` until this machine said it wanted it. Saying so
    is `cronsole remote on`, which records the choice in `.cronsole-remote` at the
    repo root - per-machine and gitignored, because whether a machine publishes its
    dashboard is a property of the machine, not of the checkout.

    Once recorded, `up` starts the proxy alongside the database, which is what makes
    it SURVIVE. The container carries `restart: unless-stopped`, so it comes back on
    its own after a reboot or a Docker restart - but NOT after an explicit
    `docker compose stop`, which is Docker working as designed and how the tailnet
    URL went dark for two days with every other service healthy. `up` is idempotent
    and the \Cronsole-Stack\CronsoleStack task re-runs it every 5 minutes, so an
    explicit stop now self-heals within one interval instead of lasting until
    somebody notices (troubleshooting #70).

    Every service is probed by asking the SERVICE, not by checking whether its port
    is bound - /api/health for the backend, an HTTP GET for the frontend, pg_isready
    for Postgres. The port is corroboration only. `status`
    prints the signal it used next to each row, and reports WARN (never a confident
    UP or DOWN) when something is clearly present but cannot be confirmed serving.
    See the Probes section below for why this matters in both directions.

    WHO RUNS ELEVATED

    Only the agent. It needs administrator rights to see and change every Task
    Scheduler folder (troubleshooting #74). The backend does not, and must not have
    them: it runs Cronsole-native jobs, so an elevated backend makes every native
    job, and every package it depends on, an administrator. Work that needs
    administrator rights belongs in a Windows Task Scheduler task, which Cronsole
    creates through the agent, not in a native job.

    Two scheduled tasks keep that split: \Cronsole-Stack\CronsoleStack runs `up`
    WITHOUT elevation (database, backend, frontend, proxy) and
    \Cronsole-Stack\CronsoleAgentKeeper runs `agent` elevated. `up` and `restart`
    hand each half to the right task, whichever kind of shell they are called from.

    Run it from anywhere:  pwsh <repo>\scripts\cronsole.ps1 status
#>

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('up', 'down', 'restart', 'status', 'logs', 'remote', 'rebuild', 'agent', 'update', 'mode')]
    [string]$Command = 'status',

    # Only meaningful for `remote`. Defaults to reporting rather than changing:
    # a bare `cronsole remote` should never turn remote access on by accident.
    [Parameter(Position = 1)]
    [ValidateSet('on', 'off', 'status', 'built', 'dev')]
    [string]$Mode = 'status',

    [switch]$All,

    # Only meaningful for `update`: a restart ends any native job that is running.
    [switch]$NoRestart
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

# Per-machine opt-in for running the built app. Same reasoning as the marker above.
$BuiltMarker = Join-Path $RepoRoot '.cronsole-built'
function Test-BuiltMode { Test-Path $BuiltMarker }

# The two build outputs built mode runs, and the source each is made from.
$BuiltParts = @(
    @{ Name = 'backend';  Output = (Join-Path $BackendDir  'dist\index.js');   Source = (Join-Path $BackendDir  'src') },
    @{ Name = 'frontend'; Output = (Join-Path $FrontendDir 'dist\index.html'); Source = (Join-Path $FrontendDir 'src') }
)

# Names of the parts whose source is newer than their build (or that were never built).
function Get-StaleBuilds {
    foreach ($part in $BuiltParts) {
        if (-not (Test-Path $part.Output)) { $part.Name; continue }
        $built  = (Get-Item $part.Output).LastWriteTimeUtc
        $newest = Get-ChildItem $part.Source -Recurse -File -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
        if ($newest -and $newest.LastWriteTimeUtc -gt $built) { $part.Name }
    }
}

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

# --- Elevation ---------------------------------------------------------------
# A process inherits the token of whatever started it, so "who is elevated" is
# decided here, at launch, and nowhere else. See WHO RUNS ELEVATED above.
$StackTaskPath = '\Cronsole-Stack\'

function Test-Elevated {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-StackTask([string]$Name) {
    Get-ScheduledTask -TaskPath $StackTaskPath -TaskName $Name -ErrorAction SilentlyContinue
}

# Starting a task runs it at the level it was REGISTERED with, whatever the caller
# is: that is how an ordinary shell gets an elevated agent without a UAC prompt, and
# how an elevated shell gets a backend that is not elevated.
function Start-StackTask([string]$Name) {
    try { Start-ScheduledTask -TaskPath $StackTaskPath -TaskName $Name -ErrorAction Stop; return $true }
    catch { return $false }
}

$Npm = 'C:\Program Files\nodejs\npm.cmd'
if (-not (Test-Path $Npm)) { $Npm = 'npm.cmd' }
# Found, not assumed: Docker Desktop installs wherever its owner put it. docker.exe
# lives at <install>\resources\bin\docker.exe, so Docker Desktop.exe is two folders
# up from it. A path written here once was one machine's, and on every other machine
# it made the engine keeper below warn forever without being able to act.
$DockerDesktop = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
$Docker = (Get-Command docker -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source
if (-not $Docker) { $Docker = Join-Path $env:ProgramFiles 'Docker\Docker\resources\bin\docker.exe' }
if (Test-Path $Docker) {
    $beside = Join-Path (Split-Path (Split-Path (Split-Path $Docker))) 'Docker Desktop.exe'
    if (Test-Path $beside) { $DockerDesktop = $beside }
} else { $Docker = 'docker' }

if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }

# --- Probes ------------------------------------------------------------------
# A PORT IS NOT A SERVICE. This script has been wrong in both directions from that
# one mistake, and a control surface that is wrong in both directions is worse than
# no control surface, because it is consulted first and believed:
#
#   * false POSITIVE - a dead container's proxy still held :3000, so `Test-Port`
#     reported "backend already up" and `up` refused to start the real one. That is
#     the 12-minute outage in troubleshooting #23.
#   * false NEGATIVE - `status` called Postgres, backend and frontend all
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

$script:DockerOk = $null
function Test-DockerCli {
    # Cached: every docker call costs ~200ms, and `status` would otherwise make five.
    if ($null -ne $script:DockerOk) { return $script:DockerOk }
    try { & $Docker version --format '{{.Server.Version}}' *> $null; $script:DockerOk = ($LASTEXITCODE -eq 0) }
    catch { $script:DockerOk = $false }
    return $script:DockerOk
}

# The engine has no keeper of its own, and everything below it does. `docker compose
# up` only WARNS when the engine is down, so a Docker Desktop that is quit or crashes
# mid-session leaves the 5-minute self-heal logging the same warning forever while the
# stack never comes back - troubleshooting #70's shape (an opt-in with no keeper) one
# layer further down. This used to live in Start-Cronsole.ps1, which ran ONLY at logon;
# `up` is the thing that runs every 5 minutes, so it is where the recovery belongs.
function Start-DockerEngine {
    param([int]$TimeoutSeconds = 120)

    # Normal case on every pass but the first: one cached probe, no work.
    if (Test-DockerCli) { return $true }

    if (-not (Test-Path $DockerDesktop)) {
        Write-Host "  WARNING: Docker engine is down and Docker Desktop is not at $DockerDesktop" -ForegroundColor Yellow
        return $false
    }

    Write-Host '  Docker engine down - starting Docker Desktop...'
    Start-Process -FilePath $DockerDesktop -WindowStyle Hidden | Out-Null

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
        Start-Sleep -Seconds 5
        # Clear the memo before re-probing. Test-DockerCli caches for the good reason
        # that `status` would otherwise make five calls - but here the whole point is
        # that the answer is expected to change, so the cache is the bug.
        $script:DockerOk = $null
        if (Test-DockerCli) {
            Write-Host ("  Docker engine ready after {0:N0}s" -f $sw.Elapsed.TotalSeconds)
            return $true
        }
    }
    Write-Host "  WARNING: Docker engine not ready after ${TimeoutSeconds}s - the database will not start." -ForegroundColor Yellow
    return $false
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
    Write-Host ('  Cronsole stack ({0})' -f $(if (Test-BuiltMode) { 'built app' } else { 'dev servers' })) -ForegroundColor Cyan
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

    # Not a service, so not a row: the elevated agent task runs files from this folder,
    # and a folder other accounts can write to is a way to become an administrator.
    $null = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'startup-task\Protect-RepoFolder.ps1') -Check 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host ''
        Write-Host '  !! Other accounts on this machine can write to the Cronsole folder.' -ForegroundColor Yellow
        Write-Host '     The elevated agent task runs files from it. See who, and lock it:' -ForegroundColor Yellow
        Write-Host '       scripts\startup-task\Protect-RepoFolder.ps1 -Check' -ForegroundColor Yellow
    }

    if (Test-BuiltMode) {
        $staleBuilds = @(Get-StaleBuilds)
        if ($staleBuilds.Count -gt 0) {
            Write-Host ''
            Write-Host ("  !! Source is newer than the build ({0}). What is running is the older build." -f ($staleBuilds -join ', ')) -ForegroundColor Yellow
            Write-Host '     Rebuild and restart:  cronsole update' -ForegroundColor Yellow
        }
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
    # Dev servers by default; the built app where this machine asked for it.
    # backend: `npm start` (its prestart applies migrations, as predev does).
    $npmArgs = @('run', 'dev')
    if (Test-BuiltMode) {
        $part = $BuiltParts | Where-Object { $_.Name -eq $Name }
        if (-not (Test-Path $part.Output)) {
            Write-Host "  ERROR: $Name is not built ($($part.Output) is missing). Run: cronsole mode built" -ForegroundColor Red
            return
        }
        $npmArgs = if ($Name -eq 'backend') { @('start') } else { @('run', 'preview') }
    }
    Start-Process -FilePath $Npm -ArgumentList $npmArgs -WorkingDirectory $WorkDir `
        -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err | Out-Null
    Write-Host "  started $Name (logs: $LogDir\$Name.*.log)"
}

# The agent (host .exe - needs Task Scheduler access, and elevation to see all of it).
function Start-Agent {
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
        return
    }
    if (-not (Test-Path $AgentExe)) {
        Write-Host "  WARNING: agent exe not found at $AgentExe (publish it first)" -ForegroundColor Yellow
        return
    }
    if (-not (Test-Elevated)) {
        # The normal case under \Cronsole-Stack\CronsoleStack, which is not elevated.
        if ((Get-StackTask 'CronsoleAgentKeeper') -and (Start-StackTask 'CronsoleAgentKeeper')) {
            Write-Host '  agent: asked \Cronsole-Stack\CronsoleAgentKeeper to start it (elevated)'
            return
        }
        Write-Host '  WARNING: starting the agent WITHOUT administrator rights. It cannot see protected' -ForegroundColor Yellow
        Write-Host '           Task Scheduler folders, so syncs are partial (troubleshooting #74).' -ForegroundColor Yellow
        Write-Host '           Register the keeper once, elevated: scripts\startup-task\Register-CronsoleStack.ps1' -ForegroundColor Yellow
    }
    # The agent is a windowless exe, so without these two files everything it
    # prints - including the reason it exited - goes nowhere.
    Start-Process -FilePath $AgentExe -WorkingDirectory (Split-Path -Parent $AgentExe) -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $LogDir 'agent.out.log') `
        -RedirectStandardError (Join-Path $LogDir 'agent.err.log') | Out-Null
    Write-Host "  started agent (logs: $LogDir\agent.*.log)"
}

function Invoke-Up {
    Write-Host 'Bringing the Cronsole stack up...'

    # An elevated `up` must not start the web tier itself: whatever it starts inherits
    # the administrator token, and the backend runs native jobs. Start the agent here
    # and hand the rest to the task that is registered without elevation.
    if (Test-Elevated) {
        $stack = Get-StackTask 'CronsoleStack'
        if ($stack -and "$($stack.Principal.RunLevel)" -eq 'Limited') {
            Start-Agent
            if (Start-StackTask 'CronsoleStack') {
                Write-Host '  web tier: handed to \Cronsole-Stack\CronsoleStack (no administrator rights);'
                Write-Host '            it comes up in the background - check with: cronsole status'
            } else {
                Write-Host '  WARNING: could not start \Cronsole-Stack\CronsoleStack; its next 5-minute run will' -ForegroundColor Yellow
                Write-Host '           bring the web tier up.' -ForegroundColor Yellow
            }
            Start-Sleep -Seconds 2
            Invoke-Status
            return
        }
        Write-Host '  WARNING: this shell is elevated and no un-elevated \Cronsole-Stack\CronsoleStack task' -ForegroundColor Yellow
        Write-Host '           is registered, so the backend - and every native job it runs - will have' -ForegroundColor Yellow
        Write-Host '           administrator rights. Fix: scripts\startup-task\Register-CronsoleStack.ps1' -ForegroundColor Yellow
    }

    # 0. The engine every Docker row below sits on.
    Start-DockerEngine | Out-Null

    # 1. The database (Docker). restart: unless-stopped keeps it self-healing.
    & $Docker compose -f $Compose up -d db 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Host '  database up (docker)' }
    else { Write-Host '  WARNING: docker compose up for the database failed - is Docker running?' -ForegroundColor Yellow }

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

    # 4. Agent. Elevated through its own task when this run is not (see Start-Agent).
    Start-Agent

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
        & $Docker compose -f $Compose stop db 2>&1 | Out-Null
        Write-Host '  database stopped'
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
        Write-Host '  (database left running - use "-All" to stop it too)'
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

# The proxy serves frontend\dist and nothing else rebuilds it, so after a frontend
# change the phone sees yesterday's dashboard while :7373 is current (troubleshooting
# #53). \Cronsole-Stack\CronsoleRebuild runs this hourly. Not part of `up`: a build
# takes ~30s of CPU and `up` runs every 5 minutes. The staleness rule has one
# definition, scripts\check-dist-fresh.mjs; --force because the marker already says
# the proxy is wanted, and its own Docker query can fail in a task's bare PATH.
function Invoke-Rebuild {
    if (-not (Test-RemoteEnabled)) { Write-Host 'Remote access is off on this machine; nothing serves dist.'; return }
    $node = 'C:\Program Files\nodejs\node.exe'
    if (-not (Test-Path $node)) { $node = 'node' }
    & $node (Join-Path $RepoRoot 'scripts\check-dist-fresh.mjs') --force | Out-Host
    $code = $LASTEXITCODE
    # 0 fresh, 1 stale, 2 never built, 3 cannot measure.
    if ($code -ne 1 -and $code -ne 2) { return }
    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
    $log = Join-Path $LogDir 'rebuild.log'
    Write-Host "Rebuilding frontend\dist (log: $log)..."
    Push-Location $FrontendDir
    try { & $Npm run build:remote *> $log } finally { Pop-Location }
    if ($LASTEXITCODE -eq 0) { Write-Host '  rebuilt; the proxy serves it immediately (live mount).' -ForegroundColor Green }
    else { Write-Host "  BUILD FAILED (exit $LASTEXITCODE) - the old bundle is still being served. See $log" -ForegroundColor Red; exit 1 }
}

function Invoke-Restart {
    # Stopping the agent needs elevation. From an ordinary shell, hand the whole
    # restart to the elevated task instead of half-doing it here.
    if (-not (Test-Elevated) -and (Get-StackTask 'CronsoleRestart') -and (Start-StackTask 'CronsoleRestart')) {
        Write-Host 'Restart handed to \Cronsole-Stack\CronsoleRestart (stopping the agent needs elevation).'
        Write-Host 'It takes about 30 seconds - check with: cronsole status'
    } else {
        Invoke-Down; Start-Sleep -Seconds 2; Invoke-Up
    }
}

# True when the agent's source is newer than the published binary. File times, the way
# a build tool decides: a pull writes every file it changes, whoever ran the pull.
function Test-AgentStale {
    $dll = Join-Path $RepoRoot 'agent\publish\Cronsole.Agent.dll'
    if (-not (Test-Path $dll)) { return $false }   # never published: installing it is not an update
    $built  = (Get-Item $dll).LastWriteTimeUtc
    $newest = Get-ChildItem (Join-Path $RepoRoot 'agent\Cronsole.Agent') -Recurse -File -Include '*.cs', '*.csproj' -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch '\\(bin|obj)\\' } |
        Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
    return [bool]($newest -and $newest.LastWriteTimeUtc -gt $built)
}

# Everything a `git pull` leaves stale, in one command (AGENTS.md: the five things that
# run stale). Each step stops the update when it fails, and every failure before the
# restart leaves the running stack alone. This function is the copy that was on disk
# when the command started: a pull that changes this script takes effect next time.
function Invoke-Update {
    $git = (Get-Command git -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source
    if (-not $git) { Write-Host 'git is not on PATH.' -ForegroundColor Red; exit 1 }

    Write-Host 'Updating Cronsole...'
    $before = & $git -C $RepoRoot rev-parse --short HEAD
    # --ff-only: an update never merges or rebases. Local commits or a conflict stop it here.
    & $git -C $RepoRoot pull --ff-only | Out-Host
    if ($LASTEXITCODE -ne 0) {
        Write-Host '  git pull --ff-only failed, so nothing was changed. Resolve it with git, then run this again.' -ForegroundColor Red
        exit 1
    }
    $after = & $git -C $RepoRoot rev-parse --short HEAD
    if ($before -eq $after) { Write-Host "  source already at $after; checking the rest anyway" }
    else { Write-Host "  source $before -> $after" }

    $log = Join-Path $LogDir 'update.log'
    Set-Content -Encoding utf8 -Path $log -Value "=== cronsole update $before -> $after ==="
    foreach ($step in @(
        @{ Dir = 'backend';    Args = @('install', '--no-audit', '--no-fund') },   # postinstall: prisma generate
        @{ Dir = 'frontend';   Args = @('install', '--no-audit', '--no-fund') },
        @{ Dir = 'mcp-server'; Args = @('install', '--no-audit', '--no-fund') },
        @{ Dir = 'mcp-server'; Args = @('run', 'build') }
    ) + $(if (Test-BuiltMode) { @(
        @{ Dir = 'backend';  Args = @('run', 'build') },
        @{ Dir = 'frontend'; Args = @('run', 'build') }
    ) } else { @() })) {
        $label = "npm $($step.Args[0..1] -join ' ') ($($step.Dir))" -replace ' --no-audit', ''
        Write-Host "  $label..."
        Push-Location (Join-Path $RepoRoot $step.Dir)
        try { & $Npm @($step.Args) 2>&1 | ForEach-Object { "$_" } | Out-File -FilePath $log -Append -Encoding utf8 } finally { Pop-Location }
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  FAILED: $label (exit $LASTEXITCODE). The stack was not restarted. See $log" -ForegroundColor Red
            exit 1
        }
    }

    $agentStale = Test-AgentStale
    $republish  = Join-Path $PSScriptRoot 'Republish-Agent.ps1'

    if ($NoRestart) {
        Write-Host ''
        Write-Host '  Installed and built. Still waiting:'
        Write-Host '    backend restart (applies database migrations):  cronsole restart'
        if ($agentStale) { Write-Host "    agent rebuild, from an Administrator prompt:  $republish" }
        if (Test-RemoteEnabled) { Write-Host '    proxied dashboard:  cronsole rebuild' }
        return
    }

    if ($agentStale -and (Test-Elevated)) {
        Write-Host '  agent source is newer than the published agent: rebuilding it'
        Invoke-Down
        & powershell -NoProfile -ExecutionPolicy Bypass -File $republish | Out-Host   # ends with `up`
    } elseif ($agentStale -and (Get-StackTask 'CronsoleRepublish')) {
        Write-Host '  agent source is newer than the published agent: rebuilding it'
        Stop-Port 3000 'backend'; Stop-Port 7373 'frontend'; Stop-DevServerTree
        if (Start-StackTask 'CronsoleRepublish') {
            Write-Host '  handed to \Cronsole-Stack\CronsoleRepublish, which rebuilds the agent and starts the stack.'
            Write-Host "  It takes about a minute. Check with: cronsole status   (log: $env:TEMP\cronsole-republish.log)"
        } else {
            Write-Host '  WARNING: could not start \Cronsole-Stack\CronsoleRepublish. Starting the stack with the old agent.' -ForegroundColor Yellow
            Invoke-Up
        }
    } else {
        Invoke-Restart
        if ($agentStale) {
            Write-Host ''
            Write-Host '  !! The agent source is newer than the published agent, and nothing here can rebuild it.' -ForegroundColor Yellow
            Write-Host "     From an Administrator prompt:  $republish" -ForegroundColor Yellow
        }
    }

    if (Test-RemoteEnabled) { Invoke-Rebuild }
}

function Invoke-Mode {
    switch ($Mode) {
        'built' {
            # Build first: the marker is written only once there is something to run.
            foreach ($dir in @($BackendDir, $FrontendDir)) {
                Write-Host "Building $(Split-Path -Leaf $dir)..."
                Push-Location $dir
                try { & $Npm run build | Out-Host } finally { Pop-Location }
                if ($LASTEXITCODE -ne 0) {
                    Write-Host '  BUILD FAILED. Nothing was changed; this machine still runs the dev servers.' -ForegroundColor Red
                    exit 1
                }
            }
            Set-Content -Path $BuiltMarker -Encoding ASCII -Value @(
                '# Cronsole: this machine runs the built app, not the dev servers.',
                '# Created by: cronsole mode built',
                ('# On: {0}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')),
                '# Remove with: cronsole mode dev'
            )
            Write-Host 'Built. This machine now runs the built app.' -ForegroundColor Green
            Write-Host 'What is running was not touched. Switch over with:  cronsole restart'
            Write-Host 'After a git pull, use:  cronsole update   (it rebuilds before it restarts)'
        }
        'dev' {
            if (Test-BuiltMode) { Remove-Item $BuiltMarker -Force }
            Write-Host 'This machine runs the dev servers. Switch over with:  cronsole restart'
        }
        default {
            if (Test-BuiltMode) { Write-Host 'Run mode: built app (cronsole mode dev to change).' }
            else { Write-Host 'Run mode: dev servers (cronsole mode built to change).' }
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
    'restart' { Invoke-Restart }
    'update'  { Invoke-Update }
    'agent'   { Start-Agent }
    'status'  { Invoke-Status }
    'logs'    { Invoke-Logs }
    'remote'  { Invoke-Remote }
    'mode'    { Invoke-Mode }
    'rebuild' { Invoke-Rebuild }
}
