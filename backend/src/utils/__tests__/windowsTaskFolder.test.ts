import { describe, it, expect } from 'vitest';
import {
  windowsTaskFolderError,
  normalizeWindowsTaskFolder,
  windowsTaskPath,
  DEFAULT_TASK_FOLDER
} from '../windowsTaskFolder.js';

describe('windowsTaskFolderError', () => {
  it('accepts the default folder', () => {
    expect(windowsTaskFolderError(DEFAULT_TASK_FOLDER)).toBeNull();
  });

  it('accepts a user folder and a nested one', () => {
    expect(windowsTaskFolderError('\\Work')).toBeNull();
    expect(windowsTaskFolderError('\\Work\\Backups')).toBeNull();
  });

  it('accepts the root folder — third-party tasks legitimately live there', () => {
    expect(windowsTaskFolderError('\\')).toBeNull();
  });

  it('accepts forward slashes, since callers may send either separator', () => {
    expect(windowsTaskFolderError('/Work/Backups')).toBeNull();
  });

  describe('the \\Microsoft\\ refusal', () => {
    // RegisterTaskDefinition silently overwrites a same-named task in the same
    // folder, and the agent runs elevated — so this is the guard that stops a
    // caller (including an AI via MCP) from clobbering a real Windows task.
    it('refuses \\Microsoft', () => {
      expect(windowsTaskFolderError('\\Microsoft')).toMatch(/will not create tasks under/i);
    });

    it('refuses descendants of \\Microsoft', () => {
      expect(windowsTaskFolderError('\\Microsoft\\Windows')).not.toBeNull();
      expect(windowsTaskFolderError('\\Microsoft\\Windows\\SystemRestore')).not.toBeNull();
    });

    it('refuses regardless of case — Windows paths are case-insensitive', () => {
      expect(windowsTaskFolderError('\\microsoft')).not.toBeNull();
      expect(windowsTaskFolderError('\\MICROSOFT\\Windows')).not.toBeNull();
      expect(windowsTaskFolderError('\\MiCrOsOfT\\windows')).not.toBeNull();
    });

    it('refuses when reached with forward slashes', () => {
      expect(windowsTaskFolderError('/Microsoft/Windows')).not.toBeNull();
    });

    it('allows a folder that merely starts with the same letters', () => {
      // \MicrosoftEdgeBackups is not \Microsoft — segment equality, not prefix.
      expect(windowsTaskFolderError('\\MicrosoftEdgeBackups')).toBeNull();
    });

    it('allows Microsoft as a NON-root segment', () => {
      // \Work\Microsoft is the user's own folder; only the reserved root matters.
      expect(windowsTaskFolderError('\\Work\\Microsoft')).toBeNull();
    });
  });

  describe('traversal', () => {
    it('refuses .. segments', () => {
      expect(windowsTaskFolderError('\\Work\\..\\Microsoft')).toMatch(/\.\./);
      expect(windowsTaskFolderError('\\..')).not.toBeNull();
    });

    it('refuses . segments', () => {
      expect(windowsTaskFolderError('\\Work\\.\\Backups')).not.toBeNull();
    });

    it('refuses traversal that would otherwise land in \\Microsoft', () => {
      // Belt and braces: even if a caller tries to reach the reserved root by
      // traversal, the .. check fires before the reserved-root check.
      expect(windowsTaskFolderError('\\Cronsole\\..\\Microsoft\\Windows')).not.toBeNull();
    });
  });

  describe('segment rules', () => {
    it('refuses characters Windows rejects', () => {
      for (const bad of ['\\Wo:rk', '\\Wo*rk', '\\Wo?rk', '\\Wo"rk', '\\Wo<rk', '\\Wo>rk', '\\Wo|rk']) {
        expect(windowsTaskFolderError(bad), bad).not.toBeNull();
      }
    });

    it('refuses control characters', () => {
      expect(windowsTaskFolderError('\\Wo\x01rk')).not.toBeNull();
    });

    it('refuses trailing dots and spaces — Windows silently strips them', () => {
      expect(windowsTaskFolderError('\\Work.')).not.toBeNull();
      expect(windowsTaskFolderError('\\Work ')).not.toBeNull();
    });

    it('refuses empty input', () => {
      expect(windowsTaskFolderError('')).not.toBeNull();
      expect(windowsTaskFolderError('   ')).not.toBeNull();
    });

    it('refuses an over-deep path', () => {
      expect(windowsTaskFolderError('\\a\\b\\c\\d\\e\\f\\g\\h\\i')).toMatch(/levels deep/);
    });

    it('refuses an over-long segment', () => {
      expect(windowsTaskFolderError('\\' + 'a'.repeat(201))).toMatch(/characters or fewer/);
    });
  });
});

describe('normalizeWindowsTaskFolder', () => {
  it('canonicalizes separators and trailing slashes', () => {
    expect(normalizeWindowsTaskFolder('\\Work\\')).toBe('\\Work');
    expect(normalizeWindowsTaskFolder('/Work/Backups')).toBe('\\Work\\Backups');
    expect(normalizeWindowsTaskFolder('Work')).toBe('\\Work');
  });

  it('collapses duplicate separators', () => {
    expect(normalizeWindowsTaskFolder('\\\\Work\\\\Backups')).toBe('\\Work\\Backups');
  });

  it('normalizes the root to a single backslash', () => {
    expect(normalizeWindowsTaskFolder('\\')).toBe('\\');
    expect(normalizeWindowsTaskFolder('')).toBe('\\');
  });
});

describe('windowsTaskPath', () => {
  it('joins folder and name', () => {
    expect(windowsTaskPath('\\Cronsole', 'Nightly')).toBe('\\Cronsole\\Nightly');
    expect(windowsTaskPath('\\Work\\Backups', 'Nightly')).toBe('\\Work\\Backups\\Nightly');
  });

  it('does not double the separator at the root', () => {
    expect(windowsTaskPath('\\', 'Nightly')).toBe('\\Nightly');
  });

  it('matches the legacy hardcoded path for the default folder', () => {
    // The old code built `\Cronsole\${name}` directly; existing externalIds must
    // keep resolving identically or every tracked task stops matching.
    expect(windowsTaskPath(DEFAULT_TASK_FOLDER, 'Nightly')).toBe('\\Cronsole\\Nightly');
  });
});
