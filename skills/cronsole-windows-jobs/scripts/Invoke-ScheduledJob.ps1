<#
.SYNOPSIS
    Run one scheduled job's script, capture what it printed, classify the outcome, and
    hand the result to a notifier.

.DESCRIPTION
    The reference wrapper for archetype B (and the script half of archetype A2) in the
    cronsole-windows-jobs skill. A scheduled task points HERE, with -Job <name>, rather
    than at the job's own script -- which is what buys the job a transcript, an exit-code
    classification and a notification it would otherwise not have.

    Per run:

      1. Launch  the script named by <JobsRoot>\<Job>\job.json, in the shell it names,
                 with its arguments, at its working directory.
      2. Capture everything it wrote to stdout and stderr, into a UTF-8 transcript at
                 <JobsRoot>\<Job>\logs\<yyyy-MM-dd_HHmm>.log. The script's own logging is
                 untouched and stays the deep record.
      3. Classify The exit code is the source of truth: non-zero is 'failed', full stop.
                 A clean exit whose output matched a "warnOn" pattern is 'attention'.
                 Anything else is 'ok'.
      4. Report   Pipe a JSON payload to the job's "notify" command, if it has one.

    This wrapper never second-guesses the exit code and never edits the script it runs. If
    you want different behaviour from a job, change the job's script -- the wrapper only
    decides what to quote.

    Known ceiling: the child's output is captured, not streamed, so a long-running job's
    transcript appears when it finishes rather than as it goes. Swap Start-Process for a
    streaming pipeline if you need live logs.

.PARAMETER Job
    Folder name under <JobsRoot>, e.g. "cleanup-cdrive".

.PARAMETER JobsRoot
    Folder holding one subfolder per job. Defaults to $env:SCHEDULED_JOBS_ROOT, then to
    "$HOME\.claude\jobs".

.PARAMETER WhatIfChild
    Print the command that would run, and exit. Does not launch the script or notify.

.EXAMPLE
    pwsh -File Invoke-ScheduledJob.ps1 -Job cleanup-cdrive -WhatIfChild

.EXAMPLE
    pwsh -File Invoke-ScheduledJob.ps1 -Job cleanup-cdrive

.NOTES
    ASCII only, no BOM. Windows PowerShell 5.1 reads a BOM-less .ps1 as ANSI and turns one
    stray non-ASCII character into a wall of bogus parse errors.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Job,
    [string]$JobsRoot,
    [switch]$WhatIfChild
)

$ErrorActionPreference = 'Stop'

# --- Locate the job ---------------------------------------------------------

if (-not $JobsRoot) {
    $JobsRoot = if ($env:SCHEDULED_JOBS_ROOT) { $env:SCHEDULED_JOBS_ROOT }
                else { Join-Path $HOME '.claude\jobs' }
}

$JobDir     = Join-Path $JobsRoot $Job
$ConfigFile = Join-Path $JobDir 'job.json'
if (-not (Test-Path -LiteralPath $ConfigFile)) { throw "No job.json at $ConfigFile" }

$cfg = Get-Content -LiteralPath $ConfigFile -Raw | ConvertFrom-Json

foreach ($required in 'script') {
    if (-not $cfg.$required) { throw "job.json is missing required key '$required'" }
}
if (-not (Test-Path -LiteralPath $cfg.script)) { throw "Script not found: $($cfg.script)" }

$shell     = if ($cfg.shell) { $cfg.shell } else { 'powershell.exe' }
$jobName   = if ($cfg.name)  { $cfg.name }  else { $Job }
$keepLogs  = if ($cfg.keepLogs) { [int]$cfg.keepLogs } else { 20 }

$LogDir = Join-Path $JobDir 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$LogFile = Join-Path $LogDir ((Get-Date -Format 'yyyy-MM-dd_HHmm') + '.log')

# --- Build the child command ------------------------------------------------

$childArgs = '-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $cfg.script
if ($cfg.arguments) { $childArgs += ' ' + $cfg.arguments }

if ($WhatIfChild) {
    Write-Host "Would run: $shell $childArgs"
    if ($cfg.workingDirectory) { Write-Host "        in: $($cfg.workingDirectory)" }
    Write-Host "Transcript: $LogFile"
    return
}

# --- 1 + 2. Launch and capture ----------------------------------------------

$started  = Get-Date
$outFile  = [System.IO.Path]::GetTempFileName()
$errFile  = [System.IO.Path]::GetTempFileName()

$spArgs = @{
    FilePath               = $shell
    ArgumentList           = $childArgs
    RedirectStandardOutput = $outFile
    RedirectStandardError  = $errFile
    NoNewWindow            = $true
    Wait                   = $true
    PassThru               = $true
}
if ($cfg.workingDirectory) { $spArgs.WorkingDirectory = $cfg.workingDirectory }

# A launch failure (a bad "shell", a missing working directory) is a failed run like any
# other: it still gets a log and a notification, never a silent throw.
$launchError = $null
try {
    $proc     = Start-Process @spArgs
    $exitCode = $proc.ExitCode
} catch {
    $launchError = "Could not start '$shell': $($_.Exception.Message)"
    $exitCode    = -1
}
$duration = (Get-Date) - $started

