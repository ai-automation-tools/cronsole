<#
.SYNOPSIS
    Publish the gallery as TaskHub's public front door (taskhub.mikesailab.com).

.DESCRIPTION
    TaskHub used to have two public pages: a marketing landing page at
    taskhub.mikesailab.com and the template gallery at mikesailab.com/taskhub-registry.
    Two front doors saying overlapping things. The landing page was retired on
    2026-07-28 and the gallery took over that domain, with the landing page's
    product pitch, quick start, and project links merged into its Home view.

    So this script publishes the SAME registry-site/index.html that
    publish-registry.ps1 does — to a second host.

    Why the registry itself does NOT move
    -------------------------------------
    The registry JSON stays at https://mikesailab.com/taskhub-registry/. That URL
    is the documented TEMPLATE_REGISTRY_URL that installed TaskHubs already fetch
    their catalog from; moving it would break catalog sync for every existing
    install, and the content-addressed pack/template paths with it. Only the
    *page* is served from the new domain — it detects that index.json is not
    beside it and falls back to the canonical registry origin (GitHub Pages sends
    Access-Control-Allow-Origin: *, so the cross-origin fetch is allowed).

    What this script does NOT touch
    -------------------------------
    CNAME, README.md and .nojekyll in the target repo are left alone. CNAME in
    particular is now owned by the public repo rather than mirrored from here:
    it is infrastructure (which domain this repo answers on), not content, and
    overwriting or dropping it would take the custom domain down.

.EXAMPLE
    pwsh scripts/publish-frontdoor.ps1
#>

[CmdletBinding()]
param(
    [string]$SiteRepoUrl = 'https://github.com/michaelschecht/taskhub-site.git',
    # The local reference clone doubles as the publish working clone, so every publish
    # leaves it updated to the pushed state. It's a pure mirror — this script runs
    # `git reset --hard origin/main` on it, so never keep manual work here.
    [string]$WorkDir = $(
        $tools = 'D:\AI_Agents\Projects\Mikes_AI_Lab\Repos\Tools\taskhub-site'
        if (Test-Path (Join-Path $tools '.git')) { $tools } else { Join-Path $env:TEMP 'taskhub-site-publish' }
    )
)

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Definition)
$SrcFile = Join-Path $RepoRoot 'registry-site\index.html'
if (-not (Test-Path $SrcFile)) {
    throw "No registry-site/index.html at $SrcFile."
}

if (Test-Path (Join-Path $WorkDir '.git')) {
    Write-Host "Refreshing clone at $WorkDir" -ForegroundColor Cyan
    git -C $WorkDir fetch --quiet origin
    git -C $WorkDir reset --hard --quiet origin/main
} else {
    Write-Host "Cloning $SiteRepoUrl -> $WorkDir" -ForegroundColor Cyan
    if (Test-Path $WorkDir) { Remove-Item -Recurse -Force $WorkDir }
    git clone --quiet $SiteRepoUrl $WorkDir
}

# The custom domain lives or dies by this file, and it is not mirrored from the
# source repo — so check it survived the reset rather than discovering the
# domain is down after the fact.
$cname = Join-Path $WorkDir 'CNAME'
if (-not (Test-Path $cname)) {
    Write-Warning "No CNAME in $WorkDir - taskhub.mikesailab.com will NOT serve this. Restore it before relying on the custom domain."
} else {
    Write-Host ("Custom domain: " + (Get-Content $cname -Raw).Trim()) -ForegroundColor DarkGray
}

Copy-Item $SrcFile (Join-Path $WorkDir 'index.html') -Force

git -C $WorkDir add -A
if ((git -C $WorkDir status --porcelain).Length -eq 0) {
    Write-Host 'Front door already up to date - nothing to publish.' -ForegroundColor Green
    return
}

$stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
git -C $WorkDir commit --quiet -m "Publish front door ($stamp)"
git -C $WorkDir push --quiet origin main

$liveUrl = if (Test-Path $cname) { 'https://' + (Get-Content $cname -Raw).Trim() } else { 'https://mikesailab.com/taskhub-site/' }
Write-Host "Published. GitHub Pages will rebuild shortly ($liveUrl)." -ForegroundColor Green
