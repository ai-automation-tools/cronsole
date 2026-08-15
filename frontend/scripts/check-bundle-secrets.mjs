#!/usr/bin/env node
/**
 * Fail the build if a credential-shaped literal reached the bundle.
 *
 * This exists because the leak it guards was invisible in every place someone
 * would look: the source said "there is intentionally NO committed dev fallback",
 * `.env.local` is gitignored so nothing was committed, the tests passed, and the
 * app behaved correctly. Vite still loads `.env.local` in EVERY mode and inlines
 * each `VITE_*` reference as a literal, so `npm run build` compiled a real owner
 * JWT (exp 2036) into dist/assets/*.js. Anyone who could load the page could read
 * it, and the app sent it automatically when no one was logged in.
 *
 * The structural fix is in api.ts (`import.meta.env.DEV ? … : undefined`, which
 * folds away in a build). This is the check that keeps it fixed: the failure mode
 * is silent and the blast radius is "the login screen is decorative", so it wants
 * a guard that runs on every build rather than a rule someone has to remember.
 *
 * Deliberately scans the BUILD OUTPUT, not the source. The source never contained
 * the secret — the compiler put it there. A linter reading .ts files could not
 * have caught this, and would have reported the code as clean.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIST = join(import.meta.dirname, '..', 'dist');

const PATTERNS = [
  {
    name: 'JSON Web Token',
    // header.payload — a JWT header always base64s to this prefix, so this is the
    // token itself rather than any long base64 string (source maps and inlined
    // assets are full of those, and a looser pattern would be ignored within a week).
    re: /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}/g
  },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { name: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'OpenAI API key', re: /\bsk-[A-Za-z0-9]{32,}\b/g },
  { name: 'Private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g }
];

if (!existsSync(DIST)) {
  console.error('check-bundle-secrets: no dist/ to scan — run the build first.');
  process.exit(1);
}

/** Every emitted file, not just .js: a secret in the CSS or the HTML is still served. */
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const findings = [];
for (const file of walk(DIST)) {
  const text = readFileSync(file, 'utf8');
  for (const { name, re } of PATTERNS) {
    for (const match of text.matchAll(re)) {
      findings.push({ file: file.slice(DIST.length + 1), name, sample: match[0].slice(0, 24) });
    }
  }
}

if (findings.length > 0) {
  console.error('\ncheck-bundle-secrets: FAILED — credential-shaped literals in the build output.\n');
  for (const f of findings) {
    console.error(`  ${f.file}: ${f.name} (${f.sample}…)`);
  }
  console.error(
    '\nA VITE_* variable is compiled into the bundle and served to every visitor — it is\n' +
    'public by construction, so it can never hold a secret. Gate the reference on\n' +
    '`import.meta.env.DEV` so it folds away in a build (see DEV_TOKEN in src/api.ts),\n' +
    'or move the value to the backend.\n'
  );
  process.exit(1);
}

console.log(`check-bundle-secrets: OK — no credential-shaped literals in ${DIST}`);
