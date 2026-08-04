import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { PlatformType, TaskStatus } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
import { createUser, createNativeTask } from './helpers.js';

const app = createApp();

/**
 * The two bulk verbs that touch **only** Cronsole's database — recategorize and
 * untrack. Both are pure Prisma work, which is exactly why they need real
 * Postgres: the unit tests prove the planners decide correctly, and by
 * construction cannot prove that the decision was written, scoped to the owner,
 * or wrapped in a transaction. Those are the three ways this feature can be
 * silently wrong.
 *
 * Bulk enable/disable is not here on purpose — every one of its writes is
 * conditional on a platform round-trip, so it belongs with the agent-backed
 * suites rather than beside two verbs whose defining property is that they
 * never leave the database.
 */
async function createWindowsTask(
  userId: string,
  name: string,
  folder = 'Work',
  category?: string
) {
  return prisma.task.create({
    data: {
      userId,
      platform: PlatformType.WINDOWS_TASK_SCHEDULER,
      externalId: `\\${folder}\\${name}`,
      name,
      category: category ?? folder,
      schedule: '0 3 * * *',
      status: TaskStatus.ACTIVE,
      metadata: { command: 'echo hi' }
    }
  });
}

describe('POST /api/tools/tasks/category', () => {
  let owner: Awaited<ReturnType<typeof createUser>>;

  beforeEach(async () => {
    owner = await createUser('bulk-category@example.com');
  });

  it('moves every selected task and reports per item', async () => {
    const a = await createWindowsTask(owner.user.id, 'A');
    const b = await createWindowsTask(owner.user.id, 'B');

    const res = await request(app)
      .post('/api/tools/tasks/category')
      .set('Authorization', owner.auth)
      .send({ taskIds: [a.id, b.id], category: 'Backups' })
      .expect(200);

    expect(res.body.updated).toBe(2);
    expect(res.body.items).toHaveLength(2);

    const rows = await prisma.task.findMany({ where: { id: { in: [a.id, b.id] } } });
    expect(rows.every(r => r.category === 'Backups')).toBe(true);
  });

  it('does not rewrite a task already in the target category', async () => {
    const already = await createWindowsTask(owner.user.id, 'Already', 'Work', 'Backups');
    const moving = await createWindowsTask(owner.user.id, 'Moving');

    const res = await request(app)
      .post('/api/tools/tasks/category')
      .set('Authorization', owner.auth)
      .send({ taskIds: [already.id, moving.id], category: 'Backups' })
      .expect(200);

    expect(res.body.updated).toBe(1);
    expect(res.body.unchanged).toBe(1);
  });

  it("says how many labels no longer match the task's real Windows folder", async () => {
    // The honesty property. A Windows task's category is derived from its Task
    // Scheduler folder, so relabelling makes the dashboard group tasks
    // differently from the machine. Legitimate — but the user has to be told,
    // and the count has to come from the server's own path rule rather than
    // anything the browser re-derives.
    const task = await createWindowsTask(owner.user.id, 'Nightly', 'Work');

    const res = await request(app)
      .post('/api/tools/tasks/category')
      .set('Authorization', owner.auth)
      .send({ taskIds: [task.id], category: 'Backups' })
      .expect(200);

    expect(res.body.detachedFromFolder).toBe(1);
    expect(res.body.summary).toMatch(/differently from its Windows folder/);
  });

  it('leaves the native path untouched — the label moves, the task does not', async () => {
    const task = await createWindowsTask(owner.user.id, 'Nightly', 'Work');

    await request(app)
      .post('/api/tools/tasks/category')
      .set('Authorization', owner.auth)
      .send({ taskIds: [task.id], category: 'Backups' })
      .expect(200);

    const row = await prisma.task.findUnique({ where: { id: task.id } });
    expect(row?.externalId).toBe('\\Work\\Nightly');
  });

  it("cannot recategorize another user's task", async () => {
    const other = await createUser('other-category@example.com');
    const theirs = await createWindowsTask(other.user.id, 'NotYours');
    const mine = await createWindowsTask(owner.user.id, 'Mine');

    const res = await request(app)
      .post('/api/tools/tasks/category')
      .set('Authorization', owner.auth)
      .send({ taskIds: [mine.id, theirs.id], category: 'Backups' })
      .expect(200);

    // Reported as not found rather than silently dropped — a caller who asked
    // for two and is told about one has no way to know which one vanished.
    expect(res.body.notFound).toEqual([theirs.id]);
    expect((await prisma.task.findUnique({ where: { id: theirs.id } }))?.category).toBe('Work');
  });

  it('404s when nothing matched at all', async () => {
    await request(app)
      .post('/api/tools/tasks/category')
      .set('Authorization', owner.auth)
      .send({ taskIds: ['nope'], category: 'Backups' })
      .expect(404);
  });

  it('refuses a batch above the limit rather than truncating it', async () => {
    const res = await request(app)
      .post('/api/tools/tasks/category')
      .set('Authorization', owner.auth)
      .send({ taskIds: Array.from({ length: 101 }, (_, i) => `id-${i}`), category: 'X' })
      .expect(400);

    expect(res.body.error).toMatch(/above the 100 limit/);
  });

  it('does not let a repeated id inflate the batch past the limit', async () => {
    // De-duplication happens BEFORE the size check, or 101 copies of one id
    // would be refused as if it were 101 tasks.
    const task = await createWindowsTask(owner.user.id, 'One');

    const res = await request(app)
      .post('/api/tools/tasks/category')
      .set('Authorization', owner.auth)
      .send({ taskIds: Array.from({ length: 101 }, () => task.id), category: 'Backups' })
      .expect(200);

    expect(res.body.requested).toBe(1);
    expect(res.body.updated).toBe(1);
  });
});

