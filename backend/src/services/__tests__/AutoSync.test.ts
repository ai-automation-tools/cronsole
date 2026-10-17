import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db.js', () => ({
  prisma: { platformConnection: { findMany: vi.fn(), update: vi.fn() } }
}));
vi.mock('../syncConnection.js', () => ({ syncConnection: vi.fn() }));
vi.mock('../../ws/uiChannel.js', () => ({ notifyTasksChanged: vi.fn() }));

import { prisma } from '../../db.js';
import { syncConnection } from '../syncConnection.js';
import { AutoSync, isAutoSyncDue } from '../AutoSync.js';

const now = new Date('2026-10-16T12:00:00Z');
const conn = (o: Record<string, unknown> = {}) => ({
  id: 'c1', userId: 'u1', platform: 'WINDOWS_TASK_SCHEDULER', isActive: true,
  syncIntervalMin: 15, autoSyncAt: null, ...o
});

describe('isAutoSyncDue', () => {
  it('is off without an interval, inactive, or for native', () => {
    expect(isAutoSyncDue(conn({ syncIntervalMin: null }) as any, now)).toBe(false);
    expect(isAutoSyncDue(conn({ isActive: false }) as any, now)).toBe(false);
    expect(isAutoSyncDue(conn({ platform: 'TASKHUB_NATIVE' }) as any, now)).toBe(false);
  });
  it('is due when never attempted, or an interval has elapsed', () => {
    expect(isAutoSyncDue(conn() as any, now)).toBe(true);
    expect(isAutoSyncDue(conn({ autoSyncAt: new Date(now.getTime() - 15 * 60_000) }) as any, now)).toBe(true);
    expect(isAutoSyncDue(conn({ autoSyncAt: new Date(now.getTime() - 14 * 60_000) }) as any, now)).toBe(false);
  });
});

describe('AutoSync.tick', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refreshes with scope tracked and never an import', async () => {
    (prisma.platformConnection.findMany as any).mockResolvedValue([conn()]);
    await new AutoSync().tick(now);
    expect(syncConnection).toHaveBeenCalledWith(expect.anything(), 'u1', { scope: 'tracked' });
    expect(prisma.platformConnection.update).toHaveBeenCalledWith({
      where: { id: 'c1' }, data: { autoSyncAt: now, autoSyncError: null }
    });
  });

  it('keeps a failure on the row and still syncs the next connection', async () => {
    (prisma.platformConnection.findMany as any).mockResolvedValue([conn(), conn({ id: 'c2' })]);
    (syncConnection as any).mockRejectedValueOnce(new Error('agent offline')).mockResolvedValueOnce({});
    await new AutoSync().tick(now);
    expect(syncConnection).toHaveBeenCalledTimes(2);
    expect(prisma.platformConnection.update).toHaveBeenCalledWith({
      where: { id: 'c1' }, data: { autoSyncAt: now, autoSyncError: 'agent offline' }
    });
  });
});
