# landing-site/ — the TaskHub landing page

Source of truth for the **TaskHub landing page**.

- **Live now:** **`https://mikesailab.com/taskhub-site/`** (GitHub Pages project site).
- **Intended vanity URL:** `https://taskhub.mikesailab.com` — **deferred**, blocked on a DNS
  change (see *Activating the subdomain* below).

A single self-contained `index.html` (inline CSS + vanilla JS, no build step, no external
CDN/fonts) — a rich, dark, responsive landing page matching the template gallery's
"automation control catalog" aesthetic. It pitches TaskHub and links to the three public
pieces of the project:

1. **TaskHub app** → [`github.com/michaelschecht/taskhub`](https://github.com/michaelschecht/taskhub) (private until launch)
2. **Template registry** → [`github.com/michaelschecht/taskhub-registry`](https://github.com/michaelschecht/taskhub-registry)
3. **Template gallery** → [`mikesailab.com/taskhub-registry`](https://mikesailab.com/taskhub-registry/)

## How it ships

Like `registry-site/`, this folder is the **source of truth in this (private) repo**; it is
mirrored to the public **[`taskhub-site`](https://github.com/michaelschecht/taskhub-site)**
repo by `scripts/publish-landing.ps1`, which copies every file here (except this README) into
the clone root and pushes. GitHub Pages serves it.

- `index.html` — the page.
- `.nojekyll` — serve files raw (no Jekyll processing).
- (`CNAME` — the custom domain. **Intentionally absent for now** — see below. Add it back only
  once the subdomain DNS is repointed, or the site redirects to a dead target.)

Edit here, then `pwsh scripts/publish-landing.ps1` to publish.

## Activating the subdomain (`taskhub.mikesailab.com`)

**Blocker:** `taskhub.mikesailab.com` already has a DNS record pointing at **Vercel**
(`CNAME → cname.vercel-dns.com`), currently serving an empty Vercel 404. To move the subdomain
to this GitHub Pages site:

1. **Repoint DNS** on `mikesailab.com` — change the `taskhub` record from the Vercel target to:
   ```
   Type: CNAME    Host/Name: taskhub    Value: michaelschecht.github.io
   ```
   (Do this in the DNS provider that hosts `mikesailab.com`. Only the domain owner can.)
2. **Re-add the CNAME file:** `printf 'taskhub.mikesailab.com' > landing-site/CNAME`.
3. **Publish + set the domain:**
   ```sh
   pwsh scripts/publish-landing.ps1
   gh api -X PUT repos/michaelschecht/taskhub-site/pages -f cname=taskhub.mikesailab.com
   ```
   GitHub issues a TLS cert once DNS verifies, and the site is live at
   `https://taskhub.mikesailab.com`.

Until then the landing page lives at `https://mikesailab.com/taskhub-site/` (no DNS needed).

## Local preview

```sh
cd landing-site && python -m http.server 8793
# open http://localhost:8793/index.html
```
