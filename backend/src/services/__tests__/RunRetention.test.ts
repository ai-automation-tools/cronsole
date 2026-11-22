import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db.js', () => ({
  prisma: { executionLog: { deleteMany: vi.fn() } }
}));

import { prisma } from '../../db.js';
import { pruneExecutionLogs, retentionDays, DEFAULT_RETENTION_DAYS } from '../RunRetention.js';

const now = new Date('2026-11-20T12:00:00Z');

describe('retentionDays', () => {
  it('defaults when unset or blank', () => {
    expect(retentionDays(undefined)).toBe(DEFAULT_RETENTION_DAYS);
    expect(retentionDays('  ')).toBe(DEFAULT_RETENTION_DAYS);
  });
  it('reads a whole number, and 0 means keep forever', () => {
    expect(retentionDays('30')).toBe(30);
    expect(retentionDays('0')).toBe(0);
  });
  it('falls back to the default on a typo rather than switching pruning off', () => {
    for (const bad of ['abc', '-5', '1.5', 'forever']) expect(retentionDays(bad)).toBe(DEFAULT_RETENTION_DAYS);
  });
});

describe('pruneExecutionLogs', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes only rows older than the window', async () => {
    (prisma.executionLog.deleteMany as any).mockResolvedValue({ count: 7 });
    await expect(pruneExecutionLogs(now, 30)).resolves.toBe(7);
    expect(prisma.executionLog.deleteMany).toHaveBeenCalledWith({
      where: { triggeredAt: { lt: new Date('2026-10-21T12:00:00Z') } }
    });
  });
  it('touches nothing when retention is off', async () => {
    await expect(pruneExecutionLogs(now, 0)).resolves.toBe(0);
    expect(prisma.executionLog.deleteMany).not.toHaveBeenCalled();
  });
});
