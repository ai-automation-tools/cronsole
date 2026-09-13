<h1 align="center">📡 Publishing the Registry and the Front Door</h1>

<p align="center">
  <em>How the hosted catalog and the public gallery page reach other people's machines — and the two secrets that make it automatic.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/audience-maintainer-8B5CF6?style=for-the-badge" alt="Maintainer">
  <img src="https://img.shields.io/badge/setup-one_time-2ea44f?style=for-the-badge" alt="One-time setup">
</p>

---

Templates are authored in one repo and served from another. This guide covers the hop between
them: what runs automatically, the one-time secret it needs, and what to do when it breaks.

## The pipeline

```
backend/src/catalog/bundled.ts      the ONLY place a template is authored
        ↓  npm run registry:build   (in backend/)
<cronsole>/registry/                generated, committed, guarded by the drift test
        ↓  merge to main            → .github/workflows/publish-registry.yml
michaelschecht/cronsole-registry    public mirror
        ↓  GitHub Pages
https://mikesailab.com/cronsole-registry/
```

Two things follow from the shape:

**`registry/` is generated output, not a source.** Never hand-edit anything under it. The files are
content-addressed — each `sha256` in `index.json` is computed over the file's exact bytes — so a
one-character edit invalidates the checksum. `.gitattributes` pins them to LF for the same reason.

**The public repo is a mirror, not a place to work.** `scripts/publish-registry.ps1` runs
`git reset --hard origin/main` on its working clone, and the workflow replaces `index.json`,
`templates/` and `packs/` wholesale. A pull request opened against `cronsole-registry` would be
erased by the next publish. Everything else in that repo — `README.md`, `.nojekyll`,
`.gitattributes`, `docs/` — belongs to it and is never touched.

## The second surface: the gallery page

`registry-site/index.html` is **one page served from three hosts**:

| Host | Why it exists |
|:---|:---|
| `https://cronsole.ai-automation-tools.dev/` | The front door, on the org's own domain since 2026-09-13. |
| `https://cronsole.mikesailab.com/` | The **old** front door. Still served, not redirected — GitHub Pages cannot issue a 308, so every published link to it has to keep working the slow way. |
| `https://mikesailab.com/cronsole-registry/` | The same page, sitting beside the registry JSON it reads. |

The page is built to work at both: it tries `./index.json` first and falls back to the canonical
registry origin when it is not co-located (GitHub Pages sends `Access-Control-Allow-Origin: *`).

**The registry JSON is deliberately not on the front door's domain.** The two have different blast
radii. A page can move and the worst case is a bad link; the catalog URL moving breaks sync for
every install that opted in, silently, on a schedule nobody watches. That URL is frozen.

Two hosts means two publish paths, and for a long time two chances to forget one. The quiet failure
is specific: **whichever host you happen to open looks fine**, so the page can be badly stale at the
other address and nothing you do in a browser reveals it. Hence `frontdoor-drift.yml`, which
compares sha256 over the served bytes at *both* against the committed file.

