import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { PlatformType, TaskStatus } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
import { createUser } from './helpers.js';

const app = createApp();

async function createTask(userId: string, externalId: string) {
  return prisma.task.create({
    data: {
      userId,
      platform: PlatformType.WINDOWS_TASK_SCHEDULER,
      externalId,
      name: externalId.split('\\').pop()!,
      category: 'Backup',
      schedule: '0 15 * * *',
      status: TaskStatus.ACTIVE
    }
  });
}

const suffix = () => Math.random().toString(36).slice(2, 8);

async function listed(auth: string, taskId: string) {
  const res = await request(app).get('/api/tasks').set('Authorization', auth);
  expect(res.status).toBe(200);
  return res.body.find((t: { id: string }) => t.id === taskId) as { isSystem: boolean; hiddenByUser: boolean };
}

describe('moving a task to system tasks', () => {
  let owner: Awaited<ReturnType<typeof createUser>>;

  beforeEach(async () => {
    owner = await createUser(`hidden-${suffix()}@example.com`);
  });

  it('files a task under system tasks and takes it back out, idempotently', async () => {
    const task = await createTask(owner.user.id, `\\Cronsole\\Noisy_${suffix()}`);
    expect(await listed(owner.auth, task.id)).toMatchObject({ isSystem: false, hiddenByUser: false });

    for (let i = 0; i < 2; i++) {
      const res = await request(app).post(`/api/tasks/${task.id}/hidden`).set('Authorization', owner.auth);
      expect(res.status).toBe(200);
    }
    expect(await prisma.taskHidden.count({ where: { taskId: task.id } })).toBe(1);
    expect(await listed(owner.auth, task.id)).toMatchObject({ isSystem: true, hiddenByUser: true });

    const del = await request(app).delete(`/api/tasks/${task.id}/hidden`).set('Authorization', owner.auth);
    expect(del.status).toBe(200);
    expect(await listed(owner.auth, task.id)).toMatchObject({ isSystem: false, hiddenByUser: false });
  });

  it('refuses an OS-owned task — it is a system task already', async () => {
    const task = await createTask(owner.user.id, `\\Microsoft\\Windows\\Defrag_${suffix()}`);
    const res = await request(app).post(`/api/tasks/${task.id}/hidden`).set('Authorization', owner.auth);
    expect(res.status).toBe(400);
    expect(await listed(owner.auth, task.id)).toMatchObject({ isSystem: true, hiddenByUser: false });
  });

  it("404s on another user's task rather than writing a row against it (IDOR)", async () => {
    const other = await createUser(`hidden-other-${suffix()}@example.com`);
    const task = await createTask(other.user.id, `\\Cronsole\\Theirs_${suffix()}`);
    const res = await request(app).post(`/api/tasks/${task.id}/hidden`).set('Authorization', owner.auth);
    expect(res.status).toBe(404);
    expect(await prisma.taskHidden.count({ where: { taskId: task.id } })).toBe(0);
  });

  it('hides it from calendar occurrences too — the same lens on every surface', async () => {
    const task = await createTask(owner.user.id, `\\Cronsole\\Daily_${suffix()}`);
    await request(app).post(`/api/tasks/${task.id}/hidden`).set('Authorization', owner.auth);

    const from = new Date().toISOString();
    const to = new Date(Date.now() + 3 * 86400_000).toISOString();
    const res = await request(app)
      .get('/api/tools/occurrences')
      .query({ from, to })
      .set('Authorization', owner.auth);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(task.id);
  });
});

describe('the selection bar’s bulk label routes', () => {
  let owner: Awaited<ReturnType<typeof createUser>>;

  beforeEach(async () => {
    owner = await createUser(`bulk-label-${suffix()}@example.com`);
  });

  it('hides many tasks per item: updated, unchanged, refused (OS-owned) and notFound', async () => {
    const a = await createTask(owner.user.id, `\\Cronsole\\A_${suffix()}`);
    const b = await createTask(owner.user.id, `\\Cronsole\\B_${suffix()}`);
    const os = await createTask(owner.user.id, `\\Microsoft\\Windows\\X_${suffix()}`);
    await request(app).post(`/api/tasks/${b.id}/hidden`).set('Authorization', owner.auth);

    const res = await request(app)
      .post('/api/tools/tasks/hidden')
      .set('Authorization', owner.auth)
      .send({ taskIds: [a.id, b.id, os.id, 'nope'], on: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ requested: 4, updated: 1, unchanged: 1, refused: 1, notFound: ['nope'] });
    expect(await prisma.taskHidden.count({ where: { userId: owner.user.id } })).toBe(2);

    const back = await request(app)
      .post('/api/tools/tasks/hidden')
      .set('Authorization', owner.auth)
      .send({ taskIds: [a.id, b.id], on: false });
    expect(back.body).toMatchObject({ updated: 2 });
    expect(await prisma.taskHidden.count({ where: { userId: owner.user.id } })).toBe(0);
  });

  it("favorites many tasks and never touches another user's", async () => {
    const mine = await createTask(owner.user.id, `\\Cronsole\\Mine_${suffix()}`);
    const other = await createUser(`bulk-label-other-${suffix()}@example.com`);
    const theirs = await createTask(other.user.id, `\\Cronsole\\Theirs_${suffix()}`);

    const res = await request(app)
      .post('/api/tools/tasks/favorite')
      .set('Authorization', owner.auth)
      .send({ taskIds: [mine.id, theirs.id], on: true });
    expect(res.body).toMatchObject({ updated: 1, notFound: [theirs.id] });
    expect(await prisma.taskFavorite.count({ where: { taskId: theirs.id } })).toBe(0);
    expect(await prisma.taskFavorite.count({ where: { taskId: mine.id, userId: owner.user.id } })).toBe(1);
  });
});
