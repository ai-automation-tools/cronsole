<#
.SYNOPSIS
    Mirror the TaskHub landing site to the public taskhub-site repo.

.DESCRIPTION
    Source of truth is <taskhub>/landing-site/ (hand-authored). This script copies that
    folder into a local clone of the separate public repo
    (github.com/michaelschecht/taskhub-site) and pushes it. GitHub Pages then rebuilds and
    serves it at the custom domain in landing-site/CNAME (taskhub.mikesailab.com).

    Idempotent: if nothing changed, it makes no commit. Unlike the registry, the landing
    site owns ALL its files here (index.html, CNAME, .nojekyll), so the whole folder is
    mirrored — the public repo is a pure published mirror with no hand-maintained files.

.EXAMPLE
    pwsh scripts/publish-landing.ps1
#>

[CmdletBinding()]
param(
    [string]$SiteRepoUrl = 'https://github.com/michaelschecht/taskhub-site.git',
    # The local reference clone (see CLAUDE.md) doubles as the publish working clone, so every
    # publish leaves it updated to the pushed state. It's a pure mirror — this script runs
    # `git reset --hard origin/main` on it, so never keep manual work here. The clone owns its
    # own README.md (excluded from the mirror below). Falls back to a %TEMP% clone elsewhere.
    [string]$WorkDir = $(
        $tools = 'D:\AI_Agents\Projects\Mikes_AI_Lab\Repos\Tools\taskhub-site'
        if (Test-Path (Join-Path $tools '.git')) { $tools } else { Join-Path $env:TEMP 'taskhub-site-publish' }
    )
)

$ErrorActionPreference = 'Stop'

# Repo root = two levels up from this script; landing-site/ is the source of truth.
$RepoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Definition)
$SrcDir = Join-Path $RepoRoot 'landing-site'
if (-not (Test-Path (Join-Path $SrcDir 'index.html'))) {
    throw "No landing-site/index.html at $SrcDir."
}

# Clone or refresh the target repo.
if (Test-Path (Join-Path $WorkDir '.git')) {
    Write-Host "Refreshing clone at $WorkDir" -ForegroundColor Cyan
    git -C $WorkDir fetch --quiet origin
    git -C $WorkDir reset --hard --quiet origin/main
} else {
    Write-Host "Cloning $SiteRepoUrl -> $WorkDir" -ForegroundColor Cyan
    if (Test-Path $WorkDir) { Remove-Item -Recurse -Force $WorkDir }
    git clone --quiet $SiteRepoUrl $WorkDir
}

# Mirror every source file (index.html, CNAME, .nojekyll) into the clone root. README.md
# in landing-site/ is a dev folder-note; exclude it (the public repo owns its own README
# if it has one). Include dotfiles like .nojekyll.
Get-ChildItem -Path (Join-Path $SrcDir '*') -File -Force -Exclude 'README.md' | ForEach-Object {
    Copy-Item $_.FullName (Join-Path $WorkDir $_.Name) -Force
}

git -C $WorkDir add -A
if ((git -C $WorkDir status --porcelain).Length -eq 0) {
    Write-Host 'Landing site already up to date — nothing to publish.' -ForegroundColor Green
    return
}

$stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
git -C $WorkDir commit --quiet -m "Publish landing site ($stamp)"
git -C $WorkDir push --quiet origin main
# The served URL depends on whether a CNAME (custom domain) is deployed. Until the
# taskhub.mikesailab.com DNS is repointed off Vercel, landing-site/ ships without a CNAME
# and the site lives at the project URL. See landing-site/README.md › Activating the subdomain.
$liveUrl = if (Test-Path (Join-Path $WorkDir 'CNAME')) { 'https://' + (Get-Content (Join-Path $WorkDir 'CNAME') -Raw).Trim() } else { 'https://mikesailab.com/taskhub-site/' }
Write-Host "Published. GitHub Pages will rebuild shortly ($liveUrl)." -ForegroundColor Green
