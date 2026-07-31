import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createServer } from 'http';
import { AddressInfo } from 'net';
import { PlatformType, TaskStatus } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
import { NativeScheduler } from '../../src/services/NativeScheduler.js';
import { flushFailureNotifications } from '../../src/services/FailureNotificationService.js';
import { TaskService, NormalizedTask } from '../../src/services/TaskService.js';
import { createNativeConnection, createUser } from './helpers.js';

// End-to-end data-flow checks against a real Postgres: the native-create route,
// and TaskService.upsertTasks' batched $transaction path at a size that spans
// multiple batches (the batch size is 100).

const app = createApp();

async function withNotificationSink<T>(fn: (url: string, requests: string[]) => Promise<T>): Promise<T> {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      requests.push(body);
      res.statusCode = 204;
      res.end();
    });
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const prevUrl = process.env.CRONSOLE_FAILURE_WEBHOOK_URL;
  const prevType = process.env.CRONSOLE_FAILURE_WEBHOOK_TYPE;
  process.env.CRONSOLE_FAILURE_WEBHOOK_URL = `http://127.0.0.1:${port}/notify`;
  process.env.CRONSOLE_FAILURE_WEBHOOK_TYPE = 'generic';

  try {
    return await fn(process.env.CRONSOLE_FAILURE_WEBHOOK_URL, requests);
  } finally {
    await flushFailureNotifications();
    if (prevUrl === undefined) delete process.env.CRONSOLE_FAILURE_WEBHOOK_URL;
    else process.env.CRONSOLE_FAILURE_WEBHOOK_URL = prevUrl;
    if (prevType === undefined) delete process.env.CRONSOLE_FAILURE_WEBHOOK_TYPE;
    else process.env.CRONSOLE_FAILURE_WEBHOOK_TYPE = prevType;
    await new Promise<void>((resolve, reject) => {
      server.close(err => err ? reject(err) : resolve());
    });
  }
}

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

  it('sends a failure notification when a manual native run fails', async () => {
    const { user, auth } = await createUser('manual-notify@example.com');
    await createNativeConnection(user.id);
    const task = await prisma.task.create({
      data: {
        userId: user.id,
        platform: PlatformType.TASKHUB_NATIVE,
        externalId: 'native_missing_job',
        name: 'Broken native task',
        category: 'Cronsole',
        schedule: '0 3 * * *',
        status: TaskStatus.ACTIVE,
        metadata: {}
      }
    });

    await withNotificationSink(async (_url, requests) => {
      const res = await request(app)
        .post(`/api/tasks/${task.id}/run`)
        .set('Authorization', auth)
        .send({});

      expect(res.status).toBe(500);
      await flushFailureNotifications();
      expect(requests).toHaveLength(1);
      expect(JSON.parse(requests[0]).event).toEqual(expect.objectContaining({
        taskId: task.id,
        taskName: 'Broken native task',
        trigger: 'manual',
        status: 'FAILURE'
      }));
    });
  });

  it('sends a failure notification when a scheduled native run fails', async () => {
    const { user } = await createUser('scheduled-notify@example.com');
    const dueAt = new Date('2026-07-10T20:00:00.000Z');
    const task = await prisma.task.create({
      data: {
        userId: user.id,
        platform: PlatformType.TASKHUB_NATIVE,
        externalId: 'native_scheduled_missing_job',
        name: 'Broken scheduled task',
        category: 'Cronsole',
        schedule: '*/5 * * * *',
        nextRunTime: dueAt,
        status: TaskStatus.ACTIVE,
        metadata: {}
      }
    });

    await withNotificationSink(async (_url, requests) => {
      await new NativeScheduler().tick(dueAt);
      await flushFailureNotifications();

      expect(requests).toHaveLength(1);
      expect(JSON.parse(requests[0]).event).toEqual(expect.objectContaining({
        taskId: task.id,
        taskName: 'Broken scheduled task',
        trigger: 'scheduled',
        status: 'FAILURE'
      }));
    });
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

  it('reconcileMissingTasks marks absent tasks MISSING (keeping the rows) and self-heals on re-sync', async () => {
    const { user } = await createUser('stale@example.com');
    const tasks: NormalizedTask[] = Array.from({ length: 5 }, (_, i) => ({
      externalId: `\\S\\Task${i}`,
      name: `Task ${i}`,
      status: 'ACTIVE' as const,
      nextRunTime: new Date('2026-07-20T03:00:00Z')
    }));
    await TaskService.upsertTasks(user.id, PlatformType.WINDOWS_TASK_SCHEDULER, tasks);

    // Only the first two still exist on the platform.
    const missing = await TaskService.reconcileMissingTasks(
      user.id,
      PlatformType.WINDOWS_TASK_SCHEDULER,
      ['\\S\\Task0', '\\S\\Task1']
    );
    expect(missing).toBe(3);
    // Nothing is deleted — the honest end state keeps the rows.
    expect(await prisma.task.count({ where: { userId: user.id } })).toBe(5);
    const gone = await prisma.task.findMany({
      where: { userId: user.id, status: 'MISSING' },
      orderBy: { externalId: 'asc' }
    });
    expect(gone.map(t => t.externalId)).toEqual(['\\S\\Task2', '\\S\\Task3', '\\S\\Task4']);
    // A MISSING task must not still claim it is due.
    expect(gone.every(t => t.nextRunTime === null)).toBe(true);

    // Re-marking is idempotent: an already-MISSING row is excluded, so a second
    // reconcile against the same list flips nothing new.
    expect(
      await TaskService.reconcileMissingTasks(user.id, PlatformType.WINDOWS_TASK_SCHEDULER, ['\\S\\Task0', '\\S\\Task1'])
    ).toBe(0);

    // Self-heal: a later sync that sees Task2 again upserts it back to ACTIVE.
    await TaskService.upsertTasks(user.id, PlatformType.WINDOWS_TASK_SCHEDULER, [
      { externalId: '\\S\\Task2', name: 'Task 2', status: 'ACTIVE' as const }
    ]);
    const healed = await prisma.task.findUnique({
      where: { platform_externalId: { platform: PlatformType.WINDOWS_TASK_SCHEDULER, externalId: '\\S\\Task2' } }
    });
    expect(healed?.status).toBe('ACTIVE');
  });

  it('reconcileMissingTasks preserves rows when a large platform returns a suspicious partial list', async () => {
    const { user } = await createUser('partial-stale@example.com');
    const tasks: NormalizedTask[] = Array.from({ length: 30 }, (_, i) => ({
      externalId: `\\Partial\\Task${i}`,
      name: `Task ${i}`,
      status: 'ACTIVE' as const
    }));
    await TaskService.upsertTasks(user.id, PlatformType.WINDOWS_TASK_SCHEDULER, tasks);

    const missing = await TaskService.reconcileMissingTasks(
      user.id,
      PlatformType.WINDOWS_TASK_SCHEDULER,
      ['\\Partial\\Task0']
    );

    expect(missing).toBe(0);
    expect(await prisma.task.count({ where: { userId: user.id } })).toBe(30);
    // Nothing was flipped — the whole dashboard stays ACTIVE.
    expect(await prisma.task.count({ where: { userId: user.id, status: 'MISSING' } })).toBe(0);
  });
});
