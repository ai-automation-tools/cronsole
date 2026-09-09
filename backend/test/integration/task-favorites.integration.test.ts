import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { PlatformType, TaskStatus } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
import { createUser } from './helpers.js';

const app = createApp();

async function createTask(userId: string, name = 'Fixture Task') {
  return prisma.task.create({
    data: {
      userId,
      platform: PlatformType.WINDOWS_TASK_SCHEDULER,
      externalId: `\\Cronsole\\${name}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      category: 'Backup',
      schedule: '0 15 * * *',
      status: TaskStatus.ACTIVE
    }
  });
}

/** Read one task's isFavorite flag from GET /api/tasks as `auth`. */
async function isFavorite(auth: string, taskId: string): Promise<boolean | undefined> {
  const res = await request(app).get('/api/tasks').set('Authorization', auth);
  expect(res.status).toBe(200);
  return res.body.find((t: { id: string; isFavorite?: boolean }) => t.id === taskId)?.isFavorite;
}

describe('task favorites', () => {
  let owner: Awaited<ReturnType<typeof createUser>>;

  beforeEach(async () => {
    owner = await createUser('taskfav-owner@example.com');
  });

  it('stars a task and reflects it in the list (isFavorite=true)', async () => {
    const task = await createTask(owner.user.id);
    expect(await isFavorite(owner.auth, task.id)).toBe(false);

    const res = await request(app)
      .post(`/api/tasks/${task.id}/favorite`)
      .set('Authorization', owner.auth);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: task.id, isFavorite: true });

    expect(await isFavorite(owner.auth, task.id)).toBe(true);
  });

  it('is idempotent — starring twice keeps a single row', async () => {
    const task = await createTask(owner.user.id);
    await request(app).post(`/api/tasks/${task.id}/favorite`).set('Authorization', owner.auth);
    await request(app).post(`/api/tasks/${task.id}/favorite`).set('Authorization', owner.auth);

    const rows = await prisma.taskFavorite.findMany({
      where: { userId: owner.user.id, taskId: task.id }
    });
    expect(rows).toHaveLength(1);
    expect(await isFavorite(owner.auth, task.id)).toBe(true);
  });

  it('un-stars (idempotent — removing a non-favorite is a success)', async () => {
    const task = await createTask(owner.user.id);

    const pre = await request(app).delete(`/api/tasks/${task.id}/favorite`).set('Authorization', owner.auth);
    expect(pre.status).toBe(200);
    expect(pre.body).toMatchObject({ id: task.id, isFavorite: false });

    await request(app).post(`/api/tasks/${task.id}/favorite`).set('Authorization', owner.auth);
    expect(await isFavorite(owner.auth, task.id)).toBe(true);

    const res = await request(app).delete(`/api/tasks/${task.id}/favorite`).set('Authorization', owner.auth);
    expect(res.status).toBe(200);
    expect(await isFavorite(owner.auth, task.id)).toBe(false);
  });

  it('refuses to star another user’s task (IDOR)', async () => {
    // The difference from template favorites, which are on a *shared* catalog:
    // a task belongs to somebody, so this must 404 rather than write a row
    // pointing at another tenant's task.
    const task = await createTask(owner.user.id);
    const userB = await createUser('taskfav-b@example.com');

    const res = await request(app)
      .post(`/api/tasks/${task.id}/favorite`)
      .set('Authorization', userB.auth);
    expect(res.status).toBe(404);

    expect(await prisma.taskFavorite.count({ where: { taskId: task.id } })).toBe(0);
  });

  it('does not leak stars across users', async () => {
    const task = await createTask(owner.user.id);
    const userB = await createUser('taskfav-c@example.com');

    await request(app).post(`/api/tasks/${task.id}/favorite`).set('Authorization', owner.auth);

    // The owner sees the star; user B cannot see the task at all (it is not
    // theirs), which is a stronger form of "does not leak".
    expect(await isFavorite(owner.auth, task.id)).toBe(true);
    expect(await isFavorite(userB.auth, task.id)).toBeUndefined();
  });

  it('drops the star when the task is deleted', async () => {
    // The favorite is keyed on the Task row and cascades, deliberately unlike
    // TaskExclusion — which is keyed on (platform, externalId) precisely because
    // it must OUTLIVE the row. A star that survived would come back attached to
    // nothing, or worse, to a re-imported task the user never starred.
    const task = await createTask(owner.user.id);
    await request(app).post(`/api/tasks/${task.id}/favorite`).set('Authorization', owner.auth);
    expect(await prisma.taskFavorite.count({ where: { taskId: task.id } })).toBe(1);

    await prisma.task.delete({ where: { id: task.id } });
    expect(await prisma.taskFavorite.count({ where: { taskId: task.id } })).toBe(0);
  });

  it('404s when starring a non-existent task', async () => {
    const res = await request(app)
      .post('/api/tasks/non-existent-id/favorite')
      .set('Authorization', owner.auth);
    expect(res.status).toBe(404);
  });

  it('401s when unauthenticated', async () => {
    const task = await createTask(owner.user.id);
    const res = await request(app).post(`/api/tasks/${task.id}/favorite`);
    expect(res.status).toBe(401);
  });
});
