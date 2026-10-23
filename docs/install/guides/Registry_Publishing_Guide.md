<h1 align="center">📡 Publishing the Registry and the Front Door</h1>

<p align="center">
  <em>How the hosted catalog and the public gallery page reach other people's machines — and the one secret that makes it automatic.</em>
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
ai-automation-tools/cronsole-site   public mirror (gallery page + registry JSON)
        ↓  GitHub Pages
https://cronsole.ai-automation-tools.dev/
```

Two things follow from the shape:

**`registry/` is generated output, not a source.** Never hand-edit anything under it. The files are
content-addressed — each `sha256` in `index.json` is computed over the file's exact bytes — so a
one-character edit invalidates the checksum. `.gitattributes` pins them to LF for the same reason,
here **and** in `cronsole-site` (`* text eol=lf`); the publish job refuses to run if the target
stops pinning JSON to LF.

**The public repo is a mirror, not a place to work.** The workflow replaces `index.json`,
`templates/` and `packs/` wholesale and copies the page files over the top; the manual script
works in a fresh `%TEMP%` clone. A pull request opened against `cronsole-site` would be erased by
the next publish. `README.md`, `CNAME` and `.gitattributes` belong to that repo and are never
touched.

## One host since 2026-10-23

`https://cronsole.ai-automation-tools.dev/` (repo `ai-automation-tools/cronsole-site`) serves the
gallery page **and** the registry beside it — `index.json`, `templates/`, `packs/`. The page reads
`./index.json` same-origin; its `REGISTRY_BASE` fallback points at the same host, for a copy of the
page served somewhere without the JSON.

**That URL is the registry base, and it is frozen there.** It is what `TEMPLATE_REGISTRY_URL` should
name. The catalog URL moving breaks sync for every install that opted in, silently, on a schedule
nobody watches — GitHub does not redirect Pages paths — so this move was made once, deliberately,
and the old address was kept alive rather than redirected:

| Retired host | Repo | State |
|:---|:---|:---|
| `https://mikesailab.com/cronsole-registry/` | `michaelschecht/cronsole-registry` | **Archived frozen snapshot** of the registry and gallery as of 2026-10-23. Still served (archiving keeps Pages up), never updated. Kept only so pre-2026-10-23 opted-in installs do not 404 — they should update `TEMPLATE_REGISTRY_URL` to the new base. |
| `https://cronsole.mikesailab.com/` | `michaelschecht/cronsole-site` | Retired 2026-10-23; redirects to the org site. |

Nothing here publishes to either, and neither is checked. Do not add them back as targets.

> [!NOTE]
> The page comparison is **LF-normalized**, and `registry-site/**` is pinned `text eol=lf`. A CRLF
> working tree makes the identical commit pass on a Linux runner and fail on a Windows machine, and
> makes a manual publish copy different bytes than CI does — see
> [troubleshooting #69](../../troubleshooting/README.md#69-a-published-page-check-reports-both-hosts-stale-and-they-are-not).

## One-time setup: the deploy key

The publish workflow pushes to a *different* repository than the one it runs in, so the default
`GITHUB_TOKEN` cannot help. It needs a deploy key:

| Secret on `cronsole` | Deploy key on | Used by |
|:---|:---|:---|
| `SITE_ORG_DEPLOY_KEY` | `ai-automation-tools/cronsole-site` | Publish registry + front door |
| `DEMO_DEPLOY_KEY` | `ai-automation-tools/cronsole-demo` | Publish demo |

> [!NOTE]
> **Deploy keys are disabled by default on the org**, which is why the org targets needed that
> policy turned on (*Organization settings → Repository → Deploy keys*). **Publish registry + front
> door fails** when `SITE_ORG_DEPLOY_KEY` is missing — it is the only public host, so a missing key
> is an outage. **Publish demo** still skips with a notice when `DEMO_DEPLOY_KEY` is absent.
> `REGISTRY_DEPLOY_KEY` (for the archived `michaelschecht/cronsole-registry`) and `SITE_DEPLOY_KEY`
> (for the retired `michaelschecht/cronsole-site`) are no longer read by any workflow and can be
> deleted.

Use a **deploy key**, not a personal access token. A deploy key is scoped to exactly one repository,
so a leak reaches that repo and nothing else; a PAT carries your whole account.

1. **Generate a keypair** (no passphrase — the runner is non-interactive):

   ```bash
   ssh-keygen -t ed25519 -N "" -C "cronsole site publish" -f site-deploy-key
   ```

2. **Add the public half to the target repo.** In `ai-automation-tools/cronsole-site` →
   *Settings → Deploy keys → Add deploy key*. Title it `cronsole publish workflow`, paste
   `site-deploy-key.pub`, and **tick "Allow write access"** — without it the push fails at the
   last step with a permission error that reads like a bad key.

3. **Add the private half to the source repo.** In `ai-automation-tools/cronsole` →
   *Settings → Secrets and variables → Actions → New repository secret*. Name it exactly
   **`SITE_ORG_DEPLOY_KEY`** and paste the entire contents of `site-deploy-key`, including the
   `-----BEGIN OPENSSH PRIVATE KEY-----` and `-----END …-----` lines and the trailing newline.

4. **Delete both local files.** They have served their purpose and are now two copies of a
   credential sitting in a directory.

   ```bash
   rm site-deploy-key site-deploy-key.pub
   ```

5. **Verify** — *Actions → Publish registry + front door → Run workflow*. With nothing to publish it
   should report `cronsole-site already up to date -- nothing to publish.` and pass. That is a real
   proof: it authenticated, cloned the target, and compared.

## What runs when

| Trigger | What happens |
|:---|:---|
| Merge to `main` touching `registry/**` or `registry-site/**` | **Publish registry + front door** — one job — checks the target still has its `CNAME` and its LF pin, replaces `index.json` + `templates/` + `packs/` wholesale, copies the page files, commits only if something changed, and pushes. Pages rebuilds within a minute or two. |
| Daily at 13:10 UTC | **Registry drift** fetches the live `index.json` and compares ids and `sha256`s against the committed `registry/`. Fails if the host is behind, ahead, or different. |
| Daily at 13:20 UTC | **Front door drift** compares sha256 over the served page against the committed `registry-site/index.html`. |
| You, manually | `pwsh scripts/publish-registry.ps1` — the out-of-band path, and what you reach for when the workflow is broken. Idempotent, so running it after the workflow is a no-op. |

**One job, not two.** Until 2026-10-23 the registry and the page went to different repos from
different workflows. Now both write `cronsole-site`, and two jobs pushing one branch race — the
loser's push is rejected, or each wholesale copy is computed from a tree the other is about to
change. One checkout, one commit.

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

Then look at *Actions → Publish registry + front door* for the merge that should have published. If the run is
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
- **The public gallery is the real casualty.** `https://cronsole.ai-automation-tools.dev/` is where
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
