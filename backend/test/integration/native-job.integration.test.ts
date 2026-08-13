import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { PlatformType, TaskStatus } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
import { createUser, createNativeTask } from './helpers.js';

const app = createApp();

/**
 * `PATCH /api/tasks/:id/job` — change what a Cronsole-native task does.
 *
 * Against real Postgres because the point of this route is that **the write IS
 * the change**: there is no agent to confirm anything, so the only evidence it
 * worked is the stored row, and the only evidence it is *safe* is what the row
 * looks like afterwards. Both live in the database.
 *
 * The two things that can go quietly wrong here are a merge (leaving a field
 * from the previous job type behind, which the executor never reads and a reader
 * cannot explain) and a spec that this route accepts but creation would have
 * refused. Both are pinned below.
 */

const job = (task: { metadata: unknown }) =>
  ((task.metadata ?? {}) as { job?: Record<string, unknown> }).job ?? {};

describe('PATCH /tasks/:id/job', () => {
  let owner: Awaited<ReturnType<typeof createUser>>;

  beforeEach(async () => {
    owner = await createUser('native-job@example.com');
  });

  it('rewrites an HTTP job — the URL that could not be changed at all before', async () => {
    const task = await createNativeTask(owner.user.id, { name: 'Ping' });

    const res = await request(app)
      .patch(`/api/tasks/${task.id}/job`)
      .set('Authorization', owner.auth)
      .send({ job: { jobType: 'HTTP', url: 'https://example.com/v2/health', method: 'POST', body: '{"ok":1}' } })
      .expect(200);

    expect(job(res.body)).toMatchObject({
      jobType: 'HTTP',
      url: 'https://example.com/v2/health',
      method: 'POST',
      body: '{"ok":1}'
    });
  });

  it('replaces the job rather than merging, so no field of the old type survives', async () => {
    // The failure this prevents: `url` sitting inside an EXEC job forever,
    // unread by the executor and unexplainable to whoever finds it.
    const task = await createNativeTask(owner.user.id, { name: 'Was HTTP' });

    const res = await request(app)
      .patch(`/api/tasks/${task.id}/job`)
      .set('Authorization', owner.auth)
      .send({ job: { jobType: 'EXEC', command: 'node "D:\\jobs\\digest.js"' } })
      .expect(200);

    const stored = job(res.body);
    expect(stored).toMatchObject({ jobType: 'EXEC', executable: 'node', args: ['D:\\jobs\\digest.js'] });
    expect(stored).not.toHaveProperty('url');
    expect(stored).not.toHaveProperty('method');
  });

  it('tokenizes a command line server-side, with no shell', async () => {
    // Stored structured, never as a string — the P0 guarantee. The browser sends
    // a command line and one definition of "how that becomes argv" lives on the
    // server, shared with the create and Windows paths.
    const task = await createNativeTask(owner.user.id);

    const res = await request(app)
      .patch(`/api/tasks/${task.id}/job`)
      .set('Authorization', owner.auth)
      .send({ job: { jobType: 'EXEC', command: '"C:\\Program Files\\node.exe" --version' } })
      .expect(200);

    expect(job(res.body)).toMatchObject({
      executable: 'C:\\Program Files\\node.exe',
      args: ['--version']
    });
  });

  it('keeps everything that is not the job', async () => {
    // Name, schedule, category and history belong to the task, not to the job.
    // A route that rewrote `metadata` wholesale would be quietly destructive
    // well outside what its name claims.
    const task = await prisma.task.create({
      data: {
        userId: owner.user.id,
        platform: PlatformType.TASKHUB_NATIVE,
        externalId: 'native_keepme',
        name: 'Nightly digest',
        category: 'Reports',
        schedule: '0 3 * * *',
        status: TaskStatus.ACTIVE,
        metadata: { job: { jobType: 'HTTP', url: 'https://a.example' }, savedFrom: 'tmpl-42' }
      }
    });
    await prisma.executionLog.create({ data: { taskId: task.id, status: 'SUCCESS' } });

    const res = await request(app)
      .patch(`/api/tasks/${task.id}/job`)
      .set('Authorization', owner.auth)
      .send({ job: { jobType: 'HTTP', url: 'https://b.example' } })
      .expect(200);

    expect(res.body.name).toBe('Nightly digest');
    expect(res.body.category).toBe('Reports');
    expect(res.body.schedule).toBe('0 3 * * *');
    expect((res.body.metadata as Record<string, unknown>).savedFrom).toBe('tmpl-42');
    expect(await prisma.executionLog.count({ where: { taskId: task.id } })).toBe(1);
  });

  it('refuses a spec that creation would have refused', async () => {
    // The route shares `buildNativeJob` + `validateJob` with POST /tasks/native.
    // A second definition here is how an edit produces a job the executor cannot
    // run — accepted at edit time, failing at 3am.
    const task = await createNativeTask(owner.user.id);

    for (const bad of [
      { jobType: 'HTTP', url: 'not-a-url' },
      { jobType: 'EXEC', command: '   ' },
      { jobType: 'FTP', url: 'ftp://x' },
      { url: 'https://example.com' } // missing discriminator
    ]) {
      await request(app)
        .patch(`/api/tasks/${task.id}/job`)
        .set('Authorization', owner.auth)
        .send({ job: bad })
        .expect(400);
    }

    // Untouched by every one of them.
    const after = await prisma.task.findUnique({ where: { id: task.id } });
    expect(job(after!)).toMatchObject({ url: 'https://example.com/health' });
  });

  it('names the right route for a Windows task instead of a bare refusal', async () => {
    // A 400 that does not say where to go is a dead end. `/actions` is the
    // Windows path and this route cannot serve it — the agent has to confirm.
    const windows = await prisma.task.create({
      data: {
        userId: owner.user.id,
        platform: PlatformType.WINDOWS_TASK_SCHEDULER,
        externalId: '\\Edge-Radar\\Nightly',
        name: 'Nightly',
        category: 'Edge-Radar',
        schedule: '0 3 * * *',
        status: TaskStatus.ACTIVE,
        metadata: { command: 'echo hi' }
      }
    });

    const res = await request(app)
      .patch(`/api/tasks/${windows.id}/job`)
      .set('Authorization', owner.auth)
      .send({ job: { jobType: 'HTTP', url: 'https://example.com' } })
      .expect(400);

    expect(res.body.error).toMatch(/\/actions/);
  });

  it('records the capability, so the matrix stops calling native unable to do this', async () => {
    // Native has no `updateActions` connector method and never will — the row IS
    // the task — so without route-level reachability the Platforms matrix
    // reports the platform as unable to change what it runs.
    const task = await createNativeTask(owner.user.id);
    await request(app)
      .patch(`/api/tasks/${task.id}/job`)
      .set('Authorization', owner.auth)
      .send({ job: { jobType: 'HTTP', url: 'https://example.com/ok' } })
      .expect(200);

    const evidence = await prisma.platformCapability.findFirst({
      where: { userId: owner.user.id, platform: PlatformType.TASKHUB_NATIVE, verb: 'updateAction' }
    });
    expect(evidence?.lastSuccessAt).toBeTruthy();
  });

  it("cannot edit another user's task", async () => {
    const other = await createUser('other-native-job@example.com');
    const theirs = await createNativeTask(other.user.id, { name: 'Theirs' });

    await request(app)
      .patch(`/api/tasks/${theirs.id}/job`)
      .set('Authorization', owner.auth)
      .send({ job: { jobType: 'HTTP', url: 'https://evil.example' } })
      .expect(404);

    const after = await prisma.task.findUnique({ where: { id: theirs.id } });
    expect(job(after!)).toMatchObject({ url: 'https://example.com/health' });
  });
});