describe('POST /api/tools/tasks/untrack', () => {
  let owner: Awaited<ReturnType<typeof createUser>>;

  beforeEach(async () => {
    owner = await createUser('bulk-untrack@example.com');
  });

  it('removes the rows and records an exclusion for every one of them', async () => {
    // The exclusion is the half that is easy to lose and impossible to notice:
    // without it the next sync re-imports exactly what the user just removed,
    // which is correct by the sync's logic and indistinguishable from "untrack
    // is broken" from the outside.
    const a = await createWindowsTask(owner.user.id, 'A');
    const b = await createWindowsTask(owner.user.id, 'B');

    const res = await request(app)
      .post('/api/tools/tasks/untrack')
      .set('Authorization', owner.auth)
      .send({ taskIds: [a.id, b.id] })
      .expect(200);

    expect(res.body.updated).toBe(2);
    expect(res.body.platformEntriesKept).toBe(true);

    expect(await prisma.task.count({ where: { id: { in: [a.id, b.id] } } })).toBe(0);
    const exclusions = await prisma.taskExclusion.findMany({ where: { userId: owner.user.id } });
    expect(exclusions.map(e => e.externalId).sort()).toEqual(['\\Work\\A', '\\Work\\B']);
  });

  it('cascades execution logs, like every other row removal', async () => {
    const task = await createWindowsTask(owner.user.id, 'HadHistory');
    await prisma.executionLog.create({
      data: { taskId: task.id, status: 'SUCCESS', log: 'ran before it was untracked' }
    });

    await request(app)
      .post('/api/tools/tasks/untrack')
      .set('Authorization', owner.auth)
      .send({ taskIds: [task.id] })
      .expect(200);

    expect(await prisma.executionLog.count({ where: { taskId: task.id } })).toBe(0);
  });

  it('refuses a native task per item without halting the rest of the batch', async () => {
    // A per-task refusal says nothing about the next task. Halting here would
    // punish a mixed selection — which is the normal selection — for containing
    // one task that cannot be untracked.
    const win = await createWindowsTask(owner.user.id, 'Windows');
    const native = await createNativeTask(owner.user.id, { name: 'Backend-Owned' });

    const res = await request(app)
      .post('/api/tools/tasks/untrack')
      .set('Authorization', owner.auth)
      .send({ taskIds: [win.id, native.id] })
      .expect(200);

    expect(res.body.updated).toBe(1);
    expect(res.body.refused).toBe(1);
    expect(res.body.skipped).toBe(0);

    expect(await prisma.task.findUnique({ where: { id: win.id } })).toBeNull();
    // The refused one is untouched, not deleted under a gentler name.
    expect(await prisma.task.findUnique({ where: { id: native.id } })).not.toBeNull();
  });

  it('can be repeated after a re-import without colliding on the unique key', async () => {
    const first = await createWindowsTask(owner.user.id, 'Repeat');
    await request(app)
      .post('/api/tools/tasks/untrack')
      .set('Authorization', owner.auth)
      .send({ taskIds: [first.id] })
      .expect(200);

    const second = await createWindowsTask(owner.user.id, 'Repeat');
    await request(app)
      .post('/api/tools/tasks/untrack')
      .set('Authorization', owner.auth)
      .send({ taskIds: [second.id] })
      .expect(200);

    expect(await prisma.taskExclusion.count({ where: { userId: owner.user.id } })).toBe(1);
  });

  it("cannot untrack another user's task", async () => {
    const other = await createUser('other-bulk-untrack@example.com');
    const theirs = await createWindowsTask(other.user.id, 'NotYours');
    const mine = await createWindowsTask(owner.user.id, 'Mine');

    const res = await request(app)
      .post('/api/tools/tasks/untrack')
      .set('Authorization', owner.auth)
      .send({ taskIds: [mine.id, theirs.id] })
      .expect(200);

    expect(res.body.notFound).toEqual([theirs.id]);
    expect(await prisma.task.findUnique({ where: { id: theirs.id } })).not.toBeNull();
    // And no exclusion was recorded against a task that was never theirs to
    // remove — an exclusion is per-user, so a leaked one would quietly hide a
    // task from the wrong person's next sync.
    expect(await prisma.taskExclusion.count({ where: { userId: other.user.id } })).toBe(0);
  });
});
