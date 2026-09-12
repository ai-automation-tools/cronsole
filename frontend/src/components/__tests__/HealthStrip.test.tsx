import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { ConnectionHealth } from '../../types';

/**
 * The strip's job is to be the one line you can trust at a glance, so these
 * tests are mostly about what it must NOT say.
 *
 * That framing is deliberate. The bug that produced the UNKNOWN state was not a
 * missing warning — it was a *green* one: with only three health states, a
 * platform nothing had heard from since the previous evening either sat amber
 * forever or, once the stale verdict was cleared, fell through to
 * "All 3 platforms online". Asserting the good text appears would pass in both
 * worlds. Asserting the false claim is absent is the test that has teeth.
 */

let connections: ConnectionHealth[] = [];

// Partial mock: the real `healthMeta` is kept, because the labels it returns are
// half of what is being asserted here. Stubbing it would leave these tests
// agreeing with a fixture instead of with the component's actual output.
vi.mock('../../hooks/useConnections', async importActual => ({
  ...(await importActual<typeof import('../../hooks/useConnections')>()),
  useConnections: () => ({ data: connections }),
}));

vi.mock('../../hooks/usePlatformMatrix', () => ({
  usePlatformMatrix: () => ({ data: { platforms: [] } }),
  newestOutcome: () => null,
}));

import { HealthStrip } from '../HealthStrip';

const conn = (platform: string, state: ConnectionHealth['state'], reason?: string): ConnectionHealth =>
  ({ platform, state, reason, lastSync: '2026-08-13T04:04:54.992Z' }) as ConnectionHealth;

describe('HealthStrip', () => {
  beforeEach(() => {
    connections = [];
  });

  it('never reports "all platforms online" while one is unverified', () => {
    connections = [
      conn('TASKHUB_NATIVE', 'HEALTHY'),
      conn('CLAUDE_CODE', 'HEALTHY'),
      conn('WINDOWS_TASK_SCHEDULER', 'UNKNOWN', 'task:folders timed out, and nothing has been asked of the agent since'),
    ];

    render(<HealthStrip />);

    // The claim that must not appear. Two of the three really are online, which
    // is exactly what makes the sentence tempting and wrong.
    expect(screen.queryByText(/platforms online/i)).not.toBeInTheDocument();
    expect(screen.getByText(/not checked/i)).toBeInTheDocument();
    // And it names which one, or the reader cannot act on it.
    expect(screen.getByText(/Windows/)).toBeInTheDocument();
    expect(screen.getByText(/nothing has been asked of the agent since/)).toBeInTheDocument();
  });

  it('ranks an observed problem above an absence of observation', () => {
    // Both are non-healthy, and only one is evidence. A degraded platform is
    // something to go and fix; an unverified one is something to go and check.
    connections = [
      conn('WINDOWS_TASK_SCHEDULER', 'UNKNOWN', 'task:folders timed out'),
      conn('CLAUDE_CODE', 'DEGRADED', 'Last run failed'),
    ];

    render(<HealthStrip />);

    expect(screen.getByText(/degraded/i)).toBeInTheDocument();
    expect(screen.queryByText(/not checked/i)).not.toBeInTheDocument();
  });

  it('still says everything is online when everything actually is', () => {
    // The counterweight: over-suppressing the green line would make the strip
    // useless in the normal case, which is most of the time.
    connections = [conn('TASKHUB_NATIVE', 'HEALTHY'), conn('WINDOWS_TASK_SCHEDULER', 'HEALTHY')];

    render(<HealthStrip />);

    expect(screen.getByText(/All 2 platforms online/i)).toBeInTheDocument();
  });

  it('says the agent is unelevated as a fact beside health, not as a health problem (#74)', () => {
    // elevated: false is not a health problem — it is a fact about the
    // reader's field of view, so a HEALTHY-but-unelevated agent must still
    // read as "online", with the sentence rendered alongside rather than
    // replacing it.
    connections = [
      { ...conn('WINDOWS_TASK_SCHEDULER', 'HEALTHY'), elevated: false },
    ];

    render(<HealthStrip />);

    expect(screen.getByText(/Windows online/i)).toBeInTheDocument();
    expect(screen.getByText(/running unelevated/i)).toBeInTheDocument();
  });

  it('says nothing about elevation once the agent confirms it, or when it has not said', () => {
    connections = [{ ...conn('WINDOWS_TASK_SCHEDULER', 'HEALTHY'), elevated: true }];
    render(<HealthStrip />);
    expect(screen.queryByText(/unelevated/i)).not.toBeInTheDocument();
  });
});
