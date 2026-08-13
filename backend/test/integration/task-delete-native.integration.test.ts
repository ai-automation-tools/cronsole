import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import request from 'supertest';
import { PlatformType, TaskStatus } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
import { createUser, createNativeTask } from './helpers.js';

// DELETE /tasks/:id/native — the narrow route the MCP server wraps.
//
// It differs from DELETE /tasks/:id in exactly two ways, and both are the
// point: it refuses every platform but TASKHUB_NATIVE, and it archives the
// definition before destroying it, refusing the delete if that archive cannot
// be written. Everything below pins one of those two.

const app = createApp();

describe('DELETE /tasks/:id/native', () => {
  let owner: Awaited<ReturnType<typeof createUser>>;

  beforeEach(async () => {
    owner = await createUser('native-deleter@example.com');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deletes a native task and its execution logs', async () => {
    const task = await createNativeTask(owner.user.id, { name: 'Doomed Native' });
    await prisma.executionLog.create({
      data: { taskId: task.id, status: 'SUCCESS', log: 'ran once' }
    });

    const res = await request(app)
      .delete(`/api/tasks/${task.id}/native`)
      .set('Authorization', owner.auth);

    expect(res.status).toBe(200);
    expect(res.body.archived).toBe(true);
    expect(res.body.archiveId).toBeTruthy();
    expect(await prisma.task.findUnique({ where: { id: task.id } })).toBeNull();
    expect(await prisma.executionLog.count({ where: { taskId: task.id } })).toBe(0);
  });

  it('REFUSES a Windows task with a 400, and leaves the row untouched', async () => {
    // The whole reason this route exists. A Windows delete would reach the real
    // Task Scheduler entry through the elevated agent, which is not something an
    // agent should be able to trigger by inferring intent.
    const task = await prisma.task.create({
      data: {
        userId: owner.user.id,
        platform: PlatformType.WINDOWS_TASK_SCHEDULER,
        externalId: '\\Cronsole\\Integration-Native-Refuse',
        name: 'Integration-Native-Refuse',
        category: 'Cronsole',
        status: TaskStatus.ACTIVE
      }
    });

    const res = await request(app)
      .delete(`/api/tasks/${task.id}/native`)
      .set('Authorization', owner.auth);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Cronsole-native tasks only/i);
    expect(res.body.error).toMatch(/WINDOWS_TASK_SCHEDULER/);
    // Not a 502: this is a boundary, not the agent being unreachable. A 502
    // would invite a retry that can never succeed.
    expect(await prisma.task.findUnique({ where: { id: task.id } })).not.toBeNull();
    // And nothing was archived — the delete never got that far.
    expect(await prisma.deletedTaskArchive.count({ where: { taskId: task.id } })).toBe(0);
  });

  it('refuses a CLAUDE_CODE task too — native means native', async () => {
    const task = await prisma.task.create({
      data: {
        userId: owner.user.id,
        platform: PlatformType.CLAUDE_CODE,
        externalId: 'trig_integration_1',
        name: 'Claude routine',
        category: 'Claude',
        status: TaskStatus.ACTIVE
      }
    });

    const res = await request(app)
      .delete(`/api/tasks/${task.id}/native`)
      .set('Authorization', owner.auth);

    expect(res.status).toBe(400);
    expect(await prisma.task.findUnique({ where: { id: task.id } })).not.toBeNull();
  });

  it('archives the definition and the last runs BEFORE deleting', async () => {
    const task = await createNativeTask(owner.user.id, { name: 'Archived Native' });
    await prisma.executionLog.create({
      data: { taskId: task.id, status: 'SUCCESS', log: 'first', durationMs: 120 }
    });
    await prisma.executionLog.create({
      data: { taskId: task.id, status: 'FAILURE', log: 'second', durationMs: 300 }
    });

    const res = await request(app)
      .delete(`/api/tasks/${task.id}/native`)
      .set('Authorization', owner.auth);

    expect(res.status).toBe(200);
    expect(res.body.executionsArchived).toBe(2);

    const archive = await prisma.deletedTaskArchive.findFirst({ where: { taskId: task.id } });
    expect(archive).not.toBeNull();
    expect(archive!.name).toBe('Archived Native');
    expect(archive!.platform).toBe(PlatformType.TASKHUB_NATIVE);
    expect(archive!.deletedVia).toBe('mcp');

    // The bundle is the same shape GET /tasks/:id/export returns, so a restore
    // path only ever has to understand one format.
    const bundle = archive!.bundle as Record<string, unknown>;
    expect(bundle.cronsoleTaskVersion).toBe('1.0');
    // The fixture's schedule, carried through verbatim — the archive stores what
    // the task actually had, not a default.
    expect((bundle.task as Record<string, unknown>).schedule).toBe('0 3 * * *');
    expect((bundle.task as Record<string, unknown>).job).toMatchObject({
      jobType: 'HTTP',
      url: 'https://example.com/health'
    });

    const executions = archive!.executions as unknown[];
    expect(executions).toHaveLength(2);
  });

  it('the archive OUTLIVES the task — no cascade takes the backup with it', async () => {
    // If DeletedTaskArchive were wired to Task with onDelete: Cascade, the row
    // would vanish in the same transaction that made it necessary, and every
    // other assertion here would still pass.
    const task = await createNativeTask(owner.user.id, { name: 'Outlives' });

    await request(app)
      .delete(`/api/tasks/${task.id}/native`)
      .set('Authorization', owner.auth)
      .expect(200);

    expect(await prisma.task.findUnique({ where: { id: task.id } })).toBeNull();
    expect(await prisma.deletedTaskArchive.count({ where: { taskId: task.id } })).toBe(1);
  });

  it('REFUSES the delete when the archive cannot be written', async () => {
    // A backup that silently no-ops is worse than none: the caller proceeds
    // believing the task is recoverable. The task must survive an archive
    // failure, or the precondition is decorative.
    const task = await createNativeTask(owner.user.id, { name: 'Unarchivable' });

    vi.spyOn(prisma.deletedTaskArchive, 'create').mockRejectedValueOnce(
      new Error('archive table is on fire')
    );

    const res = await request(app)
      .delete(`/api/tasks/${task.id}/native`)
      .set('Authorization', owner.auth);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/delete was refused/i);
    expect(res.body.error).toMatch(/unchanged/i);
    // Still there, still scheduled.
    expect(await prisma.task.findUnique({ where: { id: task.id } })).not.toBeNull();
  });

  it('404s on another user\'s native task without archiving it', async () => {
    const stranger = await createUser('stranger-native@example.com');
    const task = await createNativeTask(stranger.user.id, { name: 'Not Yours' });

    const res = await request(app)
      .delete(`/api/tasks/${task.id}/native`)
      .set('Authorization', owner.auth);

    expect(res.status).toBe(404);
    expect(await prisma.task.findUnique({ where: { id: task.id } })).not.toBeNull();
    expect(await prisma.deletedTaskArchive.count({ where: { taskId: task.id } })).toBe(0);
  });

  it('exposes the archive through /api/tools/task-archives, scoped to its owner', async () => {
    // A write-only backup is most of the way back to no backup.
    const task = await createNativeTask(owner.user.id, { name: 'Readable Again' });
    await request(app)
      .delete(`/api/tasks/${task.id}/native`)
      .set('Authorization', owner.auth)
      .expect(200);

    const list = await request(app)
      .get('/api/tools/task-archives')
      .set('Authorization', owner.auth);
    expect(list.status).toBe(200);
    const entry = list.body.archives.find((a: { taskId: string }) => a.taskId === task.id);
    expect(entry).toBeTruthy();
    expect(entry.name).toBe('Readable Again');

    const detail = await request(app)
      .get(`/api/tools/task-archives/${entry.id}`)
      .set('Authorization', owner.auth);
    expect(detail.status).toBe(200);
    expect((detail.body.bundle as Record<string, unknown>).cronsoleTaskVersion).toBe('1.0');

    // An archive holds a full job spec, headers included — it is not public.
    const stranger = await createUser('archive-stranger@example.com');
    const denied = await request(app)
      .get(`/api/tools/task-archives/${entry.id}`)
      .set('Authorization', stranger.auth);
    expect(denied.status).toBe(404);
  });
});
