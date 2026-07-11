import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { PlatformType, TaskStatus } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
import { createUser, createNativeTask } from './helpers.js';

const app = createApp();

/** A tracked Windows task fixture (no agent connected in the integration env). */
async function createWindowsTask(userId: string, name = 'Integration-Schedule') {
  return prisma.task.create({
    data: {
      userId,
      platform: PlatformType.WINDOWS_TASK_SCHEDULER,
      externalId: `\\TaskHub\\${name}`,
      name,
      category: 'TaskHub',
      schedule: '0 3 * * *',
      status: TaskStatus.ACTIVE,
      metadata: { schedule: '0 3 * * *', command: 'echo hi', state: 'Ready' }
    }
  });
}

describe('PATCH /tasks/:id/schedule', () => {
  let owner: Awaited<ReturnType<typeof createUser>>;

  beforeEach(async () => {
    owner = await createUser('scheduler@example.com');
  });

  it('502s on a Windows task when the agent is offline — and the schedule survives', async () => {
    const task = await createWindowsTask(owner.user.id);

    const res = await request(app)
      .patch(`/api/tasks/${task.id}/schedule`)
      .set('Authorization', owner.auth)
      .send({ schedule: '0 8 * * *' });

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/offline/i);
    // The agent never confirmed, so the stored schedule is unchanged.
    const dbTask = await prisma.task.findUnique({ where: { id: task.id } });
    expect(dbTask?.schedule).toBe('0 3 * * *');
  });

  it('400s on an invalid cron expression', async () => {
    const task = await createWindowsTask(owner.user.id, 'Bad-Cron');

    const res = await request(app)
      .patch(`/api/tasks/${task.id}/schedule`)
      .set('Authorization', owner.auth)
      .send({ schedule: 'not a cron' });

    expect(res.status).toBe(400);
    // Never reached the agent (which would 502) — rejected on the cron guard.
    const dbTask = await prisma.task.findUnique({ where: { id: task.id } });
    expect(dbTask?.schedule).toBe('0 3 * * *');
  });

  it('400s on a native task (schedule editing not supported yet)', async () => {
    const task = await createNativeTask(owner.user.id, { name: 'Native No Edit' });

    const res = await request(app)
      .patch(`/api/tasks/${task.id}/schedule`)
      .set('Authorization', owner.auth)
      .send({ schedule: '0 8 * * *' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not supported/i);
  });

  it('404s when the task does not exist', async () => {
    const res = await request(app)
      .patch('/api/tasks/non-existent-id/schedule')
      .set('Authorization', owner.auth)
      .send({ schedule: '0 8 * * *' });

    expect(res.status).toBe(404);
  });

  it('404s/IDOR guard when user B edits user A schedule', async () => {
    const task = await createWindowsTask(owner.user.id, 'User A Schedule');
    const userB = await createUser('scheduler-b@example.com');

    const res = await request(app)
      .patch(`/api/tasks/${task.id}/schedule`)
      .set('Authorization', userB.auth)
      .send({ schedule: '0 8 * * *' });

    expect(res.status).toBe(404);
    const dbTask = await prisma.task.findUnique({ where: { id: task.id } });
    expect(dbTask?.schedule).toBe('0 3 * * *');
  });
});
