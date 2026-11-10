/**
 * Do the other repos' catalogs the gallery lists still load the way the gallery loads them?
 *
 * The gallery (registry-site/index.html) reads Cronsole's own catalog plus every entry in
 * EXTERNAL_SOURCES, live from each repo's host (since 2026-11-10). Each of those repos runs its
 * own drift check against its own main, but none of them can see the two things only this page
 * depends on: that its host still sends `Access-Control-Allow-Origin: *` (without it the browser
 * refuses the fetch and the page names the catalog as failed), and that none of its template ids
 * collides with one of Cronsole's (the gallery keeps Cronsole's entry and hides theirs).
 *
 * For every EXTERNAL_SOURCES entry in the committed page (Front door drift already proves the
 * served page is that page), this fetches index.json, checks the CORS header, hashes every
 * template and pack file against the sha256 in that index, and compares ids with registry/.
 * Cronsole's own catalog is registry-drift.yml's job, not this one's.
 *
 * Then the other direction (since 2026-11-10): a catalog the list does NOT name. It asks GitHub for
 * every public, unarchived repo in the org, and for each homepage probes <origin>/registry/index.json.
 * A Registry v1 index there that EXTERNAL_SOURCES does not list fails the run, so a new project's
 * catalog cannot sit published and unadvertised. A homepage that is down, or answers with anything but
 * a Registry v1 index (an SPA fallback page, a 404), is not a catalog and is skipped. Set GH_TOKEN to
 * lift GitHub's unauthenticated rate limit (the workflow passes its own token).
 *
 *   node scripts/check-external-catalogs.mjs
 *
 * Exit 0 = every listed catalog loads and no unlisted one exists. Exit 1 = a listed catalog does not
 * load, the list could not be read, an org homepage serves a catalog the list does not name, or the
 * org's repos could not be listed.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const page = readFileSync(join(root, 'registry-site', 'index.html'), 'utf8');
const ownIds = new Set(JSON.parse(readFileSync(join(root, 'registry', 'index.json'), 'utf8')).templates.map((t) => t.id));
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

const start = page.indexOf('var EXTERNAL_SOURCES');
const block = start < 0 ? '' : page.slice(start, page.indexOf('];', start));
const catalogs = [...block.matchAll(/key: "([^"]+)", name: "([^"]+)",\s*base: "([^"]+)"/g)].map(([, key, name, base]) => ({ key, name, base }));
// An empty list is a parse that stopped matching the page, not a gallery with no other catalogs.
if (!catalogs.length) {
  console.error('FAIL  could not read EXTERNAL_SOURCES from registry-site/index.html; update the pattern in this script');
  process.exit(1);
}

let failed = 0;
for (const c of catalogs) {
  const problems = [];
  let summary = '';
  try {
    const res = await fetch(c.base + 'index.json', { headers: { Origin: 'https://cronsole.ai-automation-tools.dev' } });
    if (!res.ok) throw new Error(`index.json answered HTTP ${res.status}`);
    const cors = res.headers.get('access-control-allow-origin');
    if (cors !== '*') problems.push(`Access-Control-Allow-Origin is ${cors ?? 'missing'}, not *; the browser will refuse it`);
    const index = await res.json();
    const entries = [...index.templates, ...(index.packs ?? [])];
    const bad = [];
    for (const e of entries) {
      const file = await fetch(c.base + e.path);
      if (!file.ok || sha(Buffer.from(await file.arrayBuffer())) !== e.sha256) bad.push(e.path);
    }
    if (bad.length) problems.push(`${bad.length} file(s) missing or not matching their sha256: ${bad.slice(0, 5).join(', ')}`);
    const clash = index.templates.map((t) => t.id).filter((id) => ownIds.has(id));
    if (clash.length) problems.push(`id(s) also in Cronsole's catalog, so the gallery hides them: ${clash.join(', ')}`);
    summary = `${index.templates.length} templates, ${index.packs?.length ?? 0} packs, ${entries.length - bad.length}/${entries.length} sha256 ok`;
  } catch (err) {
    problems.push(err.message);
  }
  if (problems.length) failed++;
  console.log(`${problems.length ? 'FAIL' : 'OK  '}  ${c.name}  ${c.base}  ${summary}`);
  for (const p of problems) console.log(`      ${p}`);
}
console.log(`\n${catalogs.length} external catalog(s) listed by the gallery, ${failed} failing.`);

// ── Discovery: an org homepage serving a catalog the list does not name ──
const ORG = 'ai-automation-tools';
const OWN_HOST = 'cronsole.ai-automation-tools.dev';
const listedHosts = new Set(catalogs.map((c) => new URL(c.base).host));
const ghHeaders = { Accept: 'application/vnd.github+json', ...(process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {}) };
const repos = [];
try {
  for (let page = 1; ; page++) {
    const res = await fetch(`https://api.github.com/orgs/${ORG}/repos?type=public&per_page=100&page=${page}`, { headers: ghHeaders });
    if (!res.ok) throw new Error(`GitHub answered HTTP ${res.status}`);
    const batch = await res.json();
    repos.push(...batch);
    if (batch.length < 100) break;
  }
} catch (err) {
  // Not knowing which homepages exist is a failed check, not an org with no catalogs.
  console.log(`FAIL  could not list ${ORG}'s repos to look for unlisted catalogs: ${err.message}`);
  process.exit(1);
}
const unlisted = [];
let probed = 0;
for (const r of repos) {
  if (r.archived || !r.homepage) continue;
  let origin;
  try { origin = new URL(r.homepage).origin; } catch { continue; }
  if (!origin.startsWith('https://')) continue;
  const host = new URL(origin).host;
  if (host === OWN_HOST || listedHosts.has(host)) continue;
  probed++;
  try {
    const res = await fetch(`${origin}/registry/index.json`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) continue;
    const index = await res.json();
    if (index?.registryVersion === '1.0' && Array.isArray(index.templates) && index.templates.length) {
      unlisted.push({ repo: r.name, base: `${origin}/registry/`, n: index.templates.length });
    }
  } catch { /* down, slow, or not JSON: not a catalog */ }
}
for (const u of unlisted) {
  console.log(`FAIL  ${u.repo}  ${u.base}  serves ${u.n} template(s) the gallery does not list; add it to EXTERNAL_SOURCES`);
}
console.log(`${probed} other org homepage(s) probed for /registry/, ${unlisted.length} unlisted catalog(s).`);
process.exit(failed || unlisted.length ? 1 : 0);
