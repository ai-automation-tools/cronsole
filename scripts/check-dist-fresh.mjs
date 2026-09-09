#!/usr/bin/env node
/**
 * Report whether `frontend/dist` is older than the source it was built from.
 *
 * **Why this exists.** `frontend/dist` is the fourth thing in this repo that runs
 * stale, and it is the one with no keeper. The other three announce themselves:
 * a stale backend 404s a new route, a stale agent 502s a new command, an unbuilt
 * `mcp-server/dist` makes a tool behave like the old code. A stale `dist` does
 * something worse — it serves a **complete, correct-looking, working dashboard**
 * that is simply from another day. Nothing errors. Nothing logs. The dev server
 * at `:7373` is current the whole time, so the two addresses disagree and only
 * the one nobody is looking at is wrong.
 *
 * It has now cost real time twice: [#53](../docs/troubleshooting/README.md#53-the-proxied-dashboard-is-stale-while-the-dev-server-is-current)
 * and again on 2026-08-23, when preference sync shipped, passed every suite, was
 * verified by curl against the backend — and did not appear at the Tailscale URL,
 * because the proxy was serving a bundle from four days earlier. The source was
 * right; nothing was serving it.
 *
 * **`cronsole up` starts the proxy and does not rebuild `dist`.** That is not an
 * oversight to fix here: rebuilding on every `up` would make a routine start
 * command silently replace what is being served, which is a worse property than
 * an occasional stale bundle. So the gap is closed by *reporting* it — the
 * standing rule that a diagnostic reports and does not repair (CLAUDE.md §9,
 * where three of four agent-health incidents were the readout lying).
 *
 * **Omitted, not passed, when nothing serves `dist`.** On a normal stack the
 * proxy is down and `dist` is read by nobody, so its age is a fact about nothing
 * — and rendering that as a green check is exactly the "a check with nothing to
 * measure is omitted, not rendered as a pass" rule. Pass `--force` to measure
 * anyway.
 *
 * **What it does NOT check, deliberately.** Whether the bundle resolves the API
 * same-origin is not decided by grepping the minified output. Both `npm run
 * build` and `npm run build:remote` have produced the same correct bundle since
 * the 2026-08-17 fold (`FALLBACK_API_ORIGIN` in `frontend/src/api.ts`), and
 * `http://localhost:3000` still appears once in a *correct* build, so its
 * presence proves nothing. The thing that can still bake a wrong origin is an
 * input — `VITE_API_URL` set in `.env.local`, which Vite loads in every mode —
 * so that is what is reported instead. Checking the cause beats pattern-matching
 * a minifier's output shape, which changes without warning
 * ([#63](../docs/troubleshooting/README.md#63-the-proxied-dashboard-loads-on-the-phone-but-cannot-reach-the-backend)).
 *
 * Exit codes: 0 fresh or omitted · 1 stale · 2 never built · 3 cannot measure.
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const FRONTEND = join(REPO, 'frontend');
const DIST = join(FRONTEND, 'dist');

const force = process.argv.includes('--force');

/** Directories under `frontend/` whose contents never end up in a bundle. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'test-results', 'playwright-report', '.vite']);

/**
 * Files whose change should force a rebuild.
 *
 * `src/**` plus the four inputs that are not under it but are compiled in:
 * the HTML entry, the Vite config, the dependency set, and the Tailwind/PostCSS
 * config. A change to any of them produces different bytes in `dist`.
 *
 * Test files are deliberately **included** rather than filtered out. They cannot
 * change the bundle, so counting them can only ever make this report a rebuild
 * that was not strictly needed — which costs one second. Excluding them means
 * maintaining a second definition of "is this a test file" that drifts, and the
 * failure of that drift is a stale bundle reported as fresh. Wrong in the cheap
 * direction on purpose.
 */
const EXTRA_INPUTS = [
  'index.html',
  'vite.config.ts',
  'package.json',
  'tailwind.config.js',
  'tailwind.config.ts',
  'postcss.config.js',
  'tsconfig.app.json'
];

/** Newest mtime under a directory, with the file that carried it. */
function newestUnder(dir, acc = { at: 0, file: null }) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      newestUnder(join(dir, e.name), acc);
      continue;
    }
    const full = join(dir, e.name);
    let at;
    try {
      at = statSync(full).mtimeMs;
    } catch {
      continue;
    }
    if (at > acc.at) {
      acc.at = at;
      acc.file = full;
    }
  }
  return acc;
}

