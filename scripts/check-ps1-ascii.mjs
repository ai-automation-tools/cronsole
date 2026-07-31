#!/usr/bin/env node
// Guard: PowerShell scripts must be pure ASCII.
//
// WHY THIS EXISTS
//
// Windows PowerShell 5.1 reads a .ps1 file as ANSI unless it carries a UTF-8 BOM.
// A repo that writes files as UTF-8-without-BOM (which is the sane default, and what
// the editors here do) therefore ships scripts that 5.1 mis-decodes. It does not fail
// with "bad encoding" — it fails with a wall of PARSE ERRORS pointing at syntax that
// is perfectly correct, because a multi-byte character has been split into bytes that
// terminate a string early.
//
// This bit for real on 2026-07-31: five scripts contained em-dashes and ellipses in
// their comments and messages, so `powershell.exe` could not parse ANY of them —
// including `Migrate-ToCronsole.ps1` (a machine migration) and `setup-agent-startup.ps1`
// (which users run, ELEVATED, during install). pwsh 7 parsed them all fine, so nothing
// ever surfaced it. "Windows PowerShell (Admin)" is 5.1 on a default Windows box, and
// it is exactly the shell someone opens to run a migration.
//
// WHY ASCII RATHER THAN A BOM
//
// Adding a BOM also fixes 5.1, but it is a property a future editor, formatter, or
// copy-paste can silently strip — and the failure returns looking like a syntax bug.
// ASCII cannot be un-done by tooling. The typography was never worth a script that
// will not run in half the shells on the target OS.
//
// Prose files (.md) are unaffected and keep their em-dashes.

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Common offenders -> ASCII, so the error message can suggest the fix.
const SUGGEST = new Map([
  [0x2014, '--  (em dash)'],
  [0x2013, '-   (en dash)'],
  [0x2026, '... (ellipsis)'],
  [0x2192, '->  (right arrow)'],
  [0x2018, "'   (left single quote)"],
  [0x2019, "'   (right single quote)"],
  [0x201c, '"   (left double quote)'],
  [0x201d, '"   (right double quote)'],
  [0x00a0, '    (non-breaking space)'],
]);

const files = execSync('git ls-files --cached --others --exclude-standard -- "*.ps1" "*.psm1" "*.psd1"', {
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean);

const findings = [];

for (const file of files) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const ch of lines[i]) {
      const cp = ch.codePointAt(0);
      if (cp > 0x7f) {
        findings.push({ file, line: i + 1, ch, cp });
        break; // one report per line is enough to locate it
      }
    }
  }
}

if (findings.length === 0) {
  console.log(`check-ps1-ascii: OK - ${files.length} PowerShell file(s), pure ASCII.`);
  process.exit(0);
}

console.error('check-ps1-ascii: FAILED - non-ASCII character(s) in PowerShell file(s):\n');
for (const f of findings.slice(0, 40)) {
  const hex = `U+${f.cp.toString(16).toUpperCase().padStart(4, '0')}`;
  const fix = SUGGEST.get(f.cp);
  console.error(`  ${f.file}:${f.line}  ${hex} '${f.ch}'${fix ? `  -> use ${fix}` : ''}`);
}
if (findings.length > 40) console.error(`  ... and ${findings.length - 40} more`);
console.error(
  '\nWindows PowerShell 5.1 reads .ps1 as ANSI unless the file has a UTF-8 BOM, so a\n' +
  'non-ASCII character there produces PARSE ERRORS on syntax that is actually correct.\n' +
  'pwsh 7 parses it fine, which is why this never shows up in normal use - until someone\n' +
  'runs the script from "Windows PowerShell (Admin)".\n\n' +
  'Fix: replace the character with its ASCII equivalent (see suggestions above).\n' +
  'Do not "fix" it by adding a BOM: a BOM is one reformat away from being stripped again.'
);
process.exit(1);
