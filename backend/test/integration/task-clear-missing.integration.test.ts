import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { PlatformType, TaskStatus } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
import { createUser, createNativeTask } from './helpers.js';

const app = createApp();

/**
 * DELETE /tasks/missing is a *bulk destructive* route, so the properties worth
 * pinning are the ones a mocked unit test structurally cannot reach: that the
 * `where` really scopes to MISSING + owner in Postgres, that the logs cascade,
 * and that Express doesn't route "missing" into `DELETE /:id`.
 */
async function createWindowsTask(
  userId: string,
  name: string,
  status: TaskStatus = TaskStatus.MISSING
) {
  return prisma.task.create({
    data: {
      userId,
      platform: PlatformType.WINDOWS_TASK_SCHEDULER,
      externalId: `\\Edge-Radar\\${name}`,
      name,
      category: 'Edge-Radar',
      schedule: '0 3 * * *',
      status,
      metadata: { command: 'echo hi' }
    }
  });
}

describe('DELETE /tasks/missing', () => {
  let owner: Awaited<ReturnType<typeof createUser>>;

  beforeEach(async () => {
    owner = await createUser('clear-missing@example.com');
  });

  it('deletes only MISSING tasks, leaving every other status untouched', async () => {
    const gone1 = await createWindowsTask(owner.user.id, 'Vanished-1');
    const gone2 = await createWindowsTask(owner.user.id, 'Vanished-2');
    const active = await createWindowsTask(owner.user.id, 'StillHere', TaskStatus.ACTIVE);
    const disabled = await createWindowsTask(owner.user.id, 'Parked', TaskStatus.DISABLED);
    const native = await createNativeTask(owner.user.id, { name: 'Native-Untouched' });

    const res = await request(app)
      .delete('/api/tasks/missing')
      .set('Authorization', owner.auth)
      .expect(200);

    expect(res.body.deleted).toBe(2);

    const survivors = await prisma.task.findMany({
      where: { userId: owner.user.id },
      select: { id: true }
    });
    const ids = survivors.map(t => t.id).sort();
    expect(ids).toEqual([active.id, disabled.id, native.id].sort());
    expect(ids).not.toContain(gone1.id);
    expect(ids).not.toContain(gone2.id);
  });

  it("never touches another user's missing tasks", async () => {
    const other = await createUser('other-clear-missing@example.com');
    const mine = await createWindowsTask(owner.user.id, 'Mine-Gone');
    const theirs = await createWindowsTask(other.user.id, 'Theirs-Gone');

    const res = await request(app)
      .delete('/api/tasks/missing')
      .set('Authorization', owner.auth)
      .expect(200);

    expect(res.body.deleted).toBe(1);
    expect(await prisma.task.findUnique({ where: { id: mine.id } })).toBeNull();
    // Same status, different owner — the scoping has to be on both.
    expect(await prisma.task.findUnique({ where: { id: theirs.id } })).not.toBeNull();
  });

  it('cascades the execution logs of the tasks it removes', async () => {
    const gone = await createWindowsTask(owner.user.id, 'HadHistory');
    await prisma.executionLog.create({
      data: { taskId: gone.id, status: 'SUCCESS', log: 'ran once before it vanished' }
    });

    await request(app)
      .delete('/api/tasks/missing')
      .set('Authorization', owner.auth)
      .expect(200);

    expect(await prisma.executionLog.count({ where: { taskId: gone.id } })).toBe(0);
  });

  it('is a no-op that reports 0 when nothing is missing', async () => {
    await createWindowsTask(owner.user.id, 'Healthy', TaskStatus.ACTIVE);

    const res = await request(app)
      .delete('/api/tasks/missing')
      .set('Authorization', owner.auth)
      .expect(200);

    expect(res.body.deleted).toBe(0);
    expect(await prisma.task.count({ where: { userId: owner.user.id } })).toBe(1);
  });

  it('is not shadowed by DELETE /tasks/:id treating "missing" as a task id', async () => {
    // Express matches in declaration order. If /missing were registered after
    // /:id this would 404 "Task not found" instead of clearing anything — the
    // failure mode is a route that silently never runs.
    await createWindowsTask(owner.user.id, 'Vanished');

    const res = await request(app)
      .delete('/api/tasks/missing')
      .set('Authorization', owner.auth);

    expect(res.status).toBe(200);
    expect(res.body.error).toBeUndefined();
    expect(res.body.deleted).toBe(1);
  });
});