> [!NOTE]
> The comparison is **LF-normalized**, and `registry-site/**` is pinned `text eol=lf`. A CRLF
> working tree makes the identical commit pass on a Linux runner and fail on a Windows machine, and
> makes a manual publish copy different bytes than CI does — see
> [troubleshooting #69](../../troubleshooting/README.md#69-a-published-page-check-reports-both-hosts-stale-and-they-are-not).

One asymmetry to know about: the **workflow** copies every flat file in `registry-site/`, while
`publish-frontdoor.ps1` copies `index.html` alone. Add a stylesheet and publish by hand, and it
reaches the registry host but not the front door. Publish through the workflow.

## One-time setup: the deploy keys

Both publish workflows push to a *different* repository than the one they run in, so the default
`GITHUB_TOKEN` cannot help either. Each needs its own key:

| Secret on `cronsole` | Deploy key on | Used by |
|:---|:---|:---|
| `REGISTRY_DEPLOY_KEY` | `michaelschecht/cronsole-registry` | Publish registry |
| `SITE_DEPLOY_KEY` | `michaelschecht/cronsole-site` | Publish front door (old host) |
| `SITE_ORG_DEPLOY_KEY` | `ai-automation-tools/cronsole-site` | Publish front door (new host) |
| `DEMO_DEPLOY_KEY` | `ai-automation-tools/cronsole-demo` | Publish demo |

> [!NOTE]
> **Deploy keys are disabled by default on the org**, which is why the first two targets are
> personal repos and why the org ones needed that policy turned on (*Organization settings →
> Repository → Deploy keys*). The two org-target jobs **skip with a notice** when their secret is
> absent rather than failing, unlike the two established jobs — a job that reddens every unrelated
> merge teaches people to ignore a red X.

Use a **deploy key**, not a personal access token. A deploy key is scoped to exactly one repository,
so a leak reaches that repo and nothing else; a PAT carries your whole account. Two keys rather than
one shared key, for the same reason: the front-door workflow has no business being able to write the
catalog.

The steps below are written for the registry key. Repeat them with `cronsole-site` and
`SITE_DEPLOY_KEY` for the front door.

1. **Generate a keypair** (no passphrase — the runner is non-interactive):

   ```bash
   ssh-keygen -t ed25519 -N "" -C "cronsole registry publish" -f registry-deploy-key
   ```

2. **Add the public half to the target repo.** In `michaelschecht/cronsole-registry` →
   *Settings → Deploy keys → Add deploy key*. Title it `cronsole publish workflow`, paste
   `registry-deploy-key.pub`, and **tick "Allow write access"** — without it the push fails at the
   last step with a permission error that reads like a bad key.

3. **Add the private half to the source repo.** In `ai-automation-tools/cronsole` →
   *Settings → Secrets and variables → Actions → New repository secret*. Name it exactly
   **`REGISTRY_DEPLOY_KEY`** and paste the entire contents of `registry-deploy-key`, including the
   `-----BEGIN OPENSSH PRIVATE KEY-----` and `-----END …-----` lines and the trailing newline.

4. **Delete both local files.** They have served their purpose and are now two copies of a
   credential sitting in a directory.

   ```bash
   rm registry-deploy-key registry-deploy-key.pub
   ```

5. **Verify** — *Actions → Publish registry → Run workflow*. With nothing to publish it should
   report `Registry already up to date -- nothing to publish.` and pass. That is a real proof: it
   authenticated, cloned the target, and compared.

> [!IMPORTANT]
> Until `REGISTRY_DEPLOY_KEY` exists, the workflow fails on its first step with an explicit message
> rather than failing obscurely at the push. That is deliberate — but it does mean **the secret
> should be in place before the workflow is merged**, or the first merge to `main` that touches
> `registry/` goes red.

## What runs when

| Trigger | What happens |
|:---|:---|
| Merge to `main` touching `registry/**` or `registry-site/**` | **Publish registry** mirrors the artifact and the gallery page to `cronsole-registry`, commits only if something changed, and pushes. Pages rebuilds within a minute or two. |
| Merge to `main` touching `registry-site/**` | **Publish front door** mirrors the same page to `cronsole-site`, after checking the target still has its `CNAME`. |
| Daily at 13:10 UTC | **Registry drift** fetches the live `index.json` and compares ids and `sha256`s against the committed `registry/`. Fails if the host is behind, ahead, or different. |
| Daily at 13:20 UTC | **Front door drift** compares sha256 over the page served at *both* hosts against the committed `registry-site/index.html`. |
| You, manually | `pwsh scripts/publish-registry.ps1` / `pwsh scripts/publish-frontdoor.ps1` — the out-of-band path, and what you reach for when a workflow is broken. Idempotent, so running one after the workflow is a no-op. |

A page change fires **both** publish workflows, because `registry-site/**` is in both path filters —
that is the point. A registry change fires only the first.

Publishing is queued, never cancelled (`concurrency: cancel-in-progress: false`). The mirror is a
wholesale replace, so two racing publishes could serve an older catalog than `main`; a cancelled
publish is just an unpublished one, which is the thing this exists to prevent.

## The manual script refuses more than it used to

`publish-registry.ps1` mirrors the **working tree**, and nothing about the run tells you which commit
that is. Run from a feature branch, or from a working branch behind `main`, and it will republish an
older catalog over a newer one and print `Published.` exactly as it does on a good day.

So it now checks first, and refuses when `HEAD` is not `main` or is behind `origin/main`:

```
Refusing to publish from branch 'mike_desktop'. The registry is published from main --
the only branch whose registry/ has passed the drift test in CI.
```

Pass `-Force` to publish a branch deliberately. There is no reason to reach for it in normal work.

## When something is wrong

**The gallery shows fewer templates than `main` has.** Run the check locally — it names exactly
what is missing and in which direction:

```bash
node scripts/check-registry-published.mjs
```

Then look at *Actions → Publish registry* for the merge that should have published. If the run is
absent, the path filter did not match; if it failed, read the first failing step.

**The check says the host serves a template that is no longer on `main`.** That is the more
dangerous direction — a URL that still works and should not. A publish fixes it, because the mirror
replaces `templates/` and `packs/` wholesale rather than merging into them.

**The check cannot reach the host at all.** That is reported as a failure, not a pass. An
unreachable registry is worth knowing about — installs that opted into `TEMPLATE_REGISTRY_URL` fall
back to their compiled-in snapshot, silently.

## Who a stale registry actually affects

Narrower than it sounds, and worth being precise about:

- **A default install is unaffected.** `TEMPLATE_REGISTRY_URL` is commented out in
  `backend/.env.example`, so `buildCatalogSource()` returns the compiled-in `bundled.ts`. Anyone
  installing from current `main` already has every template, published or not.
- **The public gallery is the real casualty.** `https://mikesailab.com/cronsole-registry/` is where
  people browse and import, and it reads `index.json` from that same origin. Stale registry, stale
  gallery.
- **Installs that opt in** sync on boot and every 30 minutes — but `catalogSync` auto-syncs only
  `core: true` rows, so extended templates reach a user by being browsed and imported, not by
  syncing.

Publish because the gallery is advertising a catalog it does not have.

---

<p align="center">
  <a href="../README.md">↩ Install docs</a> ·
  <a href="../../troubleshooting/README.md">Troubleshooting</a> ·
  <a href="../../../registry/README.md">registry/ folder notes</a>
</p>
