# setup-skill-links.ps1 -- Windows
#
# Recreate the per-machine links Claude Code uses to read the skills that live
# (canonically, git-tracked) at the repo-root skills/. The links sit under
# .claude/skills/<name>. Run once per fresh clone. Idempotent; safe to re-run.
#
# Junctions need no admin rights or Developer Mode, and the agent reads through
# them transparently. Skills already present in .claude/skills/ that do NOT exist
# under repo-root skills/ are left untouched -- this only manages the <name>s
# that exist in both places.
#
# IMPORTANT (differs from sibling repos): AI-Automation-Library gitignores its
# whole CLIs/ tree, so its links can never be committed. taskhub TRACKS
# .claude/skills/ (the pre-existing installed skills are committed there), so a
# junction here WOULD be walked by git and its content committed a SECOND time --
# once at skills/<name>/ and again at .claude/skills/<name>/. Every linked <name>
# must therefore be gitignored. This script verifies that and warns if it isn't.
#
# Keep this file pure ASCII -- see docs/troubleshooting/README.md entry #6
# (Windows PowerShell 5.1 misparses non-ASCII chars in BOM-less UTF-8 scripts).

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path   # scripts/ -> repo root
$skillsDir = Join-Path $repo "skills"
if (-not (Test-Path $skillsDir)) { throw "No skills/ directory at $skillsDir" }

# Each agent's skills directory (relative to the repo root). Add a row here if
# another CLI is ever wired into this repo.
$cliSkillDirs = @(
    ".claude\skills"    # Claude Code
)

# Only link real skills (a SKILL.md defines one). Skips reference folders and any
# other non-skill dirs that might sit under skills/.
$names = (Get-ChildItem $skillsDir -Directory |
    Where-Object { Test-Path (Join-Path $_.FullName 'SKILL.md') }).Name

if (-not $names) { throw "No skills (folders with a SKILL.md) found under $skillsDir" }

$linked = @()

foreach ($rel in $cliSkillDirs) {
    $base = Join-Path $repo $rel
    New-Item -ItemType Directory -Force $base | Out-Null
    foreach ($name in $names) {
        $link = Join-Path $base $name
        $target = Join-Path $skillsDir $name
        $item = Get-Item $link -Force -ErrorAction SilentlyContinue
        if ($item) {
            if ($item.LinkType) {
                (Get-Item $link -Force).Delete()   # remove the existing junction/symlink only
            } else {
                Write-Warning "$rel\$name is a real directory (not a link) -- skipping. Remove it manually to relink."
                continue
            }
        }
        New-Item -ItemType Junction -Path $link -Target $target | Out-Null
        Write-Host "linked $rel\$name -> skills\$name"
        $linked += "$rel\$name"
    }
}

# Guard the double-commit hazard described in the header. A junction git can see
# is a junction git will commit through.
$unignored = @()
foreach ($rel in $linked) {
    & git -C $repo check-ignore -q -- $rel 2>$null
    if ($LASTEXITCODE -ne 0) { $unignored += $rel }
}

if ($unignored) {
    Write-Host ""
    Write-Warning @"
These links are NOT gitignored, so git will follow them and commit the skill
content twice (once under skills/, again under .claude/skills/):

$($unignored -join "`n")

Add each to .gitignore, e.g.:

$($unignored | ForEach-Object { '/' + ($_ -replace '\\','/') + '/' } | Out-String)
"@
} else {
    Write-Host ""
    Write-Host "All links are gitignored -- no double-commit risk." -ForegroundColor Green
}
