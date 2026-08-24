#!/usr/bin/env node
// Guard: what may be committed under a `.env*` name, and what it may contain.
//
// WHY THIS EXISTS
//
// `.gitignore` denies `.env` and `.env.*`, then re-includes exactly two shapes:
// `*.env.example` and `frontend/.env.remote`. The second one is a real build input
// - `vite build --mode remote` reads it to set `VITE_API_URL=same-origin` - so it
// cannot simply be untracked, and it is genuinely not a secret: a VITE_* variable
// is compiled into the bundle and served to every visitor anyway.
//
// The risk is not what that file says today. It is that a file named `.env.remote`
// LOOKS like a secret store, sits next to the ignored ones, and is one edit away
// from being where somebody puts a token. A 2026-08-23 audit across 19 repos
// flagged it for exactly that reason, and in the same sweep found a live Neon
// admin connection string committed in a sibling repo - the same class, one repo
// over, already realised.
//
// So the .gitignore comment says "Keep it that way." This is the thing that keeps
// it that way. The rule is enforced rather than remembered, because the failure is
// silent: a secret added to an already-tracked file is a one-line diff in a file
// git has been carrying for months, and nothing anywhere reddens.
//
// WHY NOT JUST `git rm --cached frontend/.env.remote`
//
// That was the audit's suggested remediation and it is the wrong fix here: it
// deletes a documented build input to remove a value that is public by
// construction, and it leaves the actual hazard - "a tracked .env* file can gain
// a secret" - untouched for the three `.env.example` files that must stay tracked.
// Inventory + content rules cover all four; untracking covers one, badly.
//
// THE RULES
//
//   1. INVENTORY - every tracked `.env*` path must be listed in ALLOWED below.
//      A new one fails until somebody adds it deliberately, with a reason.
//   2. CREDENTIALS - no tracked env file may contain a credential-shaped literal
//      (shared pattern list, ./secret-patterns.mjs), comments included.
//   3. PINNED FILES - a non-example file declares its exact permitted keys and
//      values. `frontend/.env.remote` may hold `VITE_API_URL=same-origin` and
//      nothing else, which is the whole of its contract.
//   4. EXAMPLES - a secret-named key in a `.env.example` must be empty or an
//      obvious placeholder, and no URI may carry a non-placeholder password.

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { scanForCredentials } from './secret-patterns.mjs';

// Rule 1. Anything tracked under a .env* name and absent here is a finding.
//
//   kind: 'example' - a documentation file; values must be placeholders (rule 4).
//   kind: 'pinned'  - a real build input; `keys` is the complete permitted set,
//                     each mapped to the exact literal value allowed (rule 3).
const ALLOWED = {
  'backend/.env.example': { kind: 'example' },
  'frontend/.env.example': { kind: 'example' },
  'mcp-server/.env.example': { kind: 'example' },
  'frontend/.env.remote': {
    kind: 'pinned',
    why: 'build config for `vite build --mode remote`; one non-secret routing value',
    keys: { VITE_API_URL: 'same-origin' }
  }
};

// Rule 4. A key whose name promises a credential. Its value in an example file has
// to be empty or visibly fake - the point of the file is to name the variable.
const SECRET_KEY = /(SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|PRIVATE|_KEY|^KEY$|APIKEY|AUTH)/i;

// Values that are self-evidently not a live credential. Compared against the
// unquoted value.
const PLACEHOLDER = [
  /^$/,
  /^<.*>$/,                       // <your-token-here>
  /^\$\{.*\}$/,                   // ${CRONSOLE_TOKEN}
  /^(your|my|the|a)[-_ ]/i,       // your_admin_password_here
  /^(change[-_ ]?me|placeholder|redacted|dummy|example|sample|todo|tbd|none|null|unset)$/i,
  /^(password|passwd|secret|token|apikey|api[-_ ]?key|x{3,}|\.\.\.)$/i,
  /^(ci|test|dev|local)[-_ ]/i,   // ci-jwt-secret-not-for-production-use
  /^\{\}$/,                       // an empty JSON default
  /^[0-9]+$/                      // a port, an interval
];

