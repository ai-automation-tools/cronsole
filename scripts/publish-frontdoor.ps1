<#
.SYNOPSIS
    Publish the gallery as Cronsole's public front door (cronsole.mikesailab.com).

.DESCRIPTION
    Cronsole used to have two public pages: a marketing landing page at
    taskhub.mikesailab.com and the template gallery at mikesailab.com/taskhub-registry
    (the names of the day — the product was still called TaskHub).
    Two front doors saying overlapping things. The landing page was retired on
    2026-07-28 and the gallery took over that domain, with the landing page's
    product pitch, quick start, and project links merged into its Home view.
    Rename stage 3 then moved both on 2026-07-31: the gallery to
    mikesailab.com/cronsole-registry, and this front door to cronsole.mikesailab.com.

    So this script publishes the SAME registry-site/index.html that
    publish-registry.ps1 does — to a second host.

    Why the registry lives at its own URL
    -------------------------------------
    The registry JSON is served from https://mikesailab.com/cronsole-registry/,
    the documented TEMPLATE_REGISTRY_URL that installed Cronsoles fetch their
    catalog from. It is deliberately NOT on this front door's domain: the two
    have different jobs and different blast radii. A page can move and the worst
    case is a bad link; the catalog URL moving breaks sync for every install,
    silently, on a schedule nobody is watching.

    That URL was itself renamed on 2026-07-31 (taskhub-registry ->
    cronsole-registry) as rename stage 3. It was safe precisely once: with
    TEMPLATE_REGISTRY_URL commented out everywhere, there were zero installs
    fetching it, so the old path 404-ing cost nothing. GitHub redirects a renamed
    repo's *git* URLs indefinitely but NOT its Pages paths — so the same move
    after the first real install would have been an unannounced outage. Treat the
    URL as frozen from here on.

    Only the *page* is served from both hosts — it detects that index.json is not
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
    [string]$SiteRepoUrl = 'https://github.com/michaelschecht/cronsole-site.git',
    # The local reference clone doubles as the publish working clone, so every publish
    # leaves it updated to the pushed state. It's a pure mirror — this script runs
    # `git reset --hard origin/main` on it, so never keep manual work here.
    [string]$WorkDir = $(
        $tools = 'D:\AI_Agents\Projects\Mikes_AI_Lab\Repos\Tools\cronsole-site'
        if (Test-Path (Join-Path $tools '.git')) { $tools } else { Join-Path $env:TEMP 'cronsole-site-publish' }
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
    Write-Warning "No CNAME in $WorkDir - cronsole.mikesailab.com will NOT serve this. Restore it before relying on the custom domain."
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

$liveUrl = if (Test-Path $cname) { 'https://' + (Get-Content $cname -Raw).Trim() } else { 'https://mikesailab.com/cronsole-site/' }
Write-Host "Published. GitHub Pages will rebuild shortly ($liveUrl)." -ForegroundColor Green
