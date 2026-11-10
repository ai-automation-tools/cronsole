#!/usr/bin/env node
/**
 * Build and drift-check the diagrams in docs/diagrams/.
 *
 * Each diagram's docs/diagrams/<stem>.json is the only file to edit. Every node
 * that describes this repo's code cites it (path + line range) at the commit pinned in
 * `meta.repository.revision`. A build renders it with Archify
 * (https://github.com/tt-a1i/archify) into <stem>.html (interactive; source
 * links go to GitHub at that commit) and <stem>.png (a static snapshot; for a
 * diagram the homepage embeds, both are copied into registry-site/, whose flat
 * files are what the homepage publishes), and records the git blob of every
 * cited file at the pinned commit in <stem>.sources.lock.json.
 *
 * The check compares those blobs with the staged copies. A cited file that
 * changed since the pin may have moved or changed what a node describes, so the
 * diagram is stale until someone re-reads that code, fixes the JSON and
 * rebuilds with --pin-head.
 *
 *   node scripts/build-diagram.mjs              rebuild every diagram at its pinned commit
 *   node scripts/build-diagram.mjs --pin-head   re-pin to HEAD, then rebuild
 *   node scripts/build-diagram.mjs --check      drift only, changes nothing; exit 1 if stale
 *   node scripts/build-diagram.mjs --hook       like --check, always exit 0 (CI warns with it)
 *   ... --only <stem>                           limit any of the above to one diagram
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
const HOMEPAGE = join(ROOT, 'registry-site');

/** `name` is what the check prints, and what the weekly drift check reads; keep it stable. */
const ALL = [
  { stem: 'source-data-flow', kind: 'dataflow', name: 'sources-diagram', homepage: true },
  { stem: 'template-catalogs', kind: 'dataflow', name: 'catalogs-diagram', homepage: false },
];

const git = (...args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const rel = (p) => relative(ROOT, p).replaceAll('\\', '/');

function paths({ stem }) {
  const at = (ext) => join(DIAGRAMS, `${stem}${ext}`);
  return {
    source: at('.json'), html: at('.html'), png: at('.png'),
    receipt: at('.delivery.json'), lock: at('.sources.lock.json'),
    buildDir: join(DIAGRAMS, '.build', stem),
    screenshot: `${stem}.visual-check.2048x1320.dark.png`,
  };
}

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

function findIssues(d) {
  const p = paths(d);
  if (!existsSync(p.receipt) || !existsSync(p.lock)) {
    return [`the diagram has never been built; run node scripts/build-diagram.mjs --only ${d.stem}`];
  }
  const issues = [];
  const built = readJson(p.receipt).specification.sha256;
  if (createHash('sha256').update(readFileSync(p.source)).digest('hex') !== built) {
    issues.push(`${d.stem}.json changed since the last build; rebuild it`);
  }
  const spec = readJson(p.source);
  const lock = readJson(p.lock);
  if (lock.revision !== spec.meta.repository.revision) {
    issues.push('the pinned revision changed since the last build; rebuild it');
  }
  if (d.homepage) {
    for (const file of [p.html, p.png]) {
      const copy = join(HOMEPAGE, basename(file));
      if (!existsSync(copy) || !readFileSync(copy).equals(readFileSync(file))) {
        issues.push(`registry-site/${basename(file)} differs from the build; rebuild it`);
      }
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

function build(d, pinHead, script) {
  const p = paths(d);
  const spec = readJson(p.source);
  const cited = citedPaths(spec);
  if (pinHead) {
    const dirty = git('status', '--porcelain', '--', ...cited);
    if (dirty) fail(`Commit the cited files first; evidence is pinned to committed bytes:\n${dirty}`);
    spec.meta.repository.revision = git('rev-parse', 'HEAD');
    writeFileSync(p.source, JSON.stringify(spec, null, 2) + '\n', 'utf8');
  }
  const revision = spec.meta.repository.revision;

  rmSync(p.buildDir, { recursive: true, force: true });
  const result = archify(script, 'finalize', d.kind, rel(p.source), rel(p.html), '--repo-root', '.',
    '--quality', 'showcase', '--json', '--out-dir', rel(p.buildDir));
  if (result.status !== 0) {
    fail(`Archify finalize failed; see ${rel(p.buildDir)}/${d.stem}.finalize-summary.json\n` +
      (result.stdout ?? '').slice(-2000));
  }
  const visualDir = join(p.buildDir, 'visual');
  const visual = archify(script, 'visual-check', rel(p.html), '--summary', '--out-dir', rel(visualDir));
  const shot = join(visualDir, p.screenshot);
  if (visual.status !== 0 || !existsSync(shot)) fail(`Archify visual-check failed:\n${(visual.stdout ?? '').slice(-2000)}`);
  copyFileSync(shot, p.png);
  if (d.homepage) for (const file of [p.html, p.png]) copyFileSync(file, join(HOMEPAGE, basename(file)));

  // Archify records absolute paths; a public repo must not carry the builder's disk layout.
  const receipt = readJson(p.receipt);
  Object.assign(receipt, { input: rel(p.source), output: rel(p.html) });
  writeFileSync(p.receipt, JSON.stringify(receipt, null, 2) + '\n', 'utf8');

  const files = Object.fromEntries(cited.map((f) => [f, blob(revision, f)]));
  writeFileSync(p.lock, JSON.stringify({ revision, files }, null, 2) + '\n', 'utf8');
  console.log(`Built ${rel(p.html)} and ${rel(p.png)} at ${revision.slice(0, 8)}`);
}

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const value = (f) => (args.indexOf(f) >= 0 ? args[args.indexOf(f) + 1] : undefined);
const only = value('--only');
const selected = only ? ALL.filter((d) => d.stem === only) : ALL;
if (!selected.length) fail(`No diagram called ${only}. Diagrams: ${ALL.map((d) => d.stem).join(', ')}`);

if (flag('--check') || flag('--hook')) {
  let stale = false;
  for (const d of selected) {
    const issues = findIssues(d);
    for (const issue of issues) console.log(`ISSUE: ${d.name}: ${issue}`);
    if (!issues.length) console.log(`OK: ${d.name} is current`);
    stale ||= issues.length > 0;
  }
  process.exit(stale && flag('--check') ? 1 : 0);
}
const script = value('--archify') ?? join(homedir(), '.claude', 'skills', 'archify', 'bin', 'archify.mjs');
if (!existsSync(script)) fail(`Archify not found at ${script}; install the archify skill or pass --archify`);
for (const d of selected) build(d, flag('--pin-head'), script);
