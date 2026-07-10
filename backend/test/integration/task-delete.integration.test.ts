import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { PlatformType, TaskStatus } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
import { createUser, createNativeTask } from './helpers.js';

// DELETE /tasks/:id now spans platforms: native rows are backend-owned (plain
// DB delete), Windows rows require the agent to confirm removal of the real
// scheduler entry first, and platforms without connector deleteTask support
// keep the honest 400. No agent is connected in the integration harness, so
// the Windows path exercises the offline-refusal branch — the DB row must
// survive when the platform can't confirm the delete.

const app = createApp();

describe('DELETE /tasks/:id per platform', () => {
  let owner: Awaited<ReturnType<typeof createUser>>;

  beforeEach(async () => {
    owner = await createUser('deleter@example.com');
  });

  it('deletes a native task and its execution logs', async () => {
    const task = await createNativeTask(owner.user.id, { name: 'Doomed Native' });
    await prisma.executionLog.create({
      data: { taskId: task.id, status: 'SUCCESS', log: 'ran once' }
    });

    const res = await request(app)
      .delete(`/api/tasks/${task.id}`)
      .set('Authorization', owner.auth);

    expect(res.status).toBe(200);
    expect(await prisma.task.findUnique({ where: { id: task.id } })).toBeNull();
    expect(await prisma.executionLog.count({ where: { taskId: task.id } })).toBe(0);
  });

  it('502s on a Windows task when the agent is offline — and the row survives', async () => {
    const task = await prisma.task.create({
      data: {
        userId: owner.user.id,
        platform: PlatformType.WINDOWS_TASK_SCHEDULER,
        externalId: '\\TaskHub\\Integration-Delete',
        name: 'Integration-Delete',
        category: 'TaskHub',
        status: TaskStatus.ACTIVE
      }
    });

    const res = await request(app)
      .delete(`/api/tasks/${task.id}`)
      .set('Authorization', owner.auth);

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/offline/i);
    // The scheduler entry couldn't be confirmed gone, so TaskHub keeps the row.
    expect(await prisma.task.findUnique({ where: { id: task.id } })).not.toBeNull();
  });

  it('400s on a platform without native delete support', async () => {
    const task = await prisma.task.create({
      data: {
        userId: owner.user.id,
        platform: PlatformType.CLAUDE_CODE,
        externalId: 'claude-routine-1',
        name: 'Claude Routine',
        category: 'Claude',
        status: TaskStatus.ACTIVE
      }
    });

    const res = await request(app)
      .delete(`/api/tasks/${task.id}`)
      .set('Authorization', owner.auth);

    expect(res.status).toBe(400);
    expect(await prisma.task.findUnique({ where: { id: task.id } })).not.toBeNull();
  });
});
