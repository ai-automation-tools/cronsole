import { describe, it, expect } from 'vitest';
import { windowsTaskNameError } from '../windowsTaskName.js';

describe('windowsTaskNameError', () => {
  it('accepts ordinary names (spaces, hyphens, dots, unicode)', () => {
    expect(windowsTaskNameError('Nightly repo backup')).toBeNull();
    expect(windowsTaskNameError('PowerShell Script')).toBeNull();
    expect(windowsTaskNameError('cleanup-v2.1')).toBeNull();
    expect(windowsTaskNameError('Sicherung taeglich (v2)')).toBeNull();
  });

  it('rejects blank names', () => {
    expect(windowsTaskNameError('')).toMatch(/required/);
    expect(windowsTaskNameError('   ')).toMatch(/required/);
  });

  it('rejects names over 200 characters', () => {
    expect(windowsTaskNameError('x'.repeat(201))).toMatch(/200 characters/);
    expect(windowsTaskNameError('x'.repeat(200))).toBeNull();
  });

  it('rejects Windows-invalid filename characters', () => {
    for (const bad of ['a\\b', 'a/b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b']) {
      expect(windowsTaskNameError(bad)).toMatch(/cannot contain/);
    }
  });

  it('rejects trailing dots (Windows strips them on disk — silent collision)', () => {
    expect(windowsTaskNameError('Backup.')).toMatch(/end with/);
    expect(windowsTaskNameError('v2.1 backup')).toBeNull();
  });

  it('rejects control characters', () => {
    expect(windowsTaskNameError('a' + String.fromCharCode(9) + 'b')).toMatch(/cannot contain/);
    expect(windowsTaskNameError('a' + String.fromCharCode(0) + 'b')).toMatch(/cannot contain/);
  });
});
