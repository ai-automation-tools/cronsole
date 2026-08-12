import { describe, it, expect } from 'vitest';
import { newestOutcome, type CapabilityCell, type PlatformMatrixRow } from '../usePlatformMatrix';

/**
 * The health strip's one derived value, pinned — because its whole job is to be
 * the thing that does NOT go quiet when something breaks.
 */

const cell = (over: Partial<CapabilityCell>): CapabilityCell => ({
  verb: 'run',
  label: 'Run now',
  description: '',
  support: 'verified',
  lastSuccessAt: null,
  lastFailureAt: null,
  lastFailureReason: null,
  ...over
});

const row = (label: string, capabilities: CapabilityCell[]): PlatformMatrixRow => ({
  platform: 'WINDOWS_TASK_SCHEDULER',
  label,
  summary: '',
  maturity: 'functional',
  configured: true,
  isActive: true,
  healthState: 'HEALTHY',
  healthReason: null,
  lastSync: null,
  taskCount: 0,
  capabilities,
  lastVerifiedAt: null
});

describe('newestOutcome', () => {
  it('is null when nothing has ever been recorded', () => {
    // Absence renders as absence. A strip that invented "all good" here would be
    // asserting something it has not measured.
    expect(newestOutcome([])).toBeNull();
    expect(newestOutcome(undefined)).toBeNull();
    expect(newestOutcome([row('Windows', [cell({})])])).toBeNull();
  });

  it('prefers the newest event regardless of which verb it came from', () => {
    const result = newestOutcome([
      row('Windows', [
        cell({ verb: 'run', label: 'Run now', lastSuccessAt: '2026-08-01T00:00:00Z' }),
        cell({ verb: 'sync', label: 'Sync', lastSuccessAt: '2026-08-09T00:00:00Z' })
      ])
    ]);
    expect(result?.verbLabel).toBe('Sync');
    expect(result?.ok).toBe(true);
  });

  it('surfaces a failure that is newer than the success on the SAME verb', () => {
    // The case the whole function exists for: a verb that worked last week and
    // broke this morning must read as broken, not as verified.
    const result = newestOutcome([
      row('Windows', [
        cell({
          label: 'Edit schedule',
          lastSuccessAt: '2026-08-01T00:00:00Z',
          lastFailureAt: '2026-08-11T00:00:00Z',
          lastFailureReason: 'Agent request timed out'
        })
      ])
    ]);
    expect(result?.ok).toBe(false);
    expect(result?.reason).toBe('Agent request timed out');
  });

  it('does not let an older failure outrank a newer success', () => {
    const result = newestOutcome([
      row('Windows', [
        cell({
          label: 'Run now',
          lastFailureAt: '2026-08-01T00:00:00Z',
          lastFailureReason: 'offline',
          lastSuccessAt: '2026-08-11T00:00:00Z'
        })
      ])
    ]);
    expect(result?.ok).toBe(true);
  });

  it('compares across platforms, not just within one', () => {
    const result = newestOutcome([
      row('Windows', [cell({ label: 'Run now', lastSuccessAt: '2026-08-01T00:00:00Z' })]),
      row('Cronsole-native', [cell({ label: 'Create', lastSuccessAt: '2026-08-10T00:00:00Z' })])
    ]);
    expect(result?.platformLabel).toBe('Cronsole-native');
    expect(result?.verbLabel).toBe('Create');
  });
});
