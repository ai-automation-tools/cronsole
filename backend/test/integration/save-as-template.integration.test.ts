import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { PlatformType, TaskStatus, Prisma } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
import { createUser } from './helpers.js';

const app = createApp();

async function createTask(
  userId: string,
  platform: PlatformType,
  metadata: Prisma.InputJsonValue,
  schedule: string | null = '0 9 * * *',
  externalId = `ext_${Math.abs(platform.length * 7 + userId.length)}_${platform}`
) {
  return prisma.task.create({
    data: {
      userId,
      platform,
      externalId: `${externalId}_${Math.random().toString(36).slice(2, 8)}`,
      name: 'Source Task',
      category: 'Backup',
      schedule,
      status: TaskStatus.ACTIVE,
      metadata
    }
  });
}

describe('save task as template', () => {
  let owner: Awaited<ReturnType<typeof createUser>>;

  beforeEach(async () => {
    owner = await createUser('sat-owner@example.com');
  });

  it('saves a Windows task as a template that appears in the catalog', async () => {
    const task = await createTask(owner.user.id, PlatformType.WINDOWS_TASK_SCHEDULER, {
      actions: [{ path: 'powershell.exe', arguments: '-File backup.ps1', workingDirectory: 'C:\\jobs' }]
    });

    const res = await request(app)
      .post(`/api/tasks/${task.id}/save-as-template`)
      .set('Authorization', owner.auth)
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.template.id).toMatch(/^tpl_saved_/);
    expect(res.body.template.commandTemplate).toBe('powershell.exe -File backup.ps1');

    // It's now in the shared catalog.
    const list = await request(app).get('/api/templates').set('Authorization', owner.auth);
    expect(list.body.some((t: { id: string }) => t.id === res.body.template.id)).toBe(true);
  });

  it('saves a native HTTP task as a cronsole-native template', async () => {
    const task = await createTask(
      owner.user.id,
      PlatformType.TASKHUB_NATIVE,
      { job: { jobType: 'HTTP', url: 'https://example.com/health', method: 'GET' } },
      '*/5 * * * *'
    );
    const res = await request(app)
      .post(`/api/tasks/${task.id}/save-as-template`)
      .set('Authorization', owner.auth)
      .send({ name: 'Health Probe' });
    expect(res.status).toBe(201);
    expect(res.body.template.name).toBe('Health Probe');
    expect(res.body.template.commandTemplate).toBe('https://example.com/health');
  });

  it('400s a task with no cron-expressible schedule', async () => {
    const task = await createTask(
      owner.user.id,
      PlatformType.WINDOWS_TASK_SCHEDULER,
      { command: 'cmd.exe /c echo hi' },
      null
    );
    const res = await request(app)
      .post(`/api/tasks/${task.id}/save-as-template`)
      .set('Authorization', owner.auth)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/schedule/i);
  });

  it("404s another user's task (IDOR)", async () => {
    const task = await createTask(owner.user.id, PlatformType.WINDOWS_TASK_SCHEDULER, { command: 'x.exe' });
    const other = await createUser('sat-other@example.com');
    const res = await request(app)
      .post(`/api/tasks/${task.id}/save-as-template`)
      .set('Authorization', other.auth)
      .send({});
    expect(res.status).toBe(404);
  });

  it('401s when unauthenticated', async () => {
    const task = await createTask(owner.user.id, PlatformType.WINDOWS_TASK_SCHEDULER, { command: 'x.exe' });
    const res = await request(app).post(`/api/tasks/${task.id}/save-as-template`).send({});
    expect(res.status).toBe(401);
  });
});