// Rule 4, second half: `scheme://user:pass@host` with a live-looking `pass`. This is
// the shape that actually leaked in the audit - a Neon connection string pasted into
// a migration write-up, admin role and all.
const URI_WITH_PASSWORD = /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@"']+:([^\s@"']+)@/gi;

const isPlaceholder = (value) => PLACEHOLDER.some((re) => re.test(value));

/** Strip a single layer of matching quotes. */
const unquote = (raw) => {
  const v = raw.trim();
  return /^(".*"|'.*')$/s.test(v) ? v.slice(1, -1) : v;
};

/** `KEY=value` lines, with their 1-based line numbers. Comments and blanks skipped. */
function parseAssignments(text) {
  const out = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq < 1) return;
    out.push({
      line: i + 1,
      key: trimmed.slice(0, eq).replace(/^export\s+/, '').trim(),
      value: unquote(trimmed.slice(eq + 1))
    });
  });
  return out;
}

const tracked = execSync('git ls-files -z', { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  .split('\0')
  .filter(Boolean)
  .filter((path) => /(^|\/)\.env(\.|$)/.test(path));

const findings = [];
const report = (file, line, message) => findings.push({ file, line, message });

for (const file of tracked) {
  const rule = ALLOWED[file];

  // Rule 1.
  if (!rule) {
    report(
      file,
      0,
      'tracked under a .env* name but not in the ALLOWED inventory. If it really has to ' +
        'be committed, add it there with a reason and (if it is not an example) pin its keys.'
    );
    continue;
  }

  const text = readFileSync(file, 'utf8');

  // Rule 2 - the whole file, comments included: a key pasted into a comment is
  // still a key in the repo.
  for (const { name, sample } of scanForCredentials(text)) {
    report(file, 0, `contains a ${name} (${sample}...)`);
  }

  const assignments = parseAssignments(text);

  if (rule.kind === 'pinned') {
    // Rule 3 - allowlist, not denylist. A new key here is a finding by default.
    for (const { line, key, value } of assignments) {
      if (!(key in rule.keys)) {
        report(
          file,
          line,
          `sets ${key}, which is not one of its permitted keys (${Object.keys(rule.keys).join(', ')})`
        );
      } else if (value !== rule.keys[key]) {
        report(file, line, `sets ${key}=${value}; this file is pinned to ${key}=${rule.keys[key]}`);
      }
    }
    continue;
  }

  // Rule 4.
  for (const { line, key, value } of assignments) {
    if (SECRET_KEY.test(key) && !isPlaceholder(value)) {
      report(
        file,
        line,
        `${key} has a real-looking value; an example file documents the name, so leave it empty or use an obvious placeholder`
      );
    }
    for (const match of value.matchAll(URI_WITH_PASSWORD)) {
      if (!isPlaceholder(match[1])) {
        report(file, line, `${key} is a URI carrying a non-placeholder password`);
      }
    }
  }
}

if (findings.length === 0) {
  console.log(
    `check-tracked-env: OK - ${tracked.length} tracked .env* file(s), all allowlisted and clean.`
  );
  process.exit(0);
}

console.error('check-tracked-env: FAILED - problem(s) with git-tracked .env* file(s):\n');
for (const f of findings) {
  console.error(`  ${f.file}${f.line ? `:${f.line}` : ''}  ${f.message}`);
}
console.error(
  '\nA file named .env* that git carries is a standing invitation to put a secret in it.\n' +
    'Only three example files and frontend/.env.remote (a build input holding one public\n' +
    'routing value) are committed here - see the !frontend/.env.remote note in .gitignore.\n\n' +
    'If a value is confidential it belongs in an ignored .env, and never in a VITE_*\n' +
    'variable at all: Vite inlines those into the bundle and serves them to every visitor.\n' +
    'If the addition is genuinely safe, say so by editing ALLOWED in scripts/check-tracked-env.mjs.\n'
);
process.exit(1);
