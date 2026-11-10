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
 *   node scripts/check-external-catalogs.mjs
 *
 * Exit 0 = every listed catalog loads. Exit 1 = one does not, or the list could not be read.
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
process.exit(failed ? 1 : 0);
