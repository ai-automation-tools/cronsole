import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { PlatformType, TaskStatus } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
import { createUser } from './helpers.js';

// Windows task-name guard (Apply-modal upgrades, ROADMAP P2): create paths
// reject invalid names (400) and names colliding with a tracked \TaskHub\ task
// (409) BEFORE any connector call — RegisterTaskDefinition would otherwise
// silently overwrite the existing scheduler entry. Both POST /tasks and
// POST /templates/:id/apply share the guard. No agent runs in this harness, so
// reaching the connector would surface as a 500 "Agent offline" instead of the
// expected 4xx — which is exactly what proves the guard fires first.

const app = createApp();

async function createTrackedWindowsTask(userId: string, name: string) {
  return prisma.task.create({
    data: {
      userId,
      platform: PlatformType.WINDOWS_TASK_SCHEDULER,
      externalId: `\\TaskHub\\${name}`,
      name,
      category: 'TaskHub',
      status: TaskStatus.ACTIVE
    }
  });
}

describe('Windows task-name guard', () => {
  let owner: Awaited<ReturnType<typeof createUser>>;

  beforeEach(async () => {
    owner = await createUser('namer@example.com');
    // No platform connection needed: every case here must 4xx on the name
    // guard BEFORE the route ever looks up a connection or connector.
  });

  it('POST /tasks 409s on a name already tracked under \\TaskHub\\ (case-insensitive)', async () => {
    await createTrackedWindowsTask(owner.user.id, 'Nightly Backup');

    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', owner.auth)
      .send({
        name: 'nightly backup',
        platform: 'WINDOWS_TASK_SCHEDULER',
        schedule: '0 3 * * *',
        command: 'echo hi'
      });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/);
  });

  it('POST /tasks 400s on a name with Windows-invalid characters', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', owner.auth)
      .send({
        name: 'bad/name?',
        platform: 'WINDOWS_TASK_SCHEDULER',
        schedule: '0 3 * * *',
        command: 'echo hi'
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot contain/);
  });

  it('POST /templates/:id/apply 409s when the chosen name collides', async () => {
    await createTrackedWindowsTask(owner.user.id, 'PS Runner');
    const template = await prisma.template.create({
      data: {
        userId: owner.user.id,
        name: 'PowerShell Starter',
        sourcePlatform: PlatformType.WINDOWS_TASK_SCHEDULER,
        targetPlatforms: [PlatformType.WINDOWS_TASK_SCHEDULER],
        scheduleExpression: '0 3 * * *',
        commandTemplate: 'powershell.exe -File "{{scriptPath}}"',
        parameters: [
          { key: 'scriptPath', label: 'Script file path', type: 'path', required: true }
        ]
      }
    });

    const res = await request(app)
      .post(`/api/templates/${template.id}/apply`)
      .set('Authorization', owner.auth)
      .send({
        platform: 'WINDOWS_TASK_SCHEDULER',
        name: 'PS Runner',
        schedule: '0 3 * * *',
        parameters: { scriptPath: 'C:\\scripts\\run.ps1' }
      });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/);
  });

  it('POST /templates/:id/apply falls back to the template name and still collides', async () => {
    await createTrackedWindowsTask(owner.user.id, 'PowerShell Starter');
    const template = await prisma.template.create({
      data: {
        userId: owner.user.id,
        name: 'PowerShell Starter',
        sourcePlatform: PlatformType.WINDOWS_TASK_SCHEDULER,
        targetPlatforms: [PlatformType.WINDOWS_TASK_SCHEDULER],
        scheduleExpression: '0 3 * * *',
        command: 'echo hi'
      }
    });

    const res = await request(app)
      .post(`/api/templates/${template.id}/apply`)
      .set('Authorization', owner.auth)
      .send({ platform: 'WINDOWS_TASK_SCHEDULER', command: 'echo hi' });

    expect(res.status).toBe(409);
  });

  it('native apply keeps metadata.job intact (regression: the Windows-only apply upsert must not touch native rows)', async () => {
    // TaskHubNativeConnector.createTask writes its own row with metadata.job;
    // the apply route's immediate-upsert (Windows only) must not overwrite it,
    // or the native task becomes permanently non-runnable.
    const { createNativeConnection } = await import('./helpers.js');
    await createNativeConnection(owner.user.id);
    const template = await prisma.template.create({
      data: {
        userId: owner.user.id,
        name: 'Native Ping',
        sourcePlatform: PlatformType.TASKHUB_NATIVE,
        targetPlatforms: [PlatformType.TASKHUB_NATIVE],
        scheduleExpression: '0 3 * * *',
        command: 'https://example.com/ping'
      }
    });

    const res = await request(app)
      .post(`/api/templates/${template.id}/apply`)
      .set('Authorization', owner.auth)
      .send({ platform: 'TASKHUB_NATIVE', name: 'Native Ping Applied' });

    expect(res.status).toBe(200);
    const row = await prisma.task.findFirst({
      where: { userId: owner.user.id, platform: PlatformType.TASKHUB_NATIVE, name: 'Native Ping Applied' }
    });
    expect(row).not.toBeNull();
    const metadata = row!.metadata as { job?: { jobType?: string; url?: string } };
    expect(metadata.job?.jobType).toBe('HTTP');
    expect(metadata.job?.url).toBe('https://example.com/ping');
  });

  it('does not guard native tasks (random externalIds, duplicates allowed)', async () => {
    const res = await request(app)
      .post('/api/tasks/native')
      .set('Authorization', owner.auth)
      .send({
        name: 'Nightly Backup',
        schedule: '0 3 * * *',
        job: { jobType: 'HTTP', url: 'https://example.com/ping', method: 'GET' }
      });

    expect(res.status).toBe(200);
  });
});
