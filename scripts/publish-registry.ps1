<#
.SYNOPSIS
    Publish the template registry and the gallery page to Cronsole's public host,
    ai-automation-tools/cronsole-site (https://cronsole.ai-automation-tools.dev/).

.DESCRIPTION
    Source of truth is <cronsole>/registry/ (generated from
    backend/src/catalog/bundled.ts via `npm run registry:build` and drift-tested)
    plus <cronsole>/registry-site/ (the one public page). This script makes a
    FRESH clone of the org site repo in %TEMP%, mirrors both into it, and pushes.
    GitHub Pages then serves index.json + templates/ + packs/ beside index.html.

    Idempotent: if nothing changed, it makes no commit. It does NOT regenerate the
    registry -- run `npm run registry:build` (in backend/) and commit registry/ in
    the main repo first, so the two stay in lockstep.

    This normally runs itself: the "Publish registry + front door" workflow
    (publish-registry.yml) does the same mirroring on every merge to main that
    touches registry/ or registry-site/. This script is the manual path -- for
    publishing out of band, and for when the workflow is broken.

    History: until 2026-10-23 the registry was mirrored to the personal repo
    michaelschecht/cronsole-registry (mikesailab.com/cronsole-registry/) and the
    page to the org site by a second script, publish-frontdoor.ps1. Both are
    gone. The personal repo is an archived, frozen snapshot; this script refuses
    any target other than the org repo, and it always clones fresh rather than
    reusing CRONSOLE_REGISTRY_CLONE, which on most machines still points at the
    old personal clone.

    What this script does NOT touch: CNAME, README.md and .gitattributes in the
    target. They are infrastructure owned by the public repo, not content.

.EXAMPLE
    pwsh scripts/publish-registry.ps1
#>

[CmdletBinding()]
param(
    [string]$SiteRepoUrl = 'https://github.com/ai-automation-tools/cronsole-site.git',
    # Publish whatever is checked out, even when it is not up-to-date main. For
    # deliberately publishing a branch; never the routine path.
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

if ($SiteRepoUrl -notmatch 'ai-automation-tools/cronsole-site(\.git)?$') {
    throw "Refusing to publish to '$SiteRepoUrl'. The registry and the gallery are published to ai-automation-tools/cronsole-site only; michaelschecht/cronsole-registry is an archived snapshot (2026-10-23)."
}

$RepoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Definition)

# This publishes registry/ and registry-site/ from the WORKING TREE, and nothing
# about the run says which commit that is. On a feature branch, or a working
# branch behind main, it will republish an older catalog over a newer one and
# print "Published." like any other day (troubleshooting #68). The artifact is
# content-addressed, so the result is not corrupt -- it is confidently,
# verifiably wrong, which is the harder kind to notice.
if (-not $Force) {
    $branch = "$(git -C $RepoRoot rev-parse --abbrev-ref HEAD)".Trim()
    git -C $RepoRoot fetch --quiet origin main
    $behind = [int]"$(git -C $RepoRoot rev-list --count HEAD..origin/main)".Trim()

    if ($branch -ne 'main') {
        throw "Refusing to publish from branch '$branch'. The registry is published from main -- the only branch whose registry/ has passed the drift test in CI. Check out main, or pass -Force to publish this branch deliberately."
    }
    if ($behind -gt 0) {
        throw "Refusing to publish: HEAD is $behind commit(s) behind origin/main, so registry/ here may be older than what is merged. Run 'git pull' first, or pass -Force."
    }
}

$SrcDir = Join-Path $RepoRoot 'registry'
$SiteDir = Join-Path $RepoRoot 'registry-site'
if (-not (Test-Path (Join-Path $SrcDir 'index.json'))) {
    throw "No registry/index.json at $SrcDir -- run 'npm run registry:build' in backend/ first."
}
foreach ($dir in @('templates', 'packs')) {
    if (-not (Test-Path (Join-Path $SrcDir $dir))) {
        throw "No registry/$dir/ -- the index would reference paths that 404. Run 'npm run registry:build' first."
    }
}
if (-not (Test-Path (Join-Path $SiteDir 'index.html'))) {
    throw "No registry-site/index.html -- the front door would 404."
}

# Always a fresh clone: no stale working clone, and no chance of an old env var
# steering the push at the archived personal repo.
$WorkDir = Join-Path $env:TEMP 'cronsole-site-publish'
if (Test-Path $WorkDir) { Remove-Item -Recurse -Force $WorkDir }
Write-Host "Cloning $SiteRepoUrl -> $WorkDir" -ForegroundColor Cyan
git clone --quiet $SiteRepoUrl $WorkDir

# The custom domain is now also TEMPLATE_REGISTRY_URL, so a missing CNAME breaks
# catalog sync for opted-in installs, not just a page.
$cname = Join-Path $WorkDir 'CNAME'
if (-not (Test-Path $cname)) {
    throw "No CNAME in the cronsole-site clone -- cronsole.ai-automation-tools.dev would not serve this. Restore it in that repo first."
}
# Registry files are content-addressed: sha256 over exact bytes. If the target
# stops pinning JSON to LF, a Windows clone would CRLF them and break every
# checksum, so check rather than trust.
$eol = "$(git -C $WorkDir check-attr eol -- index.json)".Trim()
if ($eol -notmatch ': lf$') {
    throw "cronsole-site's .gitattributes does not pin index.json to LF ('$eol'). Add '*.json text eol=lf' there first."
}

# Registry data: replace index.json + templates/ + packs/ wholesale, so a removed
# template or pack disappears. Nothing else in the target is touched.
Copy-Item (Join-Path $SrcDir 'index.json') (Join-Path $WorkDir 'index.json') -Force
foreach ($dir in @('templates', 'packs')) {
    $dst = Join-Path $WorkDir $dir
    if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
    Copy-Item (Join-Path $SrcDir $dir) $dst -Recurse
}

# Gallery page: every flat file, minus the two the target owns.
# NB: the wildcard path (...\*) is required -- `Get-ChildItem -Path <dir> -Exclude`
# on a bare directory silently returns nothing.
Get-ChildItem -Path (Join-Path $SiteDir '*') -File -Exclude 'README.md', 'CNAME' | ForEach-Object {
    Copy-Item $_.FullName (Join-Path $WorkDir $_.Name) -Force
}

git -C $WorkDir add -A
if ((git -C $WorkDir status --porcelain).Length -eq 0) {
    Write-Host 'cronsole-site already up to date -- nothing to publish.' -ForegroundColor Green
    return
}

$stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
git -C $WorkDir commit --quiet -m "Publish registry + front door ($stamp)"
git -C $WorkDir push --quiet origin main
Write-Host ("Published. GitHub Pages will rebuild shortly (https://" + (Get-Content $cname -Raw).Trim() + "/).") -ForegroundColor Green
