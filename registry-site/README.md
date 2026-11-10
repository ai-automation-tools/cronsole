# registry-site/ — Cronsole's homepage and template gallery

Source of truth for **Cronsole's public homepage**, served at
**`https://cronsole.ai-automation-tools.dev/`**, beside the registry JSON it reads (since
2026-10-23 that host serves the registry too; `mikesailab.com/cronsole-registry/` is an archived
frozen snapshot, and the old `cronsole.mikesailab.com` redirects to the org site). Since 2026-10-19 the page
leads with the product, not the registry: the hero's primary button opens the live demo
(`https://cronsole-demo.ai-automation-tools.dev/`), the second jumps to the **Template registry**
section, the third goes to GitHub. The browse-and-import gallery below is unchanged. Every outbound
URL the page builds lives in the `LINKS` object in its script.

It's a single self-contained `index.html` (inline CSS + vanilla JS, no build step, no external
CDN/fonts — offline-capable and CSP-safe) with a **hash-router** (works on GitHub Pages,
deep-linkable). It fetches the registry's `index.json` from the **same origin** and drives four
views:

- **Home** (`#/`) — product hero (demo, template registry, GitHub), why Cronsole, quick start, then the
  **Template registry** section: live stat strip, curated **collections** (Script Starters,
  Developer Pack, AI & Agents, Backup & Cleanup, Monitoring), featured templates, and a "how
  importing works" band. Collection membership is read from `index.json`'s **`packs[]`** — it is
  *declared*, never inferred from tag predicates, because a collection is a downloadable file that
  lands in someone's catalog and tagging an unrelated template must not silently change what it
  holds. *(This line read "derived from the data" until 2026-08-17, describing the tag-predicate
  behaviour that packs replaced.)*
- **Browse** (`#/browse`) — a sticky **facet rail** (checkbox Category / Platform / Runtime with
  cross-faceted counts, tag cloud), search, sort, active-filter pills, and a card grid. The rail
  collapses to a drawer under 860px.
- **Collections** (`#/collections`, `#/collection/<key>`) — the curated bundles.
- **Template detail** (`#/t/<id>`, shareable) — humanized schedule, the **action rendered in its
  own shape**, parameter table, honest creatable-vs-manual targets, and related templates.

  `actionView()` picks that shape: a `commandTemplate` prints as a command, a **`script`** prints
  its body as code under the interpreter that runs it, and a **`check`** prints as the assertion it
  makes (`GET {{url}}` / `status must be 200–299` / `body must contain "…"`). Placeholders are
  highlighted in all of them. Two rules it must keep — both learned by getting them wrong:
  an **unrecognized** action kind falls back to raw JSON (a static page cannot ask anything what a
  new shape means, so guessing is the wrong failure), and a **partially readable** probe falls back
  too. `describeProbe` returns `null` rather than emitting a sentence that omits a field the
  backend honours — dropping `headers` turned an authenticated check into a bare `GET {{url}}`,
  which reads as complete and is not. Adding a field to `HttpProbe` obliges a line here.

## Other catalogs

The page also lists **Registry v1 catalogs other repos publish**, named in `EXTERNAL_SOURCES` in
the script (since 2026-11-10: `ai-automation-recipes`, served at
`https://ai-automation-recipes.ai-automation-tools.dev/registry/` by that repo's Homepage workflow,
and `edge-radar` and `edge-spectrum`, each served at `/registry/` on its Vercel site).
Each is fetched live from its own host, so a change there shows up here with no Cronsole release and
never touches `registry/`, `bundled.ts` or `catalogSync`. Their templates are import-only. The rules:

- **An external template is never Built-in.** `core` is forced false on load, and the detail page
  reads availability from the index entry, not the template file, so a catalog cannot claim a
  template ships with Cronsole.
- **Every entry and pack keeps the base it came from** (`_base`, `base`), so a download fetches the
  bytes that catalog published, not a same-named path on this host.
- **Cronsole's own catalog wins a collision** on a template or pack id, and the page states how many
  entries it skipped.
- **A catalog that fails to load is named, never hidden.** Home, Browse and Collections say it could
  not be loaded; Cronsole's own catalog renders as before. Only Cronsole's own `index.json` can fail
  the page.
- External templates carry an amber source badge, a *Catalog* facet appears once a second catalog
  has templates (`#/browse?source=<key>` deep-links it), the Home stat strip counts Cronsole's own
  catalog only, and Collections groups packs under a heading per catalog.

The whole picture, from each repo's build to your install, is the
[template catalogs diagram](../docs/diagrams/README.md#-template-catalogs). Front door drift
(`scripts/check-external-catalogs.mjs`) loads every listed catalog daily the way this page does: the
CORS header, every file's sha256, and no id that collides with Cronsole's. It also probes
every public org repo's homepage for `/registry/index.json` and **fails on a catalog this list does
not name**, so a new project's catalog cannot stay published and missing from the gallery.

To add a catalog: its host must serve `index.json`, `templates/` and `packs/` with
`Access-Control-Allow-Origin: *` (GitHub Pages does), its ids should not collide with Cronsole's,
and the entry needs `key`, `name`, `base`, `home` and a one-line `blurb`. To preview with a local
copy, serve it with that header and point `base` at it in a copy of the page.

Every template offers **Download JSON** and **Copy JSON**, which flow into the app's shipped
**Templates → Import** path (`POST /api/templates/import`). Aesthetic direction (since 2026-10-05): the org design
vocabulary shared with `ai-automation-tools.dev`, Edge-Radar and Edge Spectrum — `#060606` ground
with a dot grid, one hero glow, zinc surfaces, spotlight cards, a live orbit of the connected
platforms in the hero — with Cronsole's violet as the accent and the mark's emerald as the
"runnable" signal. Dark is the default, light is the toggle, and the page stays self-contained
(system font stacks, no CDN). A one-click "Add to my Cronsole" protocol handoff is a deliberate future
follow-up (roadmap part 3).

## How it ships

Like `registry/`, this folder is the **source of truth in this repo**; it is mirrored to the
public [`ai-automation-tools/cronsole-site`](https://github.com/ai-automation-tools/cronsole-site)
repo by the **Publish registry + front door** workflow on every merge to `main` (or by hand with
`scripts/publish-registry.ps1`), which copies every file here into the clone **root** (so
`index.html` sits next to the published `index.json`). GitHub Pages then serves the gallery.

- Edit the gallery here and merge to `main` — the same job publishes the registry JSON, so they
  ship together.
- The gallery uses **relative** fetches (`./index.json`, `./templates/<id>.json`), so it also
  works when served locally from a directory that contains both this `index.html` and a copy of
  the registry artifact.

## Local preview

```sh
# from the repo root — combine the gallery with the current registry artifact and serve
mkdir -p /tmp/gallery && cp registry-site/index.html /tmp/gallery/ \
  && cp registry/index.json /tmp/gallery/ && cp -r registry/templates /tmp/gallery/ \
  && cp -r registry/packs /tmp/gallery/
cd /tmp/gallery && python -m http.server 8791
# open http://localhost:8791/index.html
```

> **Re-copy `index.html` after every edit, and hard-reload — not a route change.** This preview
> serves a *copy*, and the gallery is a hash-router SPA, so navigating to the same `#/…` URL
> re-fetches nothing. Together they make a correct fix look like it failed; see
> [troubleshooting #64](../docs/troubleshooting/README.md#64-a-gallery-change-doesnt-show-up-in-the-local-preview).

> Do **not** hand-edit the published copy in the public repo — the next publish overwrites it.
> The registry JSON (`index.json`, `templates/*.json`) is generated; see `registry/README.md`.
