import { describe, it, expect } from 'vitest';
import { matchesTaskSearch } from '../taskSearch';
import type { Task } from '../../types';

const task = (overrides: Partial<Task> = {}): Task => ({
  id: 't1',
  name: 'Nightly Repo Backup',
  category: 'Git-Repos',
  platform: 'WINDOWS_TASK_SCHEDULER',
  status: 'ACTIVE',
  externalId: '\\TaskHub\\Nightly Repo Backup',
  updatedAt: '2026-07-07T00:00:00Z',
  ...overrides
});

describe('matchesTaskSearch', () => {
  it('matches everything on an empty or whitespace query', () => {
    expect(matchesTaskSearch(task(), '')).toBe(true);
    expect(matchesTaskSearch(task(), '   ')).toBe(true);
  });

  it('matches by name, case-insensitively', () => {
    expect(matchesTaskSearch(task(), 'nightly')).toBe(true);
    expect(matchesTaskSearch(task(), 'BACKUP')).toBe(true);
    expect(matchesTaskSearch(task(), 'missing')).toBe(false);
  });

  it('matches by category and externalId path', () => {
    expect(matchesTaskSearch(task(), 'git-repos')).toBe(true);
    expect(matchesTaskSearch(task(), 'taskhub\\nightly')).toBe(true);
  });

  it('matches command stored in metadata', () => {
    const t = task({ metadata: { command: 'powershell -File backup.ps1' } });
    expect(matchesTaskSearch(t, 'backup.ps1')).toBe(true);
    expect(matchesTaskSearch(t, 'python')).toBe(false);
  });

  it('matches schedule from the task or metadata', () => {
    expect(matchesTaskSearch(task({ schedule: '0 8 * * *' }), '0 8')).toBe(true);
    expect(matchesTaskSearch(task({ metadata: { schedule: '0 22 * * 0' } }), '22')).toBe(true);
  });

  it('requires all space-separated terms to match', () => {
    expect(matchesTaskSearch(task(), 'nightly repo')).toBe(true);
    expect(matchesTaskSearch(task(), 'nightly missing')).toBe(false);
  });

  it('handles tasks with no metadata or schedule', () => {
    expect(matchesTaskSearch(task({ metadata: undefined }), 'nightly')).toBe(true);
  });
});
