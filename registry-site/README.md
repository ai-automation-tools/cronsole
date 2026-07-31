# registry-site/ — the public Template Gallery

Source of truth for the **Cronsole Template Gallery**, the browse-and-import site served at
**`https://mikesailab.com/cronsole-registry/`**.

It's a single self-contained `index.html` (inline CSS + vanilla JS, no build step, no external
CDN/fonts — offline-capable and CSP-safe) with a **hash-router** (works on GitHub Pages,
deep-linkable). It fetches the registry's `index.json` from the **same origin** and drives four
views:

- **Home** (`#/`) — editorial hero, live stat strip, curated **collections** (Script Starters,
  Developer Pack, AI & Agents, Backup & Cleanup, Monitoring — derived from the data), featured
  templates, and a "how importing works" band.
- **Browse** (`#/browse`) — a sticky **facet rail** (checkbox Category / Platform / Runtime with
  cross-faceted counts, tag cloud), search, sort, active-filter pills, and a card grid. The rail
  collapses to a drawer under 860px.
- **Collections** (`#/collections`, `#/collection/<key>`) — the curated bundles.
- **Template detail** (`#/t/<id>`, shareable) — humanized schedule, placeholder-highlighted
  command, parameter table, honest creatable-vs-manual targets, and related templates.

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
  && cp registry/index.json /tmp/gallery/ && cp -r registry/templates /tmp/gallery/
cd /tmp/gallery && python -m http.server 8791
# open http://localhost:8791/index.html
```

> Do **not** hand-edit the published copy in the public repo — the next publish overwrites it.
> The registry JSON (`index.json`, `templates/*.json`) is generated; see `registry/README.md`.
