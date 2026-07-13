<#
.SYNOPSIS
    Mirror the generated template registry to the public taskhub-registry repo.

.DESCRIPTION
    Source of truth is <taskhub>/registry/ (generated from
    backend/src/catalog/bundled.ts via `npm run registry:build` and drift-tested).
    This script copies that folder into a local clone of the separate public repo
    (github.com/michaelschecht/taskhub-registry) and pushes it. GitHub Pages then
    rebuilds and serves it at https://mikesailab.com/taskhub-registry.

    Idempotent: if nothing changed, it makes no commit. It does NOT regenerate the
    registry — run `npm run registry:build` (in backend/) and commit registry/ in
    the main repo first, so the two stay in lockstep.

.EXAMPLE
    pwsh scripts/publish-registry.ps1
#>

[CmdletBinding()]
param(
    [string]$RegistryRepoUrl = 'https://github.com/michaelschecht/taskhub-registry.git',
    # Persistent working clone so re-publishing doesn't re-clone every time.
    [string]$WorkDir = (Join-Path $env:TEMP 'taskhub-registry-publish')
)

$ErrorActionPreference = 'Stop'

# Main-repo registry/ (source of truth): repo root = two levels up from this script.
$RepoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Definition)
$SrcDir = Join-Path $RepoRoot 'registry'
if (-not (Test-Path (Join-Path $SrcDir 'index.json'))) {
    throw "No registry/index.json at $SrcDir — run 'npm run registry:build' in backend/ first."
}

# Clone or refresh the target repo.
if (Test-Path (Join-Path $WorkDir '.git')) {
    Write-Host "Refreshing clone at $WorkDir" -ForegroundColor Cyan
    git -C $WorkDir fetch --quiet origin
    git -C $WorkDir reset --hard --quiet origin/main
} else {
    Write-Host "Cloning $RegistryRepoUrl -> $WorkDir" -ForegroundColor Cyan
    if (Test-Path $WorkDir) { Remove-Item -Recurse -Force $WorkDir }
    git clone --quiet $RegistryRepoUrl $WorkDir
}

# Mirror the served content: replace index.json + templates/ wholesale (so a
# removed template disappears), refresh README. Leave .nojekyll / .gitattributes
# (they belong to the target repo, not the generated artifact).
Copy-Item (Join-Path $SrcDir 'index.json') (Join-Path $WorkDir 'index.json') -Force
$dstTemplates = Join-Path $WorkDir 'templates'
if (Test-Path $dstTemplates) { Remove-Item -Recurse -Force $dstTemplates }
Copy-Item (Join-Path $SrcDir 'templates') $dstTemplates -Recurse
Copy-Item (Join-Path $SrcDir 'README.md') (Join-Path $WorkDir 'README.md') -Force

git -C $WorkDir add -A
if ((git -C $WorkDir status --porcelain).Length -eq 0) {
    Write-Host 'Registry already up to date — nothing to publish.' -ForegroundColor Green
    return
}

$stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
git -C $WorkDir commit --quiet -m "Publish registry ($stamp)"
git -C $WorkDir push --quiet origin main
Write-Host 'Published. GitHub Pages will rebuild shortly (https://mikesailab.com/taskhub-registry).' -ForegroundColor Green
