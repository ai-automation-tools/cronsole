import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { PlatformType, TaskStatus } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
import { createUser, createNativeTask } from './helpers.js';

const app = createApp();

describe('PATCH /tasks/:id/status per platform', () => {
  let owner: Awaited<ReturnType<typeof createUser>>;

  beforeEach(async () => {
    owner = await createUser('statuser@example.com');
  });

  it('updates status of a native task to DISABLED and then ACTIVE', async () => {
    const task = await createNativeTask(owner.user.id, { name: 'Toggle Native' });

    // Enable -> Disable
    const resDisable = await request(app)
      .patch(`/api/tasks/${task.id}/status`)
      .set('Authorization', owner.auth)
      .send({ status: TaskStatus.DISABLED });

    expect(resDisable.status).toBe(200);
    expect(resDisable.body.status).toBe(TaskStatus.DISABLED);
    expect(resDisable.body.nextRunTime).toBeNull();

    const dbTask = await prisma.task.findUnique({ where: { id: task.id } });
    expect(dbTask?.status).toBe(TaskStatus.DISABLED);
    expect(dbTask?.nextRunTime).toBeNull();

    // Disable -> Enable
    const resEnable = await request(app)
      .patch(`/api/tasks/${task.id}/status`)
      .set('Authorization', owner.auth)
      .send({ status: TaskStatus.ACTIVE });

    expect(resEnable.status).toBe(200);
    expect(resEnable.body.status).toBe(TaskStatus.ACTIVE);
    expect(resEnable.body.nextRunTime).not.toBeNull();

    const dbTaskEnabled = await prisma.task.findUnique({ where: { id: task.id } });
    expect(dbTaskEnabled?.status).toBe(TaskStatus.ACTIVE);
    expect(dbTaskEnabled?.nextRunTime).not.toBeNull();
  });

  it('502s on a Windows task when the agent is offline — and the row status survives', async () => {
    const task = await prisma.task.create({
      data: {
        userId: owner.user.id,
        platform: PlatformType.WINDOWS_TASK_SCHEDULER,
        externalId: '\\TaskHub\\Integration-Status',
        name: 'Integration-Status',
        category: 'TaskHub',
        status: TaskStatus.ACTIVE
      }
    });

    const res = await request(app)
      .patch(`/api/tasks/${task.id}/status`)
      .set('Authorization', owner.auth)
      .send({ status: TaskStatus.DISABLED });

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/offline/i);
    // The status couldn't be confirmed updated on the agent, so the DB status survives.
    const dbTask = await prisma.task.findUnique({ where: { id: task.id } });
    expect(dbTask?.status).toBe(TaskStatus.ACTIVE);
  });

  it('400s on invalid status parameter', async () => {
    const task = await createNativeTask(owner.user.id, { name: 'Invalid Status Test' });

    const res = await request(app)
      .patch(`/api/tasks/${task.id}/status`)
      .set('Authorization', owner.auth)
      .send({ status: 'INVALID_STATUS' });

    expect(res.status).toBe(400);
  });

  it('404s when attempting to update status of a non-existent task', async () => {
    const res = await request(app)
      .patch('/api/tasks/non-existent-id/status')
      .set('Authorization', owner.auth)
      .send({ status: TaskStatus.DISABLED });

    expect(res.status).toBe(404);
  });

  it('404s/IDOR guard when user B attempts to update user A task status', async () => {
    const task = await createNativeTask(owner.user.id, { name: 'User A Task' });
    const userB = await createUser('userb@example.com');

    const res = await request(app)
      .patch(`/api/tasks/${task.id}/status`)
      .set('Authorization', userB.auth)
      .send({ status: TaskStatus.DISABLED });

    expect(res.status).toBe(404);
  });
});
