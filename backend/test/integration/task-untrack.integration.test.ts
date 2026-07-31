import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { PlatformType, TaskStatus } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
import { createUser, createNativeTask } from './helpers.js';

const app = createApp();

/**
 * Untrack is the reversible half of removal, and its whole safety argument is
 * that it makes **no platform call**. A mocked unit test cannot show that: the
 * proof is that the DB row goes, the exclusion row appears, and the connector is
 * never asked for anything — so this runs against real Postgres.
 *
 * The other property worth pinning here is the one that would make the feature
 * *look* broken: an exclusion must actually survive and be readable, because a
 * forgotten exclusion means the next sync re-imports what the user removed.
 */
async function createWindowsTask(userId: string, name: string, folder = 'Edge-Radar') {
  return prisma.task.create({
    data: {
      userId,
      platform: PlatformType.WINDOWS_TASK_SCHEDULER,
      externalId: `\\${folder}\\${name}`,
      name,
      category: folder,
      schedule: '0 3 * * *',
      status: TaskStatus.ACTIVE,
      metadata: { command: 'echo hi' }
    }
  });
}

describe('POST /tasks/:id/untrack', () => {
  let owner: Awaited<ReturnType<typeof createUser>>;

  beforeEach(async () => {
    owner = await createUser('untrack@example.com');
  });

  it('removes the Cronsole row and remembers the exclusion', async () => {
    const task = await createWindowsTask(owner.user.id, 'Noisy');

    const res = await request(app)
      .post(`/api/tasks/${task.id}/untrack`)
      .set('Authorization', owner.auth)
      .expect(200);

    // The response has to be readable by a caller with no UI (an MCP client),
    // so "the platform entry survived" is stated, not implied by the verb.
    expect(res.body.platformEntryKept).toBe(true);
    expect(res.body.externalId).toBe('\\Edge-Radar\\Noisy');

    expect(await prisma.task.findUnique({ where: { id: task.id } })).toBeNull();
    expect(await prisma.taskExclusion.findUnique({
      where: {
        userId_platform_externalId: {
          userId: owner.user.id,
          platform: PlatformType.WINDOWS_TASK_SCHEDULER,
          externalId: '\\Edge-Radar\\Noisy'
        }
      }
    })).not.toBeNull();
  });

  it('cascades the execution logs, like every other row removal', async () => {
    const task = await createWindowsTask(owner.user.id, 'HadHistory');
    await prisma.executionLog.create({
      data: { taskId: task.id, status: 'SUCCESS', log: 'ran before it was untracked' }
    });

    await request(app)
      .post(`/api/tasks/${task.id}/untrack`)
      .set('Authorization', owner.auth)
      .expect(200);

    expect(await prisma.executionLog.count({ where: { taskId: task.id } })).toBe(0);
  });

  it('can be repeated after a re-import without colliding on the unique key', async () => {
    const first = await createWindowsTask(owner.user.id, 'Repeat');
    await request(app)
      .post(`/api/tasks/${first.id}/untrack`)
      .set('Authorization', owner.auth)
      .expect(200);

    // The task comes back (a re-import), and the user removes it again. An
    // insert here would 409 on @@unique([userId, platform, externalId]).
    const second = await createWindowsTask(owner.user.id, 'Repeat');
    await request(app)
      .post(`/api/tasks/${second.id}/untrack`)
      .set('Authorization', owner.auth)
      .expect(200);

    expect(await prisma.taskExclusion.count({ where: { userId: owner.user.id } })).toBe(1);
  });

  it('refuses Cronsole-native tasks instead of quietly deleting them', async () => {
    // A native task exists nowhere but here, so "remove but keep it" cannot be
    // true. Doing a delete under a reversible label is the exact mistake this
    // feature exists to prevent, so it must refuse rather than accommodate.
    const native = await createNativeTask(owner.user.id, { name: 'Backend-Owned' });

    const res = await request(app)
      .post(`/api/tasks/${native.id}/untrack`)
      .set('Authorization', owner.auth)
      .expect(400);

    expect(res.body.error).toMatch(/exist only inside Cronsole/i);
    expect(await prisma.task.findUnique({ where: { id: native.id } })).not.toBeNull();
  });

  it("cannot untrack another user's task", async () => {
    const other = await createUser('other-untrack@example.com');
    const theirs = await createWindowsTask(other.user.id, 'NotYours');

    await request(app)
      .post(`/api/tasks/${theirs.id}/untrack`)
      .set('Authorization', owner.auth)
      .expect(404);

    expect(await prisma.task.findUnique({ where: { id: theirs.id } })).not.toBeNull();
    expect(await prisma.taskExclusion.count()).toBe(0);
  });

  it('404s on an unknown id without recording an exclusion', async () => {
    await request(app)
      .post('/api/tasks/does-not-exist/untrack')
      .set('Authorization', owner.auth)
      .expect(404);

    expect(await prisma.taskExclusion.count()).toBe(0);
  });
});
