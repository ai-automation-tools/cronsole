#requires -Version 7
<#
.SYNOPSIS
    Tests for the helper scripts the cronsole-windows-jobs skill ships.

.DESCRIPTION
    Builds fixture jobs in a temp directory and runs each helper against them:

    1. skills/cronsole-windows-jobs/scripts/Invoke-ScheduledJob.ps1: an ok run, a
       warnOn match (attention), a non-zero exit (failed), the transcript, the JSON
       payload piped to the notifier, and -WhatIfChild.
    2. Windows only: Register-ScheduledJob.ps1 -WhatIf (never registers a task; CI
       also registers and removes one real repeating task under \SkillTests\) and
       run-hidden.vbs passing a script's exit code back through cscript.

    Moved here from agent-skills (scripts/test-skill-scripts.ps1) with the skill on
    2026-11-27. Touches nothing outside the temp directory. Exits 1 on the first
    failed assertion. CI runs it in ci.yml (skill-scripts, ubuntu and windows).

.EXAMPLE
    pwsh -NoProfile -File scripts/test-skill-scripts.ps1
#>
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$JobsDir  = Join-Path $RepoRoot 'skills/cronsole-windows-jobs/scripts'
$Tmp      = Join-Path ([IO.Path]::GetTempPath()) "skill-scripts-test-$([guid]::NewGuid().ToString('N'))"

function Assert([bool] $Condition, [string] $Message) {
    if (-not $Condition) { throw "FAIL: $Message" }
    Write-Host "ok   $Message"
}

# Runs a script block and returns the error message it threw, or $null.
function Get-Thrown([scriptblock] $Block) {
    try { & $Block *> $null; return $null } catch { return $_.Exception.Message }
}

function New-File([string] $Path, [string] $Value = '') {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
    Set-Content -LiteralPath $Path -Value $Value
}

