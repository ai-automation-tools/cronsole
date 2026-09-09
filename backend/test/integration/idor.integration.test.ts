import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { createUser, createNativeTask, createNativeConnection } from './helpers.js';

// Regression suite for the P0 multi-tenancy route scoping (docs/ROADMAP.md P0
// "Multi-tenancy basics"). Before that fix, by-id task routes looked tasks up by
// id alone, so any authenticated user could read/mutate/run/delete another user's
// task (IDOR — the run path is remote command execution on someone else's agent).
// These tests drive the real routes against a real Postgres to lock that closed.

const app = createApp();

describe('multi-tenancy / IDOR', () => {
  let alice: Awaited<ReturnType<typeof createUser>>;
  let bob: Awaited<ReturnType<typeof createUser>>;
  let aliceTask: Awaited<ReturnType<typeof createNativeTask>>;

  beforeEach(async () => {
    alice = await createUser('alice@example.com');
    bob = await createUser('bob@example.com');
    await createNativeConnection(alice.user.id);
    aliceTask = await createNativeTask(alice.user.id, { name: 'Alice Nightly' });
    // Bob owns an unrelated task so list-scoping has something to exclude.
    await createNativeTask(bob.user.id, { name: 'Bob Nightly' });
  });

  it('GET /tasks returns only the caller\'s tasks', async () => {
    const res = await request(app).get('/api/tasks').set('Authorization', alice.auth);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Alice Nightly');
    expect(res.body[0].userId).toBe(alice.user.id);
  });

  it('rejects an unauthenticated request', async () => {
    const res = await request(app).get('/api/tasks');
    expect(res.status).toBe(401);
  });

  it('404s when Bob reads Alice\'s task executions', async () => {
    const res = await request(app)
      .get(`/api/tasks/${aliceTask.id}/executions`)
      .set('Authorization', bob.auth);
    expect(res.status).toBe(404);
  });

  it('404s when Bob patches Alice\'s task (and does not mutate it)', async () => {
    const res = await request(app)
      .patch(`/api/tasks/${aliceTask.id}`)
      .set('Authorization', bob.auth)
      .send({ category: 'Hijacked' });
    expect(res.status).toBe(404);

    // The owner still sees the original category — Bob's write never landed.
    const check = await request(app).get('/api/tasks').set('Authorization', alice.auth);
    expect(check.body[0].category).toBe('Cronsole');
  });

  it('404s when Bob deletes Alice\'s task (and it survives)', async () => {
    const res = await request(app)
      .delete(`/api/tasks/${aliceTask.id}`)
      .set('Authorization', bob.auth);
    expect(res.status).toBe(404);

    const check = await request(app).get('/api/tasks').set('Authorization', alice.auth);
    expect(check.body).toHaveLength(1);
  });

  it('404s when Bob runs Alice\'s task (IDOR → RCE path)', async () => {
    const res = await request(app)
      .post(`/api/tasks/${aliceTask.id}/run`)
      .set('Authorization', bob.auth);
    expect(res.status).toBe(404);
  });

  it('lets the owner patch their own task', async () => {
    const res = await request(app)
      .patch(`/api/tasks/${aliceTask.id}`)
      .set('Authorization', alice.auth)
      .send({ category: 'Renamed' });
    expect(res.status).toBe(200);
    expect(res.body.category).toBe('Renamed');
  });
});
