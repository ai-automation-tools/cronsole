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
  name = 'Export Fixture'
) {
  return prisma.task.create({
    data: {
      userId,
      platform,
      externalId: `ext_${platform}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      category: 'Backup',
      schedule,
      status: TaskStatus.ACTIVE,
      metadata
    }
  });
}

describe('export existing tasks', () => {
  let owner: Awaited<ReturnType<typeof createUser>>;

  beforeEach(async () => {
    owner = await createUser('exp-owner@example.com');
  });

  it('exports a TaskHub-native task as JSON', async () => {
    const task = await createTask(
      owner.user.id,
      PlatformType.TASKHUB_NATIVE,
      { job: { jobType: 'HTTP', url: 'https://example.com/health', method: 'GET' } },
      '*/5 * * * *',
      'Health Check'
    );
    const res = await request(app)
      .get(`/api/tasks/${task.id}/export`)
      .set('Authorization', owner.auth);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers['content-disposition']).toContain('Health_Check.json');
    expect(res.body).toMatchObject({
      taskhubTaskVersion: '1.0',
      task: {
        name: 'Health Check',
        platform: 'TASKHUB_NATIVE',
        schedule: '*/5 * * * *',
        job: { jobType: 'HTTP', url: 'https://example.com/health', method: 'GET' }
      }
    });
    expect(typeof res.body.exportedAt).toBe('string');
  });

  it('502s a Windows export when the agent is offline', async () => {
    const task = await createTask(
      owner.user.id,
      PlatformType.WINDOWS_TASK_SCHEDULER,
      { command: 'cmd.exe /c echo hi' }
    );
    const res = await request(app)
      .get(`/api/tasks/${task.id}/export`)
      .set('Authorization', owner.auth);
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/agent/i);
  });

  it('400s an unsupported platform', async () => {
    const task = await createTask(owner.user.id, PlatformType.CLAUDE_CODE, { command: 'x' });
    const res = await request(app)
      .get(`/api/tasks/${task.id}/export`)
      .set('Authorization', owner.auth);
    expect(res.status).toBe(400);
  });

  it("404s another user's task (IDOR)", async () => {
    const task = await createTask(owner.user.id, PlatformType.TASKHUB_NATIVE, { job: { url: 'https://x' } });
    const other = await createUser('exp-other@example.com');
    const res = await request(app)
      .get(`/api/tasks/${task.id}/export`)
      .set('Authorization', other.auth);
    expect(res.status).toBe(404);
  });

  it('401s when unauthenticated', async () => {
    const task = await createTask(owner.user.id, PlatformType.TASKHUB_NATIVE, { job: { url: 'https://x' } });
    const res = await request(app).get(`/api/tasks/${task.id}/export`);
    expect(res.status).toBe(401);
  });
});
