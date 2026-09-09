<#
.SYNOPSIS
    One-time machine migration: rename the local checkout folder and repoint
    everything on this machine that names it by absolute path.

.DESCRIPTION
    The checkout has been `...\Live_Apps\taskhub` since before the product was
    renamed to Cronsole. Three scheduled tasks embed that path TWICE each -- the
    launcher passes run-hidden.vbs and the target script, both fully qualified:

      wscript.exe "<repo>\scripts\startup-task\run-hidden.vbs"
                  "<repo>\scripts\cronsole.ps1" up

    So renaming the folder without repointing them breaks logon start, and it
    breaks it SILENTLY: wscript.exe launching a missing .ps1 opens no window and
    reports nothing. You would find out at the next reboot, or not at all.

    What this does, in order:
      1. Plan  -- resolve both paths, list the tasks that will be repointed.
      2. Guard -- refuse unless elevated, unless the source exists, and unless
                 the destination is free.
      3. Disable the three tasks, so nothing fires mid-migration. CronsoleStack
         runs every 5 minutes; without this the odds of it firing into a
         half-renamed tree are real rather than theoretical.
      4. Stop the stack (cronsole.ps1 down) and the agent, then WAIT for the
         handles to actually go, because a running process inside the folder
         makes the rename fail with a misleading "being used by another process".
      5. Rename the folder.
      6. Repoint each task's action to the new path with Set-ScheduledTask --
         actions only, so triggers, principal and RunLevel survive untouched.
      6b. Repoint the .claude\skills\cronsole JUNCTION, whose target is stored as
         an absolute path and would otherwise dangle. A scheduled task is not the
         only thing on this machine that names the folder by absolute path.
      7. Re-enable, then VERIFY BY ASKING TASK SCHEDULER what the actions now
         say -- not by trusting an exit code. Stage 2's lesson: a script ending
         in `Stop-Process -Id $PID` can take its caller with it and still look
         like it succeeded.

    Docker is deliberately untouched. docker-compose.yml pins `name: taskhub`,
    so the project and the `taskhub_postgres_data` volume do NOT follow the
    folder. Without that pin this migration would silently mount a new empty
    database.

.PARAMETER RepoRoot
    The current checkout. Defaults to the grandparent of this script -- but see
    RUN THIS FROM %TEMP% below; when run from a copy, pass it explicitly.

.PARAMETER NewName
    New leaf folder name. Default 'cronsole'.

.PARAMETER DryRun
    Print the plan and change nothing. The plan needs no write to produce, so
    this is a real preview rather than a rehearsal.

.NOTES
    RUN THIS FROM %TEMP%, NOT FROM THE REPO.

    PowerShell holds an open handle to the script file it is executing. If that
    file lives inside the folder being renamed, the rename fails. Copy it out
    first and pass -RepoRoot:

      $repo = "C:\path\to\cronsole"   # the CURRENT folder, wherever you cloned it
      $s = "$env:TEMP\Migrate-RepoFolder.ps1"
      Copy-Item "$repo\scripts\startup-task\Migrate-RepoFolder.ps1" $s
      & $s -RepoRoot $repo -NewName "<new-folder-name>" -DryRun
      & $s -RepoRoot $repo -NewName "<new-folder-name>"

    The example names the CURRENT folder because that is what a future move starts
    from. The 2026-07-31 run went taskhub -> cronsole; leaving the old name in this
    example would send the next reader at a folder that no longer exists.

    Requires elevation: the \Cronsole-Stack\ tasks run at RunLevel Highest and
    were created elevated, so modifying them needs an administrator token.
#>
[CmdletBinding()]
param(
    [string]$RepoRoot = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)),
    [string]$NewName  = 'cronsole',
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$TaskPath  = '\Cronsole-Stack\'
$TaskNames = @('CronsoleRepublish', 'CronsoleRestart', 'CronsoleStack')

function Test-Elevated {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    (New-Object Security.Principal.WindowsPrincipal $id).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}

