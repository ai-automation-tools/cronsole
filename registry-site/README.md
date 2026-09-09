# registry-site/ — the public Template Gallery

Source of truth for the **Cronsole Template Gallery**, the browse-and-import site served at
**`https://mikesailab.com/cronsole-registry/`**.

It's a single self-contained `index.html` (inline CSS + vanilla JS, no build step, no external
CDN/fonts — offline-capable and CSP-safe) with a **hash-router** (works on GitHub Pages,
deep-linkable). It fetches the registry's `index.json` from the **same origin** and drives four
views:

- **Home** (`#/`) — editorial hero, live stat strip, curated **collections** (Script Starters,
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

Every template offers **Download JSON** and **Copy JSON**, which flow into the app's shipped
**Templates → Import** path (`POST /api/templates/import`). Aesthetic direction: a dark, textured
"automation control catalog" with a monospace-forward technical identity and a phosphor-green
"runnable" signal. A one-click "Add to my Cronsole" protocol handoff is a deliberate future
follow-up (roadmap part 3).

## How it ships

Like `registry/`, this folder is the **source of truth in this (private) repo**; it is mirrored
to the public [`cronsole-registry`](https://github.com/michaelschecht/cronsole-registry) repo by
`scripts/publish-registry.ps1`, which copies every file here into the clone **root** (so
`index.html` sits next to the published `index.json`). GitHub Pages then serves the gallery.

- Edit the gallery here, then `pwsh scripts/publish-registry.ps1` to publish (same command that
  publishes the registry JSON — they ship together).
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
