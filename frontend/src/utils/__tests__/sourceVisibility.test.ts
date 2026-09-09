import { describe, it, expect } from 'vitest';
import {
  sourceVisibility,
  railListedPlatforms,
  toggleShownSource
} from '../sourceVisibility';
import type { PlatformMatrixRow } from '../../hooks/usePlatformMatrix';

const row = (over: Partial<PlatformMatrixRow> = {}): PlatformMatrixRow => ({
  platform: 'GITHUB_ACTIONS',
  label: 'GitHub Actions',
  summary: '',
  maturity: 'functional',
  access: 'observer',
  configured: false,
  isActive: false,
  healthState: null,
  healthReason: null,
  lastSync: null,
  taskCount: 0,
  capabilities: [],
  lastVerifiedAt: null,
  executionHost: null,
  ...over
});

describe('sourceVisibility', () => {
  it('shows a source the user asked for', () => {
    expect(sourceVisibility(row(), ['GITHUB_ACTIONS'])).toEqual({
      shown: true,
      canHide: true,
      heldBy: null
    });
  });

  it('hides a source that is empty, unconnected and not asked for', () => {
    expect(sourceVisibility(row(), []).shown).toBe(false);
  });

  it('shows a source holding tasks, and refuses to let it be hidden', () => {
    // The rule that makes hiding safe at all: hiding is about an empty row you
    // do not want, never about tasks you would then be unable to find.
    const v = sourceVisibility(row({ taskCount: 3 }), []);
    expect(v.shown).toBe(true);
    expect(v.canHide).toBe(false);
    expect(v.heldBy).toBe('tasks');
  });

  it('shows a connected source without a second gesture', () => {
    // Connecting *is* asking for it. Making someone connect and then also tick
    // "show" would be two confirmations of one decision.
    const v = sourceVisibility(row({ configured: true }), []);
    expect(v.shown).toBe(true);
    expect(v.canHide).toBe(false);
    expect(v.heldBy).toBe('connection');
  });

  it('reports tasks over a connection when both hold it', () => {
    // Tasks are the stronger reason and the one worth saying: disconnecting
    // would not make the row hideable while its tasks are still there.
    expect(sourceVisibility(row({ taskCount: 1, configured: true }), []).heldBy).toBe('tasks');
  });
});

describe('railListedPlatforms', () => {
  it('unions the preference, the connections and the matrix', () => {
    const listed = railListedPlatforms(
      [row({ platform: 'GITHUB_ACTIONS', taskCount: 2 })],
      ['CLAUDE_CODE'],
      ['WINDOWS_TASK_SCHEDULER']
    );
    expect(listed.sort()).toEqual(['CLAUDE_CODE', 'GITHUB_ACTIONS', 'WINDOWS_TASK_SCHEDULER']);
  });

  it('still lists the local facts while the matrix is in flight', () => {
    // The matrix arrives over the network. An empty rail for one paint is worse
    // than a rail that gains a row a moment later.
    expect(railListedPlatforms(undefined, ['CLAUDE_CODE'], ['WINDOWS_TASK_SCHEDULER']).sort())
      .toEqual(['CLAUDE_CODE', 'WINDOWS_TASK_SCHEDULER']);
  });

  it('omits a matrix row that is empty, unconnected and unasked for', () => {
    expect(railListedPlatforms([row()], [], ['WINDOWS_TASK_SCHEDULER']))
      .toEqual(['WINDOWS_TASK_SCHEDULER']);
  });

  it('lists each platform once however many facts hold it', () => {
    const listed = railListedPlatforms(
      [row({ platform: 'WINDOWS_TASK_SCHEDULER', taskCount: 9, configured: true })],
      ['WINDOWS_TASK_SCHEDULER'],
      ['WINDOWS_TASK_SCHEDULER']
    );
    expect(listed).toEqual(['WINDOWS_TASK_SCHEDULER']);
  });
});

describe('toggleShownSource', () => {
  it('adds and removes without mutating the input', () => {
    const before = ['WINDOWS_TASK_SCHEDULER'];
    const added = toggleShownSource(before, 'GITHUB_ACTIONS');
    expect(added).toEqual(['WINDOWS_TASK_SCHEDULER', 'GITHUB_ACTIONS']);
    expect(before).toEqual(['WINDOWS_TASK_SCHEDULER']);
    expect(toggleShownSource(added, 'GITHUB_ACTIONS')).toEqual(['WINDOWS_TASK_SCHEDULER']);
  });
});
