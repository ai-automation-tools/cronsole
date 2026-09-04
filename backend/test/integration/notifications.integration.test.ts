import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { createNativeTask, createUser } from './helpers.js';

// The one piece of this route that's a real IDOR surface: taskIds narrows a
// webhook to specific tasks, and the route must refuse an id that isn't the
// caller's own rather than silently accepting (and later matching) someone
// else's task.

const app = createApp();

describe('PUT /api/notifications/webhook — task scope', () => {
  it('accepts task ids the caller owns', async () => {
    const { user, auth } = await createUser('scope-owner@example.com');
    const task = await createNativeTask(user.id, { name: 'Nightly backup' });

    const res = await request(app)
      .put('/api/notifications/webhook')
      .set('Authorization', auth)
      .send({
        enabled: true,
        notifyOnFailure: true,
        notifyOnSuccess: false,
        url: 'https://hooks.example.com/cronsole',
        type: 'generic',
        taskIds: [task.id]
      });

    expect(res.status).toBe(200);
    expect(res.body.taskIds).toEqual([task.id]);
  });

  it('refuses a task id belonging to another account', async () => {
    const { auth } = await createUser('scope-attacker@example.com');
    const { user: victim } = await createUser('scope-victim@example.com');
    const victimTask = await createNativeTask(victim.id, { name: 'Someone else\'s task' });

    const res = await request(app)
      .put('/api/notifications/webhook')
      .set('Authorization', auth)
      .send({
        enabled: true,
        notifyOnFailure: true,
        notifyOnSuccess: false,
        url: 'https://hooks.example.com/cronsole',
        type: 'generic',
        taskIds: [victimTask.id]
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain(victimTask.id);
  });

  it('refuses an id that does not exist at all', async () => {
    const { auth } = await createUser('scope-typo@example.com');

    const res = await request(app)
      .put('/api/notifications/webhook')
      .set('Authorization', auth)
      .send({
        enabled: true,
        notifyOnFailure: true,
        notifyOnSuccess: false,
        url: 'https://hooks.example.com/cronsole',
        type: 'generic',
        taskIds: ['not-a-real-task-id']
      });

    expect(res.status).toBe(400);
  });

  it('widens back to every task on an empty list', async () => {
    const { user, auth } = await createUser('scope-widen@example.com');
    const task = await createNativeTask(user.id);

    await request(app)
      .put('/api/notifications/webhook')
      .set('Authorization', auth)
      .send({
        enabled: true,
        notifyOnFailure: true,
        notifyOnSuccess: false,
        url: 'https://hooks.example.com/cronsole',
        type: 'generic',
        taskIds: [task.id]
      });

    const res = await request(app)
      .put('/api/notifications/webhook')
      .set('Authorization', auth)
      .send({
        enabled: true,
        notifyOnFailure: true,
        notifyOnSuccess: false,
        url: 'https://hooks.example.com/cronsole',
        type: 'generic'
      });

    expect(res.status).toBe(200);
    expect(res.body.taskIds).toEqual([]);
  });
});
