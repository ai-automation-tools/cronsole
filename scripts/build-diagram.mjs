#!/usr/bin/env node
/**
 * Build and drift-check the source data-flow diagram (docs/diagrams/).
 *
 * docs/diagrams/source-data-flow.json is the only file to edit. Every node
 * cites the code it describes (path + line range) at the commit pinned in
 * `meta.repository.revision`. A build renders it with Archify
 * (https://github.com/tt-a1i/archify) into source-data-flow.html (interactive;
 * source links go to GitHub at that commit) and source-data-flow.png (the
 * homepage image; both are copied into registry-site/, whose flat files are what
 * the homepage publishes), and records the git blob of every cited file at the pinned
 * commit in source-data-flow.sources.lock.json.
 *
 * The check compares those blobs with the staged copies. A cited file that
 * changed since the pin may have moved or changed what a node describes, so the
 * diagram is stale until someone re-reads that code, fixes the JSON and
 * rebuilds with --pin-head.
 *
 *   node scripts/build-diagram.mjs              rebuild at the pinned commit
 *   node scripts/build-diagram.mjs --pin-head   re-pin to HEAD, then rebuild
 *   node scripts/build-diagram.mjs --check      drift only, changes nothing; exit 1 if stale
 *   node scripts/build-diagram.mjs --hook       like --check, always exit 0 (CI warns with it)
 *
 * Building needs Chrome and the archify skill (default
 * ~/.claude/skills/archify/bin/archify.mjs; override with --archify <path>).
 * The check needs only git. Same contract as Edge-Radar's and Agent-Chat's
 * diagram builders, so one weekly drift check reads all three.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIAGRAMS = join(ROOT, 'docs', 'diagrams');
const STEM = 'source-data-flow';
const KIND = 'dataflow';
const NAME = 'sources-diagram';
const SOURCE = join(DIAGRAMS, `${STEM}.json`);
const HTML = join(DIAGRAMS, `${STEM}.html`);
const PNG = join(DIAGRAMS, `${STEM}.png`);
const RECEIPT = join(DIAGRAMS, `${STEM}.delivery.json`);
const LOCK = join(DIAGRAMS, `${STEM}.sources.lock.json`);
const BUILD_DIR = join(DIAGRAMS, '.build');
const HOMEPAGE = join(ROOT, 'registry-site');
const SCREENSHOT = `${STEM}.visual-check.2048x1320.dark.png`;

const git = (...args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const rel = (p) => relative(ROOT, p).replaceAll('\\', '/');

/** Blob id of `path` at `rev` ('' = the index), or null if it doesn't exist there. */
function blob(rev, path) {
  try {
    return git('rev-parse', `${rev}:${path}`);
  } catch {
    return null;
  }
}

const citedPaths = (spec) =>
  [...new Set((spec.nodes ?? []).flatMap((n) => (n.sources ?? []).map((s) => s.path)))].sort();

function findIssues() {
  if (!existsSync(RECEIPT) || !existsSync(LOCK)) {
    return ['the diagram has never been built; run node scripts/build-diagram.mjs'];
  }
  const issues = [];
  const built = readJson(RECEIPT).specification.sha256;
  if (createHash('sha256').update(readFileSync(SOURCE)).digest('hex') !== built) {
    issues.push(`${STEM}.json changed since the last build; rebuild it`);
  }
  const spec = readJson(SOURCE);
  const lock = readJson(LOCK);
  if (lock.revision !== spec.meta.repository.revision) {
    issues.push('the pinned revision changed since the last build; rebuild it');
  }
  for (const built of [HTML, PNG]) {
    const copy = join(HOMEPAGE, basename(built));
    if (!existsSync(copy) || !readFileSync(copy).equals(readFileSync(built))) {
      issues.push(`registry-site/${basename(built)} differs from the build; rebuild it`);
    }
  }
  const changed = [];
  for (const path of citedPaths(spec)) {
    const now = blob('', path);
    if (now === null) issues.push(`cited file ${path} no longer exists`);
    else if (now !== lock.files[path]) changed.push(path);
  }
  if (changed.length) {
    issues.push(
      `cited code changed since the diagram was pinned to ${lock.revision.slice(0, 8)}: ` +
        `${changed.join(', ')}. Re-read it, update the nodes, line ranges and cards in the JSON, ` +
        'then rebuild with --pin-head'
    );
  }
  return issues;
}

const archify = (script, ...args) =>
  spawnSync(process.execPath, [script, ...args], { cwd: ROOT, encoding: 'utf8' });

function fail(message) {
  console.error(message);
  process.exit(1);
}

function build(pinHead, script) {
  if (!existsSync(script)) fail(`Archify not found at ${script}; install the archify skill or pass --archify`);
  const spec = readJson(SOURCE);
  const cited = citedPaths(spec);
  if (pinHead) {
    const dirty = git('status', '--porcelain', '--', ...cited);
    if (dirty) fail(`Commit the cited files first; evidence is pinned to committed bytes:\n${dirty}`);
    spec.meta.repository.revision = git('rev-parse', 'HEAD');
    writeFileSync(SOURCE, JSON.stringify(spec, null, 2) + '\n', 'utf8');
  }
  const revision = spec.meta.repository.revision;

  rmSync(BUILD_DIR, { recursive: true, force: true });
  const result = archify(script, 'finalize', KIND, rel(SOURCE), rel(HTML), '--repo-root', '.',
    '--quality', 'showcase', '--json', '--out-dir', rel(BUILD_DIR));
  if (result.status !== 0) {
    fail(`Archify finalize failed; see ${rel(BUILD_DIR)}/${STEM}.finalize-summary.json\n` +
      (result.stdout ?? '').slice(-2000));
  }
  const visual = archify(script, 'visual-check', rel(HTML), '--summary', '--out-dir', rel(join(BUILD_DIR, 'visual')));
  const shot = join(BUILD_DIR, 'visual', SCREENSHOT);
  if (visual.status !== 0 || !existsSync(shot)) fail(`Archify visual-check failed:\n${(visual.stdout ?? '').slice(-2000)}`);
  copyFileSync(shot, PNG);
  for (const built of [HTML, PNG]) copyFileSync(built, join(HOMEPAGE, basename(built)));

  // Archify records absolute paths; a public repo must not carry the builder's disk layout.
  const receipt = readJson(RECEIPT);
  Object.assign(receipt, { input: rel(SOURCE), output: rel(HTML) });
  writeFileSync(RECEIPT, JSON.stringify(receipt, null, 2) + '\n', 'utf8');

  const files = Object.fromEntries(cited.map((p) => [p, blob(revision, p)]));
  writeFileSync(LOCK, JSON.stringify({ revision, files }, null, 2) + '\n', 'utf8');
  console.log(`Built ${rel(HTML)} and ${rel(PNG)} at ${revision.slice(0, 8)}`);
}

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
if (flag('--check') || flag('--hook')) {
  const issues = findIssues();
  for (const issue of issues) console.log(`ISSUE: ${NAME}: ${issue}`);
  if (!issues.length) console.log(`OK: ${NAME} is current`);
  process.exit(issues.length && flag('--check') ? 1 : 0);
}
const at = args.indexOf('--archify');
build(flag('--pin-head'), at >= 0 ? args[at + 1] : join(homedir(), '.claude', 'skills', 'archify', 'bin', 'archify.mjs'));
