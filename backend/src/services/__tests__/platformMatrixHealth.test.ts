import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PlatformType, HealthState } from '@prisma/client';

/**
 * **The matrix reports health it just asked for, not health someone stored.**
 *
 * `PlatformConnection.healthState` is written by exactly one place: the loop in
 * `GET /api/tasks/health`, the dashboard's 45-second poll. Nothing on the MCP
 * surface writes it — `get_task_health` wraps `GET /tools/task-health`, a
 * different route — so `list_platforms` in an agent-only session was serving
 * whatever verdict the last browser poll left behind, with no field saying how
 * old it was.
 *
 * Measured on a live install before this fix: the matrix said `OFFLINE / "Agent
 * not connected"` while `get_diagnostics` said the agent was connected in the
 * same second, and while the row's own `listFolders` cell carried a success from
 * a minute earlier. Troubleshooting #40's shape — a verdict from something that
 * cannot change when the subject recovers — one layer down, in the cache.
 *
 * These cases pin the three things that fix has to keep true.
 */

vi.mock('../../db.js', () => ({
  prisma: {
    platformConnection: { findMany: vi.fn() },
    platformCapability: { findMany: vi.fn() },
    task: { groupBy: vi.fn() }
  }
}));

// Claude's capabilities depend on whether a Claude Code session is readable on
// this host, so the suite states which world it is in rather than inheriting the
// developer's machine (the rule platformCapabilities.test.ts already follows).
vi.mock('../claudeOAuth.js', () => ({ getClaudeCredential: vi.fn(() => ({ credential: null, problem: 'no-file' })) }));

import { prisma } from '../../db.js';
import { connectorRegistry } from '../../connectors/registry.js';
import { buildPlatformMatrix } from '../platformCapabilities.js';

const findMany = prisma.platformConnection.findMany as unknown as ReturnType<typeof vi.fn>;
const capabilities = prisma.platformCapability.findMany as unknown as ReturnType<typeof vi.fn>;
const groupBy = prisma.task.groupBy as unknown as ReturnType<typeof vi.fn>;

/**
 * A connection whose stored verdict is the stale lie the fix exists to stop
 * serving. `config` is a plain object on purpose: `deserializeConfig` reads a
 * non-string as a legacy plaintext row, so these cases need no encryption key.
 */
const staleHealthyConnection = {
  id: 'conn_1',
  platform: PlatformType.WINDOWS_TASK_SCHEDULER,
  config: {},
  isActive: true,
  healthState: HealthState.HEALTHY,
  healthReason: null,
  lastSync: null
};

const windowsRow = async () => {
  const matrix = await buildPlatformMatrix('user_1');
  return matrix.find(r => r.platform === PlatformType.WINDOWS_TASK_SCHEDULER)!;
};

beforeEach(() => {
  findMany.mockResolvedValue([staleHealthyConnection]);
  capabilities.mockResolvedValue([]);
  groupBy.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildPlatformMatrix — health is live, not cached', () => {
  it('reports the connector\'s verdict, not the stored one', async () => {
    // No agent socket is registered in a unit test, so the real connector's
    // getHealth answers OFFLINE. The stored column says HEALTHY. Reading the
    // column would return HEALTHY and this assertion is what catches it.
    const row = await windowsRow();

    expect(row.healthState).toBe(HealthState.OFFLINE);
    expect(row.healthReason).toBe('Agent not connected');
  });

  it('does not carry the stored reason under a live state', async () => {
    // The "stale explanation filed under a fresh state" bug, which is why state
    // and reason must be taken from one source together rather than field by
    // field. A recovered platform must not keep yesterday's reason.
    findMany.mockResolvedValue([
      { ...staleHealthyConnection, healthState: HealthState.DEGRADED, healthReason: 'task:folders timed out' }
    ]);
    vi.spyOn(connectorRegistry, 'getConnector').mockReturnValue({
      getHealth: async () => ({ state: HealthState.HEALTHY })
    } as never);

    const row = await windowsRow();

    expect(row.healthState).toBe(HealthState.HEALTHY);
    expect(row.healthReason).toBeNull();
  });

  it('degrades a throwing connector to UNKNOWN without failing the matrix', async () => {
    // A readout may not fail the thing it reports on, and one platform that
    // cannot describe itself must not cost the others their row.
    vi.spyOn(connectorRegistry, 'getConnector').mockReturnValue({
      getHealth: async () => {
        throw new Error('connector exploded');
      }
    } as never);

    const matrix = await buildPlatformMatrix('user_1');
    const row = matrix.find(r => r.platform === PlatformType.WINDOWS_TASK_SCHEDULER)!;

    expect(row.healthState).toBe(HealthState.UNKNOWN);
    expect(matrix.length).toBeGreaterThan(1);
  });

  it('leaves an unconfigured platform null rather than inventing a verdict', async () => {
    // No PlatformConnection row means nothing has ever been asked of it. That is
    // absence of evidence, and absence of evidence is never `ok`.
    const matrix = await buildPlatformMatrix('user_1');
    const claude = matrix.find(r => r.platform === PlatformType.CLAUDE_CODE)!;

    expect(claude.configured).toBe(false);
    expect(claude.healthState).toBeNull();
    expect(claude.healthReason).toBeNull();
  });
});