$stdout = if (Test-Path $outFile) { Get-Content -LiteralPath $outFile -Raw } else { '' }
$stderr = if (Test-Path $errFile) { Get-Content -LiteralPath $errFile -Raw } else { '' }
if ($launchError) { $stderr = ($launchError + "`n" + $stderr).Trim() }
Remove-Item -LiteralPath $outFile, $errFile -ErrorAction SilentlyContinue

$transcript = ($stdout + "`n" + $stderr).Trim()

# A script that writes its own human-readable log is a better report source than stdout.
if ($cfg.logDir -and $cfg.logGlob) {
    $own = Get-ChildItem -LiteralPath $cfg.logDir -Filter $cfg.logGlob -ErrorAction SilentlyContinue |
           Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($own -and $own.LastWriteTime -ge $started) {
        $transcript = Get-Content -LiteralPath $own.FullName -Raw
    }
}

$header = @(
    "job:        $jobName"
    "script:     $($cfg.script) $($cfg.arguments)"
    "shell:      $shell"
    "started:    $($started.ToString('u'))"
    "duration:   {0:N1} min" -f $duration.TotalMinutes
    "exit code:  $exitCode"
    '-' * 60
) -join "`n"

Set-Content -LiteralPath $LogFile -Value ($header + "`n" + $transcript) -Encoding utf8

# --- 3. Classify ------------------------------------------------------------
# Exit code is the source of truth. warnOn only ever downgrades a clean exit to
# 'attention' -- it can never rescue a non-zero one.

function Select-Matching {
    param([string]$Text, $Patterns)
    if (-not $Patterns) { return @() }
    $lines = $Text -split "`r?`n"
    $hits  = New-Object System.Collections.Generic.List[string]
    foreach ($line in $lines) {
        foreach ($p in $Patterns) {
            if ($line -match $p) { $hits.Add($line.TrimEnd()); break }
        }
    }
    return $hits.ToArray()
}

$reportLines = Select-Matching -Text $transcript -Patterns $cfg.report
$warnLines   = Select-Matching -Text $transcript -Patterns $cfg.warnOn

$status = if ($exitCode -ne 0)      { 'failed' }
          elseif ($warnLines.Count) { 'attention' }
          else                      { 'ok' }

$tag = switch ($status) { 'failed' { '[FAIL]' } 'attention' { '[CHECK]' } default { '[OK]' } }
$subject = '{0} {1} - completed in {2:N1} min' -f $tag, $jobName, $duration.TotalMinutes
if ($warnLines.Count) { $subject += ", $($warnLines.Count) warning(s)" }
if ($status -eq 'failed') { $subject = '{0} {1} - exit code {2}' -f $tag, $jobName, $exitCode }

Write-Host $subject
if ($reportLines.Count) { Write-Host ''; $reportLines | ForEach-Object { Write-Host "  $_" } }
if ($warnLines.Count)   { Write-Host ''; Write-Host 'Warnings:'; $warnLines | Select-Object -First 25 | ForEach-Object { Write-Host "  $_" } }

# --- 4. Report --------------------------------------------------------------
# Transport-agnostic on purpose: the job names a command, this hands it one JSON
# document on stdin. Email, webhook, Slack, a file -- none of that belongs here.

if ($cfg.notify -and $cfg.notify.command) {
    $notifyOn = if ($cfg.notify.notifyOn) { $cfg.notify.notifyOn } else { @('attention', 'failed') }
    if ($notifyOn -contains $status) {
        $payload = [ordered]@{
            job         = $jobName
            status      = $status
            subject     = $subject
            exitCode    = $exitCode
            durationMin = [math]::Round($duration.TotalMinutes, 1)
            startedUtc  = $started.ToUniversalTime().ToString('o')
            script      = $cfg.script
            arguments   = $cfg.arguments
            logFile     = $LogFile
            report      = $reportLines
            warnings    = $warnLines
        } | ConvertTo-Json -Depth 5

        try {
            if ($cfg.notify.arguments) {
                # An array passes each argument whole; a string is split on spaces (older job.json).
                $notifyArgs = if ($cfg.notify.arguments -is [string]) { $cfg.notify.arguments.Split(' ', [StringSplitOptions]::RemoveEmptyEntries) } else { @($cfg.notify.arguments) }
                $payload | & $cfg.notify.command @notifyArgs
            } else {
                $payload | & $cfg.notify.command
            }
        } catch {
            # A notifier that throws must not turn a good run into a failed one.
            Write-Warning "notify failed: $_"
            Add-Content -LiteralPath $LogFile -Value "WARN: notify failed: $_"
        }
    }
}

# --- Rotate -----------------------------------------------------------------

Get-ChildItem -LiteralPath $LogDir -Filter '*.log' |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip $keepLogs |
    Remove-Item -Force -ErrorAction SilentlyContinue

exit $exitCode