/** Is the reverse proxy — the only thing that serves `dist` — actually up? */
function proxyRunning() {
  try {
    const out = execFileSync(
      'docker',
      ['ps', '--filter', 'name=proxy', '--format', '{{.Names}}'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 }
    );
    return out.split('\n').some(n => n.trim().endsWith('proxy-1'));
  } catch {
    // Docker missing, not running, or refusing — that is "cannot measure",
    // which is a different answer from "the proxy is down".
    return null;
  }
}

const rel = p => relative(REPO, p).replace(/\\/g, '/');
const ago = ms => {
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
};

// ── 1. Is anything serving dist? ────────────────────────────────────────────
const proxy = proxyRunning();

if (proxy === null && !force) {
  console.log(
    'check-dist-fresh: UNKNOWN — could not ask Docker whether the proxy is running,\n' +
    '  so whether anything serves frontend/dist is unmeasured. Re-run with --force to\n' +
    '  check the bundle anyway. (Absence of evidence is unknown, never ok.)'
  );
  process.exit(3);
}

if (proxy === false && !force) {
  console.log(
    'check-dist-fresh: OMITTED — the reverse proxy is not running, so nothing serves\n' +
    '  frontend/dist and its age is a fact about nothing. Use --force to check anyway.'
  );
  process.exit(0);
}

// ── 2. Has it ever been built? ──────────────────────────────────────────────
const assets = join(DIST, 'assets');
if (!existsSync(DIST) || !existsSync(assets)) {
  console.error(
    'check-dist-fresh: NEVER BUILT — frontend/dist does not exist, but the proxy is\n' +
    '  running and serving from it. The proxied dashboard is a 404, not a stale page.\n\n' +
    '  Fix:  cd frontend && npm run build'
  );
  process.exit(2);
}

const built = newestUnder(assets);
if (!built.file) {
  console.error(
    'check-dist-fresh: NEVER BUILT — frontend/dist/assets is empty while the proxy is\n' +
    '  serving from it.\n\n  Fix:  cd frontend && npm run build'
  );
  process.exit(2);
}

// ── 3. Is it older than its inputs? ─────────────────────────────────────────
const source = newestUnder(join(FRONTEND, 'src'));
for (const name of EXTRA_INPUTS) {
  const full = join(FRONTEND, name);
  if (!existsSync(full)) continue;
  const at = statSync(full).mtimeMs;
  if (at > source.at) {
    source.at = at;
    source.file = full;
  }
}

// ── 4. The input that can still bake a wrong API origin. ────────────────────
// Reported alongside rather than as its own verdict: it is a warning about what
// the NEXT build will produce, not a claim about the one on disk.
let originNote = '';
const envLocal = join(FRONTEND, '.env.local');
if (existsSync(envLocal)) {
  const line = readFileSync(envLocal, 'utf8')
    .split(/\r?\n/)
    .find(l => /^\s*VITE_API_URL\s*=\s*\S/.test(l) && !/^\s*#/.test(l));
  if (line) {
    const value = line.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
    if (value && value !== 'same-origin') {
      originNote =
        `\n  ALSO: frontend/.env.local sets VITE_API_URL=${value}\n` +
        '    Vite loads .env.local in EVERY mode, so this is compiled into the bundle as a\n' +
        '    literal and overrides the same-origin default — one build then only works at one\n' +
        '    address, and the proxied page loads fine on a phone while reaching no backend.\n' +
        '    Unset it (or set it to same-origin) unless you specifically need a fixed origin.\n' +
        '    See docs/troubleshooting/README.md#63';
    }
  }
}

const skew = source.at - built.at;

if (skew > 0) {
  console.error(
    `check-dist-fresh: STALE — the proxy is serving a bundle ${ago(skew)} older than the source.\n\n` +
    `  built   ${new Date(built.at).toISOString()}  ${rel(built.file)}\n` +
    `  source  ${new Date(source.at).toISOString()}  ${rel(source.file)}\n\n` +
    '  The proxied dashboard is complete and working and simply from another day, while the\n' +
    '  dev server on :7373 is current — so the two addresses disagree and only the one you\n' +
    '  are not looking at is wrong. `cronsole up` starts the proxy but never rebuilds dist.\n\n' +
    '  Fix:  cd frontend && npm run build      (the mount is live; no container restart)\n' +
    '  See:  docs/troubleshooting/README.md#53' +
    originNote
  );
  process.exit(1);
}

console.log(
  `check-dist-fresh: OK — bundle is current (built ${ago(-skew)} after the newest source change).\n` +
  `  built   ${new Date(built.at).toISOString()}  ${rel(built.file)}\n` +
  `  source  ${new Date(source.at).toISOString()}  ${rel(source.file)}` +
  originNote
);
process.exit(0);
