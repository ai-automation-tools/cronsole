/**
 * Does the hosted registry actually serve what main says it should?
 *
 * The committed `registry/` is guarded by a drift test: if it does not match a
 * fresh `npm run registry:build`, CI reddens. Nothing guarded the step AFTER
 * that. The artifact is mirrored to a separate public repo and served from
 * GitHub Pages, and until 2026-08-19 that mirroring happened only when someone
 * remembered to run `scripts/publish-registry.ps1` on one particular Windows
 * machine. A registry that is correct in git and stale on the CDN is invisible
 * from inside the repo -- every test passes, and other people's machines read
 * the old catalog.
 *
 * This compares the two by the thing that actually matters: content-addressed
 * identity. Same ids, same sha256s, same registryVersion. It deliberately does
 * not fetch every template file -- the index's sha256 IS the file's identity,
 * which is the whole point of a content-addressed artifact.
 *
 *   node scripts/check-registry-published.mjs
 *   REGISTRY_URL=https://example.test/registry node scripts/check-registry-published.mjs
 *
 * Exit 0 = the host matches main. Exit 1 = it does not, and the output says
 * which way it is wrong.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** A condition worth stopping for. Thrown, not exited on -- see the tail. */
class Failure extends Error {}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const baseUrl = (process.env.REGISTRY_URL || 'https://mikesailab.com/cronsole-registry').replace(/\/+$/, '');
const indexUrl = `${baseUrl}/index.json`;

const problems = [];

function readCommitted() {
  const path = join(repoRoot, 'registry', 'index.json');
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Failure(`Cannot read ${path}: ${err.message}\nRun 'npm run registry:build' in backend/ first.`);
  }
}

async function fetchHosted() {
  // Cache-bust: a CDN edge serving a stale copy is indistinguishable from an
  // unpublished registry from here, and the two have different fixes.
  const url = `${indexUrl}?cachebust=${Date.now()}`;
  let res;
  try {
    res = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
  } catch (err) {
    throw new Failure(
      `Could not reach ${indexUrl}: ${err.message}\n` +
        'The hosted registry being unreachable is itself worth knowing -- this is not a pass.'
    );
  }
  if (!res.ok) throw new Failure(`${indexUrl} returned HTTP ${res.status}.`);
  try {
    return await res.json();
  } catch (err) {
    throw new Failure(`${indexUrl} did not parse as JSON: ${err.message}`);
  }
}

/** Compare one collection (templates or packs) by id and sha256. */
function compare(kind, committed, hosted) {
  const mine = new Map((committed || []).map((t) => [t.id, t.sha256]));
  const theirs = new Map((hosted || []).map((t) => [t.id, t.sha256]));

  const missing = [...mine.keys()].filter((id) => !theirs.has(id));
  const extra = [...theirs.keys()].filter((id) => !mine.has(id));
  const changed = [...mine.entries()]
    .filter(([id, sha]) => theirs.has(id) && theirs.get(id) !== sha)
    .map(([id]) => id);

  if (missing.length) {
    problems.push(`${missing.length} ${kind} on main are not served: ${missing.join(', ')}`);
  }
  if (extra.length) {
    // The more dangerous direction: a URL that still works and should not.
    problems.push(`${extra.length} ${kind} are still served but no longer on main: ${extra.join(', ')}`);
  }
  if (changed.length) {
    problems.push(`${changed.length} ${kind} differ in content (sha256 mismatch): ${changed.join(', ')}`);
  }
}

async function main() {
  const committed = readCommitted();
  const hosted = await fetchHosted();

  if (committed.registryVersion !== hosted.registryVersion) {
    problems.push(
      `registryVersion differs: main has ${committed.registryVersion}, host serves ${hosted.registryVersion}`
    );
  }

  compare('templates', committed.templates, hosted.templates);
  compare('packs', committed.packs, hosted.packs);

  if (problems.length === 0) {
    console.log(
      `Hosted registry matches main: ${committed.templates.length} template(s), ` +
        `${(committed.packs || []).length} pack(s), registryVersion ${committed.registryVersion}.`
    );
    return true;
  }

  console.error(`The hosted registry at ${baseUrl} does not match main:`);
  console.error('');
  for (const p of problems) console.error(`  - ${p}`);
  console.error('');
  console.error(
    `main: ${committed.templates.length} templates / ${(committed.packs || []).length} packs` +
      `   host: ${(hosted.templates || []).length} templates / ${(hosted.packs || []).length} packs`
  );
  console.error('');
  console.error('Fix: the "Publish registry" workflow runs on every merge to main that touches registry/.');
  console.error('If it did not run or failed, re-run it from the Actions tab, or publish manually with');
  console.error('  pwsh scripts/publish-registry.ps1');
  return false;
}

// Never process.exit() here: undici keeps a socket open after fetch, and exiting
// on top of it trips a libuv assertion that returns 127 -- which would redden a
// PASSING check. Set the code and let the event loop drain.
try {
  const ok = await main();
  process.exitCode = ok ? 0 : 1;
} catch (err) {
  if (err instanceof Failure) {
    console.error(err.message);
    process.exitCode = 1;
  } else {
    throw err;
  }
}
