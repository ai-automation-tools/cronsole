import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
import { createUser, createNativeTask } from './helpers.js';

const app = createApp();

/**
 * Collections — named, hand-picked sets of tasks.
 *
 * Against real Postgres because the two things most worth pinning here are
 * database guarantees rather than route logic: the **unique name per user**, and
 * the **cascade** that takes a membership with its task. Both are constraints in
 * the schema, so a unit test with a stubbed client would assert the mock.
 *
 * The other half is ownership. A membership row is the one place a task id from
 * one tenant could end up attached to another tenant's grouping, so every route
 * that accepts an id is exercised across two users.
 */
describe('collections', () => {
  let owner: Awaited<ReturnType<typeof createUser>>;

  beforeEach(async () => {
    owner = await createUser('collections@example.com');
  });

  const create = (body: unknown) =>
    request(app).post('/api/collections').set('Authorization', owner.auth).send(body);

  it('creates a collection and seeds it with the tasks given', async () => {
    const a = await createNativeTask(owner.user.id, { name: 'Claude digest' });
    const b = await createNativeTask(owner.user.id, { name: 'Windows backup' });

    const res = await create({ name: 'Morning checks', taskIds: [a.id, b.id] }).expect(201);

    expect(res.body.name).toBe('Morning checks');
    expect(res.body.count).toBe(2);
    expect([...res.body.taskIds].sort()).toEqual([a.id, b.id].sort());
  });

  // The feature's whole reason for existing: a set a filter could not describe.
  it('holds tasks that share no filterable property', async () => {
    const claude = await prisma.task.create({
      data: {
        userId: owner.user.id,
        platform: 'CLAUDE_CODE',
        externalId: 'routine_1',
        name: 'PR review',
        category: 'Claude',
        schedule: '0 7 * * 1-5',
        status: 'ACTIVE'
      }
    });
    const windows = await prisma.task.create({
      data: {
        userId: owner.user.id,
        platform: 'WINDOWS_TASK_SCHEDULER',
        externalId: '\\AI-Tools\\Nightly',
        name: 'Nightly',
        category: 'AI-Tools',
        schedule: '0 3 * * *',
        status: 'DISABLED'
      }
    });

    const res = await create({ name: 'View2', taskIds: [claude.id, windows.id] }).expect(201);

    // Different platform, category, schedule and status — declared membership is
    // the only thing that groups these two.
    expect(res.body.count).toBe(2);
  });

  it('refuses a duplicate name for the same user, but not across users', async () => {
    await create({ name: 'View2' }).expect(201);
    await create({ name: 'View2' }).expect(409);

    const other = await createUser('other-collections@example.com');
    await request(app)
      .post('/api/collections')
      .set('Authorization', other.auth)
      .send({ name: 'View2' })
      .expect(201);
  });

  it('adds and removes members in one call, idempotently', async () => {
    const a = await createNativeTask(owner.user.id, { name: 'A' });
    const b = await createNativeTask(owner.user.id, { name: 'B' });
    const made = await create({ name: 'Set', taskIds: [a.id] }).expect(201);

    const res = await request(app)
      .post(`/api/collections/${made.body.id}/members`)
      .set('Authorization', owner.auth)
      // `a` is already in (no-op), `b` joins, and a non-member is removed.
      .send({ add: [a.id, b.id], remove: [a.id === b.id ? '' : 'not-a-member'] })
      .expect(200);

    expect([...res.body.taskIds].sort()).toEqual([a.id, b.id].sort());
  });

  it('names the ids it ignored rather than silently shipping a smaller set', async () => {
    const mine = await createNativeTask(owner.user.id, { name: 'Mine' });
    const other = await createUser('stranger@example.com');
    const theirs = await createNativeTask(other.user.id, { name: 'Theirs' });
    const made = await create({ name: 'Set' }).expect(201);

    const res = await request(app)
      .post(`/api/collections/${made.body.id}/members`)
      .set('Authorization', owner.auth)
      .send({ add: [mine.id, theirs.id, 'ghost'] })
      .expect(200);

    expect(res.body.taskIds).toEqual([mine.id]);
    expect([...res.body.ignored].sort()).toEqual([theirs.id, 'ghost'].sort());
  });

  // IDOR: the one row in this feature that could point across tenants.
  it("never stores another user's task, even when asked directly", async () => {
    const other = await createUser('victim@example.com');
    const theirs = await createNativeTask(other.user.id, { name: 'Theirs' });

    const made = await create({ name: 'Set', taskIds: [theirs.id] }).expect(201);

    expect(made.body.count).toBe(0);
    const rows = await prisma.taskCollectionMember.count();
    expect(rows).toBe(0);
  });

  it("cannot touch another user's collection", async () => {
    const other = await createUser('owner2@example.com');
    const theirs = await request(app)
      .post('/api/collections')
      .set('Authorization', other.auth)
      .send({ name: 'Theirs' })
      .expect(201);

    await request(app)
      .patch(`/api/collections/${theirs.body.id}`)
      .set('Authorization', owner.auth)
      .send({ name: 'Hijacked' })
      .expect(404);

    await request(app)
      .delete(`/api/collections/${theirs.body.id}`)
      .set('Authorization', owner.auth)
      .expect(404);

    await request(app)
      .post(`/api/collections/${theirs.body.id}/members`)
      .set('Authorization', owner.auth)
      .send({ add: [] })
      .expect(404);
  });

  /**
   * The cascade, in both directions, and it is the decision most worth pinning:
   * a membership is a preference about a task Cronsole is *tracking*, so it dies
   * with the task — the `TaskFavorite` rule, not the `TaskExclusion` one. If this
   * ever flips to surviving, a re-imported task silently rejoins a collection the
   * user never re-added it to.
   */
  it('drops a membership when its task is deleted, leaving the collection', async () => {
    const task = await createNativeTask(owner.user.id, { name: 'Doomed' });
    const made = await create({ name: 'Set', taskIds: [task.id] }).expect(201);

    await prisma.task.delete({ where: { id: task.id } });

    const after = await request(app)
      .get('/api/collections')
      .set('Authorization', owner.auth)
      .expect(200);

    expect(after.body).toHaveLength(1);
    expect(after.body[0].count).toBe(0);
  });

  it('deleting a collection removes the grouping and never the tasks', async () => {
    const task = await createNativeTask(owner.user.id, { name: 'Survivor' });
    const made = await create({ name: 'Set', taskIds: [task.id] }).expect(201);

    await request(app)
      .delete(`/api/collections/${made.body.id}`)
      .set('Authorization', owner.auth)
      .expect(200);

    expect(await prisma.taskCollectionMember.count()).toBe(0);
    // The task is untouched — this control removes a grouping, not work.
    expect(await prisma.task.findUnique({ where: { id: task.id } })).not.toBeNull();
  });

  it('orders the rail by position, with creation order as the tiebreak', async () => {
    const first = await create({ name: 'First' }).expect(201);
    await create({ name: 'Second' }).expect(201);

    await request(app)
      .patch(`/api/collections/${first.body.id}`)
      .set('Authorization', owner.auth)
      .send({ position: 5 })
      .expect(200);

    const list = await request(app)
      .get('/api/collections')
      .set('Authorization', owner.auth)
      .expect(200);

    expect(list.body.map((c: { name: string }) => c.name)).toEqual(['Second', 'First']);
  });

  it('reports each task’s memberships on the task list', async () => {
    const task = await createNativeTask(owner.user.id, { name: 'Watched' });
    const made = await create({ name: 'Set', taskIds: [task.id] }).expect(201);

    const tasks = await request(app)
      .get('/api/tasks')
      .set('Authorization', owner.auth)
      .expect(200);

    const row = tasks.body.find((t: { id: string }) => t.id === task.id);
    expect(row.collectionIds).toEqual([made.body.id]);
  });

  it("does not leak another user's collection ids onto a task list", async () => {
    const task = await createNativeTask(owner.user.id, { name: 'Mine' });
    await create({ name: 'Mine too', taskIds: [task.id] }).expect(201);

    const other = await createUser('nosy@example.com');
    const tasks = await request(app)
      .get('/api/tasks')
      .set('Authorization', other.auth)
      .expect(200);

    expect(tasks.body).toHaveLength(0);
  });

  it('rejects an empty or over-long name', async () => {
    await create({ name: '   ' }).expect(400);
    await create({ name: 'x'.repeat(61) }).expect(400);
  });
});
