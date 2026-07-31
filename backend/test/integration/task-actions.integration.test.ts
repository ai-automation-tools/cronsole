import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { PlatformType, TaskStatus } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
import { createUser, createNativeTask } from './helpers.js';

const app = createApp();

/** A tracked Windows task fixture (no agent connected in the integration env). */
async function createWindowsTask(userId: string, name = 'Integration-Actions') {
  return prisma.task.create({
    data: {
      userId,
      platform: PlatformType.WINDOWS_TASK_SCHEDULER,
      externalId: `\\TaskHub\\${name}`,
      name,
      category: 'Cronsole',
      schedule: '0 3 * * *',
      status: TaskStatus.ACTIVE,
      metadata: {
        schedule: '0 3 * * *',
        command: 'echo hi',
        state: 'Ready',
        actions: [{ type: 'Exec', path: 'cmd.exe', arguments: '/c echo hi' }]
      }
    }
  });
}

describe('PATCH /tasks/:id/actions', () => {
  let owner: Awaited<ReturnType<typeof createUser>>;

  beforeEach(async () => {
    owner = await createUser('actions@example.com');
  });

  it('502s on a Windows task when the agent is offline — and the action metadata survives', async () => {
    const task = await createWindowsTask(owner.user.id);

    const res = await request(app)
      .patch(`/api/tasks/${task.id}/actions`)
      .set('Authorization', owner.auth)
      .send({ command: 'powershell.exe -File C:\\new.ps1', runLevel: 'highest' });

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/offline/i);
    // The agent never confirmed, so the stored command/action is unchanged.
    const dbTask = await prisma.task.findUnique({ where: { id: task.id } });
    const meta = dbTask?.metadata as Record<string, unknown>;
    expect(meta.command).toBe('echo hi');
  });

  it('400s on a blank command (Zod)', async () => {
    const task = await createWindowsTask(owner.user.id, 'Blank-Command');

    const res = await request(app)
      .patch(`/api/tasks/${task.id}/actions`)
      .set('Authorization', owner.auth)
      .send({ command: '   ', runLevel: 'least' });

    expect(res.status).toBe(400);
  });

  it("400s on an invalid runLevel (Zod enum)", async () => {
    const task = await createWindowsTask(owner.user.id, 'Bad-RunLevel');

    const res = await request(app)
      .patch(`/api/tasks/${task.id}/actions`)
      .set('Authorization', owner.auth)
      .send({ command: 'cmd.exe /c echo hi', runLevel: 'root' });

    expect(res.status).toBe(400);
  });

  it('400s on a native task (action editing not supported yet)', async () => {
    const task = await createNativeTask(owner.user.id, { name: 'Native No Action Edit' });

    const res = await request(app)
      .patch(`/api/tasks/${task.id}/actions`)
      .set('Authorization', owner.auth)
      .send({ command: 'cmd.exe /c echo hi', runLevel: 'least' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not supported/i);
  });

  it('404s when the task does not exist', async () => {
    const res = await request(app)
      .patch('/api/tasks/non-existent-id/actions')
      .set('Authorization', owner.auth)
      .send({ command: 'cmd.exe /c echo hi', runLevel: 'least' });

    expect(res.status).toBe(404);
  });

  it('404s/IDOR guard when user B edits user A action', async () => {
    const task = await createWindowsTask(owner.user.id, 'User A Action');
    const userB = await createUser('actions-b@example.com');

    const res = await request(app)
      .patch(`/api/tasks/${task.id}/actions`)
      .set('Authorization', userB.auth)
      .send({ command: 'calc.exe', runLevel: 'highest' });

    expect(res.status).toBe(404);
    const dbTask = await prisma.task.findUnique({ where: { id: task.id } });
    const meta = dbTask?.metadata as Record<string, unknown>;
    expect(meta.command).toBe('echo hi');
  });
});