try {
    New-Item -ItemType Directory -Path $Tmp | Out-Null

    # --- 1. Invoke-ScheduledJob.ps1 -------------------------------------------
    # Run in a child pwsh: the wrapper ends with `exit <code>`, which would end this test.
    $runner   = Join-Path $JobsDir 'Invoke-ScheduledJob.ps1'
    $jobsRoot = Join-Path $Tmp 'jobs'
    $notifier = Join-Path $Tmp 'notify.ps1'
    New-File $notifier 'Set-Content -LiteralPath $args[0] -Value ([Console]::In.ReadToEnd())'

    function New-Job([string] $Name, [string] $Body, [hashtable] $Extra = @{}) {
        $dir = Join-Path $jobsRoot $Name
        $script = Join-Path $dir 'job.ps1'
        New-File $script $Body
        $payloadFile = Join-Path $dir 'payload.json'
        $cfg = @{ script = $script; shell = 'pwsh'
            notify = @{ command = 'pwsh'; arguments = "-NoProfile -File $notifier $payloadFile"; notifyOn = @('ok', 'attention', 'failed') } }
        foreach ($k in $Extra.Keys) { $cfg[$k] = $Extra[$k] }
        $cfg | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $dir 'job.json')
        return $payloadFile
    }
    function Invoke-Job([string] $Name, [string[]] $More = @()) {
        $out = & pwsh -NoProfile -File $runner -Job $Name -JobsRoot $jobsRoot @More 2>&1
        return [pscustomobject]@{ Code = $LASTEXITCODE; Output = ($out -join "`n") }
    }

    $okPayload = New-Job 'ok-job' "Write-Output 'Freed 12 GB'`nexit 0" @{ report = @('^Freed') }
    $r = Invoke-Job 'ok-job'
    $p = Get-Content $okPayload -Raw | ConvertFrom-Json
    Assert ($r.Code -eq 0 -and $p.status -eq 'ok') 'jobs: a clean exit is ok and exits 0'
    Assert ($p.report -contains 'Freed 12 GB') 'jobs: report patterns pick lines into the payload'
    $log = Get-ChildItem (Join-Path $jobsRoot 'ok-job/logs') -Filter '*.log' | Select-Object -First 1
    $logText = if ($log) { Get-Content $log.FullName -Raw } else { '' }
    Assert ($logText -match 'exit code:\s+0' -and $logText -match 'Freed 12 GB') 'jobs: the transcript holds the header and the output'
    Assert ($p.logFile -eq $log.FullName) 'jobs: the payload points at the transcript'

    $warnPayload = New-Job 'warn-job' "Write-Output 'WARNING: disk low'`nexit 0" @{ warnOn = @('^WARNING') }
    $r = Invoke-Job 'warn-job'
    $p = Get-Content $warnPayload -Raw | ConvertFrom-Json
    Assert ($r.Code -eq 0 -and $p.status -eq 'attention') 'jobs: a warnOn match on a clean exit is attention'
    Assert ($p.subject -like '`[CHECK`]*1 warning(s)' -and $p.warnings -contains 'WARNING: disk low') 'jobs: attention subject and warnings list'

    $failPayload = New-Job 'fail-job' "Write-Output 'WARNING: also this'`nexit 3" @{ warnOn = @('^WARNING') }
    $r = Invoke-Job 'fail-job'
    $p = Get-Content $failPayload -Raw | ConvertFrom-Json
    Assert ($r.Code -eq 3 -and $p.status -eq 'failed' -and $p.exitCode -eq 3) 'jobs: a non-zero exit is failed and passes the code through'
    Assert ($p.subject -like '`[FAIL`]*exit code 3') 'jobs: failed subject names the exit code'

    $quietPayload = Join-Path $jobsRoot 'quiet-job/payload.json'
    $null = New-Job 'quiet-job' 'exit 0' @{ notify = @{ command = 'pwsh'; arguments = "-NoProfile -File $notifier $quietPayload" } }
    $r = Invoke-Job 'quiet-job'
    Assert ($r.Code -eq 0 -and -not (Test-Path $quietPayload)) 'jobs: by default an ok run does not notify'

    $whatIfPayload = New-Job 'whatif-job' "New-Item -ItemType File -Path '$(Join-Path $Tmp 'ran.txt')'"
    $r = Invoke-Job 'whatif-job' @('-WhatIfChild')
    Assert ($r.Output -match 'Would run: pwsh' -and -not (Test-Path (Join-Path $Tmp 'ran.txt')) -and -not (Test-Path $whatIfPayload)) 'jobs: -WhatIfChild prints the command and runs nothing'

    $r = Invoke-Job 'no-such-job'
    Assert ($r.Code -ne 0 -and $r.Output -match 'No job.json') 'jobs: a missing job.json fails loudly'

    $badPayload = New-Job 'badshell-job' 'exit 0' @{ shell = 'no-such-shell-agent-skills' }
    $r = Invoke-Job 'badshell-job'
    $p = if (Test-Path $badPayload) { Get-Content $badPayload -Raw | ConvertFrom-Json } else { $null }
    $badLog = Get-ChildItem (Join-Path $jobsRoot 'badshell-job/logs') -Filter '*.log' -ErrorAction SilentlyContinue | Select-Object -First 1
    Assert ($r.Code -ne 0 -and $p -and $p.status -eq 'failed') 'jobs: a shell that cannot start is a failed run with a payload, not a silent throw'
    Assert ($badLog -and ((Get-Content $badLog.FullName -Raw) -match 'Could not start')) 'jobs: the launch error is in the transcript'

    $spaceDir = Join-Path $Tmp 'pay load'
    New-Item -ItemType Directory -Force -Path $spaceDir | Out-Null
    $spacePayload = Join-Path $spaceDir 'payload.json'
    $null = New-Job 'array-args-job' 'exit 0' @{ notify = @{ command = 'pwsh'; arguments = @('-NoProfile', '-File', $notifier, $spacePayload); notifyOn = @('ok') } }
    $r = Invoke-Job 'array-args-job'
    Assert ($r.Code -eq 0 -and (Test-Path -LiteralPath $spacePayload)) 'jobs: notify.arguments as an array keeps an argument with a space whole'

    # --- 2. Windows-only helpers -----------------------------------------------
    if ($IsWindows) {
        $register = Join-Path $JobsDir 'Register-ScheduledJob.ps1'
        $regDir = Join-Path $jobsRoot 'reg-job'
        New-Item -ItemType Directory -Force -Path $regDir | Out-Null
        $regCfg = Join-Path $regDir 'job.json'

        @{ taskName = 'Test Job'; taskPath = '\SkillTests'; schedule = @{ dayOfWeek = 'Sunday'; at = '03:00' } } |
            ConvertTo-Json | Set-Content $regCfg
        $out = & $register -Job 'reg-job' -JobsRoot $jobsRoot -WhatIf 6>&1 | Out-String
        Assert ($out -match 'Would register: \\SkillTests\\Test Job' -and $out -match 'Invoke-ScheduledJob\.ps1') 'register: -WhatIf names the task and points it at the runner'
        Assert ($out -match 'runLevel: Limited') 'register: runLevel defaults to Limited'
        Assert ($out -match 'catchUp:\s+False') 'register: catch-up (StartWhenAvailable) is off by default'
        Assert ($null -eq (Get-ScheduledTask -TaskPath '\SkillTests\' -ErrorAction SilentlyContinue)) 'register: -WhatIf registers nothing'

        @{ taskName = 'Bad'; taskPath = '\Microsoft\Windows'; schedule = @{ daily = $true; at = '07:00' } } | ConvertTo-Json | Set-Content $regCfg
        $err = Get-Thrown { & $register -Job 'reg-job' -JobsRoot $jobsRoot -WhatIf }
        Assert ($err -match 'Refusing to register under \\Microsoft\\') 'register: refuses a task path under \Microsoft\'

        @{ taskName = 'Bad'; schedule = @{ monthly = $true } } | ConvertTo-Json | Set-Content $regCfg
        $err = Get-Thrown { & $register -Job 'reg-job' -JobsRoot $jobsRoot -WhatIf }
        Assert ($err -match 'schedule needs one of') 'register: refuses an unknown schedule shape'

        @{ taskName = 'Catch Up'; taskPath = '\SkillTests'; catchUp = $true; schedule = @{ daily = $true; at = '07:00' } } | ConvertTo-Json | Set-Content $regCfg
        $out = & $register -Job 'reg-job' -JobsRoot $jobsRoot -WhatIf 6>&1 | Out-String
        Assert ($out -match 'catchUp:\s+True') 'register: "catchUp": true turns it on'

        # A real registration, CI only: a repeating task must be accepted by Task Scheduler
        # (a [TimeSpan]::MaxValue duration is rejected). Registered under \SkillTests\ and removed.
        if ($env:CI) {
            @{ taskName = 'Repeat'; taskPath = '\SkillTests'; schedule = @{ everyMinutes = 15 } } | ConvertTo-Json | Set-Content $regCfg
            try {
                & $register -Job 'reg-job' -JobsRoot $jobsRoot *> $null
                $task = Get-ScheduledTask -TaskPath '\SkillTests\' -TaskName 'Repeat' -ErrorAction SilentlyContinue
                Assert ($task -and $task.Triggers[0].Repetition.Interval -eq 'PT15M') 'register: a repeating task registers on this Windows'
                Assert (-not $task.Settings.StartWhenAvailable) 'register: the registered task has catch-up off'
            } finally {
                Unregister-ScheduledTask -TaskPath '\SkillTests\' -TaskName 'Repeat' -Confirm:$false -ErrorAction SilentlyContinue
            }
        } else { Write-Host 'skip real task registration (CI only)' }

        $exit7 = Join-Path $Tmp 'exit7.ps1'
        New-File $exit7 'exit 7'
        & cscript.exe //nologo (Join-Path $JobsDir 'run-hidden.vbs') $exit7 | Out-Null
        Assert ($LASTEXITCODE -eq 7) 'run-hidden.vbs: the script exit code reaches the caller'
        $echo = Join-Path $Tmp 'echo-args.ps1'
        New-File $echo 'param($Out, $Val) Set-Content -LiteralPath $Out -Value "$($args.Count)|$Val"'
        $echoOut = Join-Path $Tmp 'echo.txt'
        & cscript.exe //nologo (Join-Path $JobsDir 'run-hidden.vbs') $echo $echoOut 'two words' | Out-Null
        Assert ((Get-Content -LiteralPath $echoOut -Raw).Trim() -eq '0|two words') 'run-hidden.vbs: an argument with a space reaches the script whole'
    } else {
        Write-Host 'skip Register-ScheduledJob.ps1 and run-hidden.vbs (Windows only)'
    }

    Write-Host 'All skill-script checks passed.' -ForegroundColor Green
}
catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
finally {
    if (Test-Path $Tmp) { Remove-Item $Tmp -Recurse -Force -ErrorAction SilentlyContinue }
}
