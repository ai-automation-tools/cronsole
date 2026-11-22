import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { ExecutionStatus, PlatformType, TaskStatus } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
import { createUser } from './helpers.js';

const app = createApp();

describe('GET /api/tasks recentRuns', () => {
  it('carries the last 7 recorded runs, newest first, beside the last-run summary', async () => {
    const { user, auth } = await createUser('recent-runs@example.com');
    const task = await prisma.task.create({
      data: {
        userId: user.id,
        platform: PlatformType.TASKHUB_NATIVE,
        externalId: `native_${Math.random().toString(36).slice(2, 10)}`,
        name: 'Strip',
        category: 'Checks',
        schedule: '0 * * * *',
        status: TaskStatus.ACTIVE
      }
    });
    // Nine runs an hour apart; the newest (i = 8) is a failure.
    const base = Date.UTC(2026, 10, 13, 0, 0, 0);
    await prisma.executionLog.createMany({
      data: Array.from({ length: 9 }, (_, i) => ({
        taskId: task.id,
        triggeredAt: new Date(base + i * 3600_000),
        status: i === 8 ? ExecutionStatus.FAILURE : ExecutionStatus.SUCCESS
      }))
    });

    const res = await request(app).get('/api/tasks').set('Authorization', auth);
    expect(res.status).toBe(200);
    const row = res.body.find((t: { id: string }) => t.id === task.id);

    expect(row.recentRuns).toHaveLength(7);
    expect(row.recentRuns[0]).toEqual({ status: 'FAILURE', triggeredAt: new Date(base + 8 * 3600_000).toISOString() });
    expect(row.recentRuns.slice(1).every((r: { status: string }) => r.status === 'SUCCESS')).toBe(true);
    expect(row.lastRunStatus).toBe('FAILURE');
  });

  it('is empty for a task Cronsole has never recorded a run of', async () => {
    const { user, auth } = await createUser('recent-runs-empty@example.com');
    const task = await prisma.task.create({
      data: {
        userId: user.id,
        platform: PlatformType.WINDOWS_TASK_SCHEDULER,
        externalId: '\\Cronsole\\Never',
        name: 'Never',
        category: 'Cronsole',
        status: TaskStatus.ACTIVE
      }
    });
    const res = await request(app).get('/api/tasks').set('Authorization', auth);
    const row = res.body.find((t: { id: string }) => t.id === task.id);
    expect(row.recentRuns).toEqual([]);
    expect(row.lastRunStatus).toBeNull();
  });
});
