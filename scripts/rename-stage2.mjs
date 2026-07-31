#!/usr/bin/env node
/**
 * Stage 2 of the TaskHub -> Cronsole rename: the names this machine points at.
 *
 * Stage 1 (scripts/rename-stage1.mjs) deliberately protected everything the OS
 * held a reference to — the agent project and its published exe, the launcher
 * scripts, the scheduled task names, and the Task Scheduler folders. Those are
 * renamed here, and the machine is migrated in the same change, because code
 * and machine must move together or logon start points at a path that is gone.
 *
 * Run with --dry to report without writing.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';

const DRY = process.argv.includes('--dry');
const root = process.cwd();

const EXCLUDED_FILES = ['docs/CHANGELOG.md', 'docs/ROADMAP.md', 'package-lock.json'];
const EXCLUDED_DIRS = ['artifacts/', 'registry/', '.claude/', 'images/'];

// Still protected — and each for a reason that outlives this stage.
const PROTECTED = [
  'TASKHUB_NATIVE',             // Postgres enum on every task row (its own item)
  // Browser storage: renaming these logs the user out and resets their theme.
  // Handled in code with a read-old-write-new fallback, not by a text pass.
  'taskhub.apiOrigin', 'taskhub.settings', 'taskhub.theme', 'taskhub.token', 'taskhub.user',
  'taskhub.example',
  // Docker database, role, volume and container names. Renaming these makes
  // compose create a NEW volume and orphan the old one — the data is the one
  // thing here that cannot be rebuilt from the repo. Zero user-visible benefit.
  'taskhub_test', 'taskhub-backend', 'taskhub-frontend', 'taskhub-db', 'taskhub-redis',
  'postgresql://taskhub', '://taskhub:', 'POSTGRES_USER: taskhub', 'POSTGRES_DB: taskhub',
  // The local clone's directory name, which every scheduled task's arguments
  // embed as an absolute path. It is not user-visible branding; it moves (if
  // ever) with the Stage 3 repo rename, and the tasks get rewritten then.
  'Live_Apps\\taskhub', 'Live_Apps/taskhub',
  // Stage 3 (public surface).
  'taskhub-registry', 'taskhub-site', 'taskhub.mikesailab.com', 'michaelschecht/taskhub',
  'mikesailab.com/taskhub',
];

// Ordered: the most specific compound names first, so a general rule can't
// half-rewrite one of them.
const REPLACEMENTS = [
  [/\\Task-Hub/g, '\\Cronsole-Stack'],   // launcher/agent folder, kept SEPARATE from \Cronsole
  [/Task-Hub/g, 'Cronsole-Stack'],
  [/TaskHub\.Agent/g, 'Cronsole.Agent'],
  [/TaskHubAgent/g, 'CronsoleAgent'],
  [/TaskHubRepublish/g, 'CronsoleRepublish'],
  [/TaskHubStack/g, 'CronsoleStack'],
  [/Start-TaskHub/g, 'Start-Cronsole'],
  [/Register-TaskHubStack/g, 'Register-CronsoleStack'],
  [/taskhub\.ps1/g, 'cronsole.ps1'],
  [/TaskHub/g, 'Cronsole'],
  [/TASKHUB/g, 'CRONSOLE'],
  [/taskhub/g, 'cronsole'],
  [/Taskhub/g, 'Cronsole'],
];

const tracked = execSync('git ls-files', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  .split('\n').map(s => s.trim()).filter(Boolean);

const isExcluded = (f) =>
  EXCLUDED_FILES.includes(f) || EXCLUDED_DIRS.some(d => f.startsWith(d)) || f.endsWith('package-lock.json');
const BINARY = /\.(png|jpg|jpeg|gif|ico|svg|woff2?|ttf|eot|zip|msi|exe|dll|pdf)$/i;

let files = 0, occurrences = 0;
const report = [];

for (const file of tracked) {
  if (isExcluded(file) || BINARY.test(file)) continue;
  const abs = path.join(root, file);
  try { if (!statSync(abs).isFile()) continue; } catch { continue; }

  const original = readFileSync(abs, 'utf8');
  if (!/taskhub|task-hub/i.test(original)) continue;

  let text = original;
  const sentinels = [];
  PROTECTED.forEach((token, i) => {
    if (!text.includes(token)) return;
    const s = `PROT${i}`;
    sentinels.push([s, token]);
    text = text.split(token).join(s);
  });

  const before = text;
  for (const [p, to] of REPLACEMENTS) text = text.replace(p, to);
  const hits = (before.match(/taskhub|task-hub/gi) || []).length;
  for (const [s, token] of sentinels) text = text.split(s).join(token);

  if (text !== original) {
    files++; occurrences += hits;
    report.push(`${String(hits).padStart(4)}  ${file}`);
    if (!DRY) writeFileSync(abs, text, 'utf8');
  }
}

console.log(report.sort((a, b) => Number(b.slice(0, 4)) - Number(a.slice(0, 4))).slice(0, 20).join('\n'));
console.log(`\n${DRY ? '[dry run] ' : ''}${files} files, ${occurrences} occurrences replaced`);
