/**
 * Does the public host serve the gallery page that is on main?
 *
 * `registry-site/index.html` is served at
 *
 *   https://cronsole.ai-automation-tools.dev/           the front door, and since
 *                                                       2026-10-23 the registry host too
 *
 * It used to be served from more: cronsole.mikesailab.com until 2026-10-23 (now
 * a redirect), and mikesailab.com/cronsole-registry/ beside the registry JSON
 * (now an archived, frozen snapshot of both). Neither is checked -- a redirect
 * and a frozen snapshot are supposed to stop matching.
 *
 * For a long time that meant N hosts, N publish paths and N chances to forget,
 * and the check still takes a list (SITE_URLS) so a second host can never be
 * added without being checked: the stale one is always whichever you did not
 * happen to open.
 *
 * GitHub Pages serves the file raw, so the comparison is exact: sha256 over the
 * committed bytes against sha256 over what each host returns. No parsing, no
 * heuristics, no "looks about right".
 *
 *   node scripts/check-frontdoor-published.mjs
 *
 * Exit 0 = every host serves the current page. Exit 1 = at least one does not,
 * and the output says which.
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

class Failure extends Error {}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

// Override (comma-separated) for a fork or a staging host. Every host that
// serves this page gets checked.
const HOSTS = (process.env.SITE_URLS || 'https://cronsole.ai-automation-tools.dev/')
  .split(',')
  .map((u) => u.trim())
  .filter(Boolean);

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * Compare LF-normalized, always.
 *
 * On Windows the working-tree copy of this file has CRLF line endings, while
 * the blob git commits -- and therefore the bytes GitHub Pages serves -- has
 * LF. Hashing the raw working-tree bytes reports both hosts stale by exactly
 * the newline count (1544 bytes, on first run) on every Windows machine and
 * matches on every Linux one. A check that cries wolf locally gets ignored, so
 * it normalizes rather than trusting anyone's core.autocrlf.
 *
 * `.gitattributes` now also pins registry-site/ to LF, which fixes the working
 * tree itself. This stays as the belt to that braces: it is what makes the
 * check correct on a checkout made before that pin.
 */
const normalize = (buf) => Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');

function readCommitted() {
  const path = join(repoRoot, 'registry-site', 'index.html');
  try {
    return normalize(readFileSync(path));
  } catch (err) {
    throw new Failure(`Cannot read ${path}: ${err.message}`);
  }
}

async function fetchPage(url) {
  // Cache-bust: an edge serving a stale copy and an unpublished page are the
  // same symptom from here, and they have different fixes.
  const bust = url + (url.includes('?') ? '&' : '?') + 'cachebust=' + Date.now();
  let res;
  try {
    res = await fetch(bust, { headers: { 'Cache-Control': 'no-cache' } });
  } catch (err) {
    return { error: `unreachable (${err.message})` };
  }
  if (!res.ok) return { error: `HTTP ${res.status}` };
  const body = normalize(Buffer.from(await res.arrayBuffer()));
  return { sha: sha256(body), bytes: body.length };
}

async function main() {
  const committed = readCommitted();
  const want = sha256(committed);
  console.log(`main: registry-site/index.html is ${committed.length} bytes, sha256 ${want.slice(0, 16)}...`);

  const problems = [];
  for (const url of HOSTS) {
    const got = await fetchPage(url);
    if (got.error) {
      problems.push(`${url} -- ${got.error}`);
      console.error(`  MISS  ${url}  ${got.error}`);
      continue;
    }
    if (got.sha !== want) {
      problems.push(`${url} -- serves a different page (${got.bytes} bytes, sha256 ${got.sha.slice(0, 16)}...)`);
      console.error(`  STALE ${url}  ${got.bytes} bytes, sha256 ${got.sha.slice(0, 16)}...`);
      continue;
    }
    console.log(`  OK    ${url}  matches`);
  }

  if (problems.length === 0) {
    console.log(`All ${HOSTS.length} hosts serve the current gallery page.`);
    return true;
  }

  console.error('');
  console.error('The published gallery page does not match main:');
  console.error('');
  for (const p of problems) console.error(`  - ${p}`);
  console.error('');
  console.error('Fix: "Publish registry + front door" runs on every merge to main that touches');
  console.error('registry/ or registry-site/. Re-run it from the Actions tab, or publish manually with');
  console.error('  pwsh scripts/publish-registry.ps1');
  return false;
}

// Never process.exit() here -- undici holds a socket open after fetch, and
// exiting on top of it trips a libuv assertion that returns 127 even on success.
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