# --- 1. Resolve + guard --------------------------------------------------------
$OldRoot = [IO.Path]::GetFullPath($RepoRoot.TrimEnd('\'))
$Parent  = Split-Path -Parent $OldRoot
$OldLeaf = Split-Path -Leaf   $OldRoot
$NewRoot = Join-Path $Parent $NewName

Write-Host ''
Write-Host '=== Cronsole checkout-folder migration ===' -ForegroundColor Cyan
Write-Host ("  from : {0}" -f $OldRoot)
Write-Host ("  to   : {0}" -f $NewRoot)
Write-Host ''

if ($OldLeaf -eq $NewName) {
    Write-Host "Already named '$NewName' -- nothing to do." -ForegroundColor Green
    return
}
if (-not (Test-Path $OldRoot)) { Write-Error "Source not found: $OldRoot"; exit 1 }
if (Test-Path $NewRoot)        { Write-Error "Destination already exists: $NewRoot"; exit 1 }

# Running from inside the tree means PowerShell holds a handle in it.
if ($PSScriptRoot -and $PSScriptRoot.ToLower().StartsWith($OldRoot.ToLower())) {
    Write-Error @"
This script is running from INSIDE the folder it is about to rename, so
PowerShell holds an open handle there and the rename will fail. Copy it to
%TEMP% and pass -RepoRoot -- see the NOTES section in this file.
"@
    exit 1
}
if ((Get-Location).Path.ToLower().StartsWith($OldRoot.ToLower())) {
    Set-Location $Parent   # our own CWD would block the rename
}
# NOTE: the elevation guard deliberately sits AFTER the plan, below. Reading tasks and
# paths needs no privilege, so -DryRun must not either: a preview you cannot run without
# admin is a rehearsal, not a plan. Same rule the restore route follows.

# --- 2. Plan -------------------------------------------------------------------
Write-Host 'Plan -- tasks to repoint:' -ForegroundColor Cyan
$plan = @()
foreach ($n in $TaskNames) {
    $t = Get-ScheduledTask -TaskPath $TaskPath -TaskName $n -ErrorAction SilentlyContinue
    if (-not $t) {
        Write-Host ("  [warn] {0} not found -- skipping" -f $n) -ForegroundColor Yellow
        continue
    }
    $hits = @($t.Actions | Where-Object { $_.Arguments -like "*$OldRoot*" -or $_.Execute -like "*$OldRoot*" })
    if ($hits.Count -eq 0) {
        Write-Host ("  [skip] {0} does not reference the old path" -f $n) -ForegroundColor DarkGray
        continue
    }
    Write-Host ("  [plan] {0}" -f $n) -ForegroundColor Yellow
    $plan += $n
}
Write-Host ''

if ($DryRun) {
    Write-Host 'DRY RUN -- nothing was changed.' -ForegroundColor Green
    if (-not (Test-Elevated)) {
        Write-Host 'Note: not elevated. The real run needs an Administrator prompt.' -ForegroundColor Yellow
    }
    return
}

# Everything past here writes. The plan above needed no privilege; this does.
if (-not (Test-Elevated)) {
    Write-Error 'Run this from an Administrator prompt: it modifies RunLevel Highest tasks.'
    exit 1
}

# --- 3. Disable, so nothing fires into a half-renamed tree ---------------------
Write-Host 'Disabling launcher tasks...' -ForegroundColor Cyan
foreach ($n in $TaskNames) {
    Disable-ScheduledTask -TaskPath $TaskPath -TaskName $n -ErrorAction SilentlyContinue | Out-Null
}

# --- 4. Stop everything holding a handle in the folder -------------------------
Write-Host 'Stopping the stack and the agent...' -ForegroundColor Cyan
$down = Join-Path $OldRoot 'scripts\cronsole.ps1'
if (Test-Path $down) {
    & pwsh -NoProfile -File $down down 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
}
# No Stop-ScheduledTask here on purpose. Every task in this folder launches through
# run-hidden.vbs, which is fire-and-forget, so the task instance is gone within a
# second while the processes it started run on independently. Stopping the task stops
# nothing; the Stop-Process below is what actually releases the handles.

# Stop the agent under BOTH names. An agent that started before the 2026-07-31 exe
# rename is still called TaskHub.Agent, holds the same handles inside agent\publish,
# and is invisible to a lookup for the new name only - so `cronsole.ps1 down` reports
# "agent already stopped" and the rename below then fails on a handle nothing admits
# to holding. That is exactly how this script failed the first time it was run.
$agents = @(Get-Process -Name 'Cronsole.Agent','TaskHub.Agent' -ErrorAction SilentlyContinue)
foreach ($a in $agents) {
    Write-Host ("    stopping agent {0} (pid {1})" -f $a.ProcessName, $a.Id) -ForegroundColor DarkGray
    Stop-Process -Id $a.Id -Force -ErrorAction SilentlyContinue
}
if ($agents.Count -eq 0) { Write-Host '    no agent process running' -ForegroundColor DarkGray }

# A stopped process is not the same as a released handle. Retry rather than
# racing it -- the failure mode otherwise is a rename that fails for a reason the
# error message describes badly.
Write-Host 'Waiting for handles to clear, then renaming...' -ForegroundColor Cyan
$renamed = $false
foreach ($attempt in 1..10) {
    try {
        Rename-Item -LiteralPath $OldRoot -NewName $NewName -ErrorAction Stop
        $renamed = $true
        break
    } catch {
        if ($attempt -eq 10) {
            # Name the holders rather than listing "common culprits". A generic hint sends
            # you hunting an Explorer window while a leftover `tsx watch` sits there -- the
            # exact wrong turn this failure produced the first time. Only processes that
            # NAME the path can be found this way: a process merely sitting in the folder
            # (an editor, a terminal, an AI agent) holds an identical CWD handle and is
            # invisible to every API short of a handle enumerator, so say that too instead
            # of letting an empty list read as "nothing is holding it".
            $suspects = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
                Where-Object {
                    $_.ProcessId -ne $PID -and $_.CommandLine -and
                    $_.CommandLine.IndexOf($OldRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0
                } | ForEach-Object { "    pid {0,-6} {1}" -f $_.ProcessId, $_.Name })

            $named = if ($suspects.Count -gt 0) {
                "Processes naming that path right now:`n" + ($suspects -join "`n")
            } else {
                'No process NAMES that path, so the holder is something merely sitting in
it -- its working directory is a handle too, and one this check cannot see.'
            }

            # Undo our own setup rather than print the undo. Step 3 disabled the launcher
            # tasks; if we exit leaving them off, a failed migration has silently turned
            # logon start off too -- and the user finds out at the next reboot. Restoring
            # is a command we can run, so printing it instead would be the lazier half of
            # the same thought that made the rest of this script verify by reading back.
            $restored = @()
            foreach ($n in $TaskNames) {
                try {
                    Enable-ScheduledTask -TaskPath $TaskPath -TaskName $n -ErrorAction Stop | Out-Null
                    $restored += $n
                } catch { }
            }
            $stillOff = @($TaskNames | Where-Object {
                $t = Get-ScheduledTask -TaskPath $TaskPath -TaskName $_ -ErrorAction SilentlyContinue
                $t -and $t.State -eq 'Disabled'
            })
            $taskState = if ($stillOff.Count -eq 0) {
                "The launcher tasks were re-enabled -- the machine is back how it started."
            } else {
                @"
COULD NOT re-enable: $($stillOff -join ', ') -- logon start is OFF until you do:

  '$($stillOff -join "','")' | ForEach-Object {
      Enable-ScheduledTask -TaskPath '$TaskPath' -TaskName `$_ }
"@
            }

            Write-Error @"
Could not rename after 10 attempts: $($_.Exception.Message)

Something still holds a handle inside $OldRoot.

$named

A working directory counts. Close any editor, terminal, file manager or AI coding
session opened ON that folder -- including the one you may be reading this in --
then run this script again from a shell somewhere else.

$taskState

The app tier was stopped and was NOT restarted. Bring it back with:
  pwsh "$OldRoot\scripts\cronsole.ps1" up
"@
            exit 1
        }
        Start-Sleep -Seconds 3
    }
}
if ($renamed) { Write-Host ("  renamed after {0} attempt(s)" -f $attempt) -ForegroundColor Green }

# --- 5. Repoint the task actions ----------------------------------------------
Write-Host 'Repointing task actions...' -ForegroundColor Cyan
foreach ($n in $plan) {
    $t = Get-ScheduledTask -TaskPath $TaskPath -TaskName $n
    $newActions = foreach ($a in $t.Actions) {
        New-ScheduledTaskAction `
            -Execute ($a.Execute   -replace [regex]::Escape($OldRoot), $NewRoot) `
            -Argument ($a.Arguments -replace [regex]::Escape($OldRoot), $NewRoot)
    }
    Set-ScheduledTask -TaskPath $TaskPath -TaskName $n -Action $newActions | Out-Null
    Write-Host ("  [ ok ] {0}" -f $n) -ForegroundColor Green
}

# --- 5b. Repoint the per-machine skill junction --------------------------------
# .claude\skills\cronsole is a JUNCTION, and a junction stores its target as an
# ABSOLUTE path -- so the rename leaves it aimed at a folder that no longer exists.
# Claude Code then loads no cronsole skill at all, and says nothing, because a
# dangling junction is not an error: it is an absence. Exactly the silent-breakage
# shape this whole script exists to prevent, which is why it belongs here rather
# than in a "don't forget to..." note. setup-skill-links.ps1 derives every path from
# its own location, so running the copy at the NEW root is the repoint; it is
# idempotent and needs no elevation.
$relink = Join-Path $NewRoot 'scripts\setup-skill-links.ps1'
if (Test-Path $relink) {
    Write-Host 'Repointing the skill junction...' -ForegroundColor Cyan
    & pwsh -NoProfile -File $relink 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
} else {
    Write-Host '  [warn] setup-skill-links.ps1 not found -- relink the skills by hand' -ForegroundColor Yellow
}

# --- 6. Re-enable --------------------------------------------------------------
foreach ($n in $TaskNames) {
    Enable-ScheduledTask -TaskPath $TaskPath -TaskName $n -ErrorAction SilentlyContinue | Out-Null
}

# --- 7. Verify by ASKING Task Scheduler, not by trusting the above -------------
Write-Host ''
Write-Host 'Verification (read back from Task Scheduler):' -ForegroundColor Cyan
$bad = 0
foreach ($n in $TaskNames) {
    $t = Get-ScheduledTask -TaskPath $TaskPath -TaskName $n -ErrorAction SilentlyContinue
    if (-not $t) { Write-Host ("  [MISS] {0}" -f $n) -ForegroundColor Red; $bad++; continue }

    $args = ($t.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments)" }) -join ' '
    $stale = $args -like "*$OldRoot*"
    $fresh = $args -like "*$NewRoot*"
    # The action can point at a path that does not exist, and Task Scheduler will
    # not care -- so check the files too. That is the difference between "the task
    # was updated" and "the task will work".
    $missing = @($t.Actions | ForEach-Object {
        if ($_.Arguments -match '"([^"]+\.(ps1|vbs))"') { $matches[1] }
    } | Where-Object { $_ -and -not (Test-Path $_) })

    if ($stale -or -not $fresh -or $missing.Count -gt 0 -or $t.State -eq 'Disabled') {
        Write-Host ("  [FAIL] {0}  stale={1} fresh={2} state={3} missingFiles={4}" -f `
            $n, $stale, $fresh, $t.State, ($missing -join ',')) -ForegroundColor Red
        $bad++
    } else {
        Write-Host ("  [ ok ] {0}  state={1}, targets exist" -f $n, $t.State) -ForegroundColor Green
    }
}

# Verify the junction by RESOLVING it, not by Test-Path on the link itself: a
# dangling junction is still a directory entry, so the naive check is how an absence
# passes for a presence. Ask where it points and whether that exists.
$link = Join-Path $NewRoot '.claude\skills\cronsole'
$li   = Get-Item $link -Force -ErrorAction SilentlyContinue
if (-not $li -or -not $li.LinkType) {
    Write-Host '  [warn] .claude\skills\cronsole is not a link -- run scripts\setup-skill-links.ps1' -ForegroundColor Yellow
} else {
    $tgt = @($li.Target)[0]
    if ($tgt -and (Test-Path $tgt)) {
        Write-Host ("  [ ok ] skill junction -> {0}" -f $tgt) -ForegroundColor Green
    } else {
        Write-Host ("  [FAIL] skill junction dangles -> {0}" -f $tgt) -ForegroundColor Red
        $bad++
    }
}

Write-Host ''
if ($bad -gt 0) {
    Write-Error "$bad task(s) did not verify. Fix before rebooting -- logon start is what breaks."
    exit 1
}
Write-Host 'All tasks repointed and verified.' -ForegroundColor Green
Write-Host ''
Write-Host 'Next:' -ForegroundColor Cyan
Write-Host ("  1. cd {0}" -f $NewRoot)
Write-Host  '  2. pwsh scripts\cronsole.ps1 up'
Write-Host  '  3. pwsh scripts\cronsole.ps1 status   # expect ALL UP'
Write-Host  '  4. Confirm the dashboard still lists your tasks (the docker volume did not move).'
Write-Host ''
