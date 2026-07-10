import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { PlatformType } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
import { TaskService, NormalizedTask } from '../../src/services/TaskService.js';
import { createUser } from './helpers.js';

// End-to-end data-flow checks against a real Postgres: the native-create route,
// and TaskService.upsertTasks' batched $transaction path at a size that spans
// multiple batches (the batch size is 100).

const app = createApp();

describe('native task creation', () => {
  it('creates a TASKHUB_NATIVE task with a computed nextRunTime', async () => {
    const { user, auth } = await createUser('native@example.com');

    const res = await request(app)
      .post('/api/tasks/native')
      .set('Authorization', auth)
      .send({
        name: 'Health Ping',
        schedule: '*/5 * * * *',
        job: { jobType: 'HTTP', url: 'https://example.com/health', method: 'GET' }
      });

    expect(res.status).toBe(200);
    expect(res.body.task.name).toBe('Health Ping');
    expect(res.body.task.platform).toBe(PlatformType.TASKHUB_NATIVE);
    expect(res.body.task.nextRunTime).toBeTruthy();

    const list = await request(app).get('/api/tasks').set('Authorization', auth);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].userId).toBe(user.id);
  });

  it('rejects a native job that is not an HTTP URL (400)', async () => {
    const { auth } = await createUser('native2@example.com');
    const res = await request(app)
      .post('/api/tasks/native')
      .set('Authorization', auth)
      .send({ name: 'Bad', schedule: '0 0 * * *', job: { jobType: 'HTTP', url: 'not-a-url' } });
    expect(res.status).toBe(400);
  });
});

describe('TaskService.upsertTasks batching', () => {
  it('persists a >100-task sync across multiple $transaction batches, in order', async () => {
    const { user } = await createUser('bulk@example.com');
    const tasks: NormalizedTask[] = Array.from({ length: 250 }, (_, i) => ({
      externalId: `\\Bulk\\Task${String(i).padStart(3, '0')}`,
      name: `Task ${i}`,
      status: 'ACTIVE' as const
    }));

    const created = await TaskService.upsertTasks(user.id, PlatformType.WINDOWS_TASK_SCHEDULER, tasks);
    expect(created).toHaveLength(250);
    expect(created[0].externalId).toBe('\\Bulk\\Task000');
    expect(created[249].externalId).toBe('\\Bulk\\Task249');

    const count = await prisma.task.count({ where: { userId: user.id } });
    expect(count).toBe(250);

    // Re-running is idempotent (update path) — still 250 rows, no duplicates.
    await TaskService.upsertTasks(user.id, PlatformType.WINDOWS_TASK_SCHEDULER, tasks);
    expect(await prisma.task.count({ where: { userId: user.id } })).toBe(250);
  });

  it('removeStaleTasks prunes tasks missing from the current platform list', async () => {
    const { user } = await createUser('stale@example.com');
    const tasks: NormalizedTask[] = Array.from({ length: 5 }, (_, i) => ({
      externalId: `\\S\\Task${i}`,
      name: `Task ${i}`,
      status: 'ACTIVE' as const
    }));
    await TaskService.upsertTasks(user.id, PlatformType.WINDOWS_TASK_SCHEDULER, tasks);

    // Only the first two still exist on the platform.
    const removed = await TaskService.removeStaleTasks(
      user.id,
      PlatformType.WINDOWS_TASK_SCHEDULER,
      ['\\S\\Task0', '\\S\\Task1']
    );
    expect(removed).toBe(3);
    expect(await prisma.task.count({ where: { userId: user.id } })).toBe(2);
  });
});
