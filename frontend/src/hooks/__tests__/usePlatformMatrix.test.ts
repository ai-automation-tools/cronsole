import { describe, it, expect } from 'vitest';
import { newestOutcome, verbSupport, type CapabilityCell, type PlatformMatrixRow } from '../usePlatformMatrix';

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
  access: 'controller',
  configured: true,
  isActive: true,
  healthState: 'HEALTHY',
  healthReason: null,
  lastSync: null,
  taskCount: 0,
  capabilities,
  lastVerifiedAt: null,
  executionHost: null
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

/**
 * The gate behind every capability-driven control, pinned — because getting it
 * wrong is silent in both directions: a missing button looks like a feature that
 * was never built, and a present one looks like a bug only after the click.
 */
describe('verbSupport', () => {
  const matrix = (platform: string, verb: string, support: CapabilityCell['support']) => ({
    platforms: [{ ...row('X', [cell({ verb, support })]), platform }]
  });

  it('says yes for a verb the platform supports', () => {
    expect(verbSupport(matrix('GEMINI_TRIGGERS', 'delete', 'verified'), 'GEMINI_TRIGGERS', 'delete')).toBe('yes');
    // `declared` is a promise the connector made and nothing has exercised yet —
    // still a yes, or a control would be withheld until it had already worked.
    expect(verbSupport(matrix('GEMINI_TRIGGERS', 'delete', 'declared'), 'GEMINI_TRIGGERS', 'delete')).toBe('yes');
  });

  it('says no for a boundary and for a platform with no row', () => {
    expect(verbSupport(matrix('VERCEL_CRON', 'delete', 'unsupported'), 'VERCEL_CRON', 'delete')).toBe('no');
    // Absent from the matrix is a verdict: it covers every platform with a
    // connector, so anything missing is link-only.
    expect(verbSupport(matrix('GEMINI_TRIGGERS', 'delete', 'verified'), 'CHATGPT', 'delete')).toBe('no');
  });

  it('says no when the row exists without that cell', () => {
    expect(verbSupport(matrix('GEMINI_TRIGGERS', 'run', 'verified'), 'GEMINI_TRIGGERS', 'delete')).toBe('no');
  });

  it('says unknown while the matrix is in flight, never no', () => {
    // A destructive control must not vanish because a request has not landed.
    expect(verbSupport(undefined, 'GEMINI_TRIGGERS', 'delete')).toBe('unknown');
  });

  it('says unknown rather than throwing on a shape-surprising body', () => {
    // This runs inside the task modal; a TypeError here blanks the whole modal.
    expect(verbSupport({} as never, 'GEMINI_TRIGGERS', 'delete')).toBe('unknown');
  });
});
