<h1 align="center">📡 Publishing the Template Registry</h1>

<p align="center">
  <em>How the hosted catalog gets from <code>bundled.ts</code> to other people's machines — and the one secret that makes it automatic.</em>
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

## One-time setup: the deploy key

The **Publish registry** workflow pushes to a *different* repository than the one it runs in, so the
default `GITHUB_TOKEN` cannot help it. It needs a key with write access to `cronsole-registry`.

Use a **deploy key**, not a personal access token. A deploy key is scoped to exactly one repository,
so a leak reaches that repo and nothing else; a PAT carries your whole account.

1. **Generate a keypair** (no passphrase — the runner is non-interactive):

   ```bash
   ssh-keygen -t ed25519 -N "" -C "cronsole registry publish" -f registry-deploy-key
   ```

2. **Add the public half to the target repo.** In `michaelschecht/cronsole-registry` →
   *Settings → Deploy keys → Add deploy key*. Title it `cronsole publish workflow`, paste
   `registry-deploy-key.pub`, and **tick "Allow write access"** — without it the push fails at the
   last step with a permission error that reads like a bad key.

3. **Add the private half to the source repo.** In `michaelschecht/cronsole` →
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
| Daily at 13:10 UTC | **Registry drift** fetches the live `index.json` and compares ids and `sha256`s against the committed `registry/`. Fails if the host is behind, ahead, or different. |
| You, manually | `pwsh scripts/publish-registry.ps1` — the out-of-band path, and what you reach for when the workflow is broken. Idempotent, so running it after the workflow is a no-op. |

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
