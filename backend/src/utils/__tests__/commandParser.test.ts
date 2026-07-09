import { describe, it, expect } from 'vitest';
import {
  parseCommandLine,
  toStructuredAction,
  canonicalizeAction,
} from '../commandParser.js';

const US = String.fromCharCode(0x1f);

describe('parseCommandLine', () => {
  it('splits a simple command on whitespace', () => {
    expect(parseCommandLine('git -C repo pull')).toEqual(['git', '-C', 'repo', 'pull']);
  });

  it('keeps a double-quoted path (with spaces) as one token, quotes stripped', () => {
    expect(parseCommandLine('python "C:\\my script.py" --flag')).toEqual([
      'python',
      'C:\\my script.py',
      '--flag',
    ]);
  });

  it('treats single quotes and backslashes as literal', () => {
    // Embedded PowerShell: the whole -Command string is one double-quoted token,
    // single quotes inside are preserved verbatim.
    expect(
      parseCommandLine(`powershell.exe -Command "Write-Host 'hi there'"`)
    ).toEqual(['powershell.exe', '-Command', "Write-Host 'hi there'"]);
  });

  it('collapses runs of whitespace', () => {
    expect(parseCommandLine('a   b\t c')).toEqual(['a', 'b', 'c']);
  });

  it('preserves an explicit empty quoted token', () => {
    expect(parseCommandLine('app "" x')).toEqual(['app', '', 'x']);
  });
});

describe('toStructuredAction', () => {
  it('takes the first token as the executable and the rest as args', () => {
    expect(toStructuredAction('powershell.exe -NoProfile -File "C:\\x.ps1"')).toEqual({
      executable: 'powershell.exe',
      args: ['-NoProfile', '-File', 'C:\\x.ps1'],
    });
  });

  it('handles an empty command', () => {
    expect(toStructuredAction('   ')).toEqual({ executable: '', args: [] });
  });

  it('isolates an injection attempt into a single argument (no shell to split it)', () => {
    // A malicious {{scriptPath}} value quoted in the template stays one arg.
    expect(toStructuredAction('python "evil.py & calc.exe"')).toEqual({
      executable: 'python',
      args: ['evil.py & calc.exe'],
    });
  });
});

describe('canonicalizeAction', () => {
  it('joins executable + args with the unit separator', () => {
    expect(canonicalizeAction({ executable: 'python', args: ['a b', 'c'] })).toBe(
      `python${US}a b${US}c`
    );
  });

  it('is just the executable when there are no args', () => {
    expect(canonicalizeAction({ executable: 'dir', args: [] })).toBe('dir');
  });
});
