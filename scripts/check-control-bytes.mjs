#!/usr/bin/env node
/**
 * Fail if any tracked TEXT file contains a literal control byte.
 *
 * Why this exists: a stray control byte (a NUL used as a separator, a Unit
 * Separator 0x1f pasted into a comment) makes git classify the file as
 * **binary** — and a binary file's diff is unreviewable. That is a silent
 * failure that only bites the *reviewer*: the code still compiles, the tests
 * still pass, and a security-relevant change can slip through with nobody able
 * to read the diff. It bit `backend/src/ws/agentAuth.ts` (a NUL separator),
 * `mcp-server/src/__tests__/tools.test.ts` (a NUL in an export-encoding test),
 * and `agent/.../AgentAuthenticatorTests.cs` (0x1f in a comment) — see
 * docs/troubleshooting/README.md and ROADMAP.md › "Sweep for literal control
 * bytes in source". This guard makes the class impossible to reintroduce.
 *
 * The fix in every case is the same: keep the runtime string identical but
 * write the byte as an ESCAPE in source (`\x00`, `\x1f`, `\u0000`) rather than
 * the raw byte, so the file stays plain text and its diff stays readable.
 *
 * Allowed control bytes: TAB (0x09), LF (0x0a), CR (0x0d). Everything else in
 * 0x00–0x1f plus DEL (0x7f) is rejected in a text file.
 *
 * Usage: `node scripts/check-control-bytes.mjs` (exit 1 on any finding).
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Genuinely-binary formats: never scanned. Extend deliberately — a new binary
// extension here is fine; a text extension here would blind the guard.
const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.avif',
  '.ttf', '.otf', '.woff', '.woff2', '.eot',
  '.zip', '.gz', '.tar', '.tgz', '.7z', '.rar',
  '.pdf', '.msi', '.exe', '.dll', '.so', '.dylib', '.bin',
  '.mp3', '.mp4', '.wav', '.mov', '.webm', '.ogg',
  '.woff2', '.snap'
]);

// Exact tracked paths that ARE text-ish but legitimately hold control bytes.
// The Task Scheduler XML exports are stored UTF-16 LE (the only encoding
// Windows re-imports), so they carry NULs by design. Keep this list SHORT and
// justified — every entry is a hole in the guard.
const ALLOWLIST = new Set([
  'scripts/startup-task/CronsoleAgent.backup.xml',
  'scripts/startup-task/CronsoleAgent.updated.xml'
]);

const isAllowedByte = (c) => c === 0x09 || c === 0x0a || c === 0x0d;
const isControl = (c) => (c < 0x20 && !isAllowedByte(c)) || c === 0x7f;

// Tracked files PLUS untracked-but-not-ignored ones.
//
// `git ls-files` alone lists only what git already tracks, which left a blind
// spot exactly where new bytes come from: a brand-new file is invisible to this
// guard until the commit that adds it, so the one commit that could introduce a
// control byte is the one commit this check couldn't pre-validate. That is not
// hypothetical — `scripts/rename-stage2.mjs` shipped with two literal 0x01
// bytes on 2026-07-31 while this check reported OK moments before, because the
// file was still untracked. CI caught it only on the next run.
//
// `--others --exclude-standard` adds untracked files while still honoring
// .gitignore, so build output and node_modules stay out.
const files = execSync('git ls-files --cached --others --exclude-standard', { maxBuffer: 1 << 28 })
  .toString()
  .split('\n')
  .filter(Boolean);

const findings = [];
for (const file of files) {
  if (ALLOWLIST.has(file)) continue;
  const dot = file.lastIndexOf('.');
  const ext = dot >= 0 ? file.slice(dot).toLowerCase() : '';
  if (BINARY_EXT.has(ext)) continue;

  let buf;
  try {
    buf = readFileSync(file);
  } catch {
    continue; // deleted-but-tracked, submodule, etc.
  }

  let firstOffset = -1;
  let firstByte = 0;
  let count = 0;
  for (let i = 0; i < buf.length; i++) {
    if (isControl(buf[i])) {
      if (firstOffset < 0) {
        firstOffset = i;
        firstByte = buf[i];
      }
      count++;
    }
  }
  if (firstOffset >= 0) {
    const line = buf.subarray(0, firstOffset).toString('utf8').split('\n').length;
    findings.push({ file, count, line, byte: firstByte });
  }
}

if (findings.length === 0) {
  console.log(`check-control-bytes: OK — ${files.length} files (tracked + untracked), no literal control bytes in text.`);
  process.exit(0);
}

console.error('check-control-bytes: FAILED — literal control byte(s) in text file(s):\n');
for (const f of findings) {
  const hex = `0x${f.byte.toString(16).padStart(2, '0')}`;
  console.error(`  ${f.file}  — ${f.count} byte(s), first ${hex} at line ~${f.line}`);
}
console.error(
  '\nA control byte makes git treat the file as binary, so its diff cannot be reviewed.\n' +
  'Replace the raw byte with an escape (\\x00, \\x1f, \\u0000, …) — the runtime string is\n' +
  'identical and the file stays reviewable. If the file is genuinely binary, add its\n' +
  'extension to BINARY_EXT (or, if unavoidable, the exact path to ALLOWLIST) in this script.'
);
process.exit(1);
