import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { PlatformType, TaskStatus } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
import { createUser, createNativeTask } from './helpers.js';
import { archiveTaskBeforeDelete } from '../../src/services/taskArchive.js';

const app = createApp();

/**
 * Per-job secrets — ADR 0003 — against real Postgres.
 *
 * The claims worth pinning here are all storage claims, and none of them can be
 * checked against a mock:
 *
 * - **Nothing readable comes back.** Not "the handler filters it" — the value is
 *   in a relation, so it has to be absent from a plain task read, from an
 *   export, and from the archive that outlives the delete.
 * - **A job edit does not destroy secrets**, which is the entire reason they are
 *   not stored inside `metadata.job`.
 * - **Deleting the task destroys them**, by cascade, which is the opposite of
 *   `TaskExclusion` and deliberate.
 */

const SECRET = 'tok_live_9f3a2b';

describe('task secrets', () => {
  let owner: Awaited<ReturnType<typeof createUser>>;

  beforeEach(async () => {
    owner = await createUser('secrets@example.com');
  });

  // -------------------------------------------------------------------------
  // Write-only
  // -------------------------------------------------------------------------

  it('stores a secret and never returns its value from any route', async () => {
    const task = await createNativeTask(owner.user.id, { name: 'Webhook' });

    await request(app)
      .put(`/api/tasks/${task.id}/secrets/API_TOKEN`)
      .set('Authorization', owner.auth)
      .send({ value: SECRET })
      .expect(200);

    const listed = await request(app)
      .get(`/api/tasks/${task.id}/secrets`)
      .set('Authorization', owner.auth)
      .expect(200);
    expect(listed.body.stored).toEqual(['API_TOKEN']);
    expect(JSON.stringify(listed.body)).not.toContain(SECRET);

    // The plain task read is the one that would leak if this were a column on
    // Task rather than a relation — Prisma returns every scalar by default.
    const tasks = await request(app)
      .get('/api/tasks')
      .set('Authorization', owner.auth)
      .expect(200);
    expect(JSON.stringify(tasks.body)).not.toContain(SECRET);

    // And the stored row genuinely holds ciphertext, not the value.
    const row = await prisma.taskSecret.findUnique({ where: { taskId: task.id } });
    expect(row?.data).toBeTruthy();
    expect(row!.data).not.toContain(SECRET);
  });

  it('keeps the export free of secret values while the job still names them', async () => {
    const task = await createNativeTask(owner.user.id, { name: 'Exportable' });
    await request(app)
      .patch(`/api/tasks/${task.id}/job`)
      .set('Authorization', owner.auth)
      .send({ job: { jobType: 'HTTP', url: 'https://x.example.com', headers: { A: 'Bearer ${secret.T}' } } })
      .expect(200);
    await request(app)
      .put(`/api/tasks/${task.id}/secrets/T`)
      .set('Authorization', owner.auth)
      .send({ value: SECRET })
      .expect(200);

    const exported = await request(app)
      .get(`/api/tasks/${task.id}/export`)
      .set('Authorization', owner.auth)
      .expect(200);

    const body = JSON.stringify(exported.body);
    expect(body).not.toContain(SECRET);
    // The file states what it needs, in plain text, which is what makes a
    // separate `requiredSecrets` field unnecessary — and unread.
    expect(body).toContain('${secret.T}');
  });

  it('refuses to save a secret-bearing job as a template, by name', async () => {
    const task = await createNativeTask(owner.user.id, { name: 'Not Portable' });
    await request(app)
      .patch(`/api/tasks/${task.id}/job`)
      .set('Authorization', owner.auth)
      .send({ job: { jobType: 'HTTP', url: 'https://x.example.com/${secret.HOOK}' } })
      .expect(200);

    const res = await request(app)
      .get(`/api/tasks/${task.id}/export?format=template`)
      .set('Authorization', owner.auth)
      .expect(400);
    expect(res.body.error).toContain('HOOK');
  });

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  it('survives a job edit — the whole reason they are not stored inside the job', async () => {
    const task = await createNativeTask(owner.user.id, { name: 'Edited' });
    await request(app)
      .put(`/api/tasks/${task.id}/secrets/KEEP_ME`)
      .set('Authorization', owner.auth)
      .send({ value: SECRET })
      .expect(200);

    // `PATCH /job` REPLACES the job. A secret living inside it would die here.
    await request(app)
      .patch(`/api/tasks/${task.id}/job`)
      .set('Authorization', owner.auth)
      .send({ job: { jobType: 'EXEC', command: 'node -v' } })
      .expect(200);

    const listed = await request(app)
      .get(`/api/tasks/${task.id}/secrets`)
      .set('Authorization', owner.auth)
      .expect(200);
    expect(listed.body.stored).toEqual(['KEEP_ME']);
  });

  it('sets one secret without disturbing the others', async () => {
    const task = await createNativeTask(owner.user.id, { name: 'Two' });
    for (const [name, value] of [['ONE', 'value-one'], ['TWO', 'value-two']]) {
      await request(app)
        .put(`/api/tasks/${task.id}/secrets/${name}`)
        .set('Authorization', owner.auth)
        .send({ value })
        .expect(200);
    }

    const res = await request(app)
      .put(`/api/tasks/${task.id}/secrets/ONE`)
      .set('Authorization', owner.auth)
      .send({ value: 'value-one-rotated' })
      .expect(200);
    expect(res.body.stored).toEqual(['ONE', 'TWO']);
  });

  it('removes one secret, and 404s for one that was never there', async () => {
    const task = await createNativeTask(owner.user.id, { name: 'Removable' });
    await request(app)
      .put(`/api/tasks/${task.id}/secrets/GONE`)
      .set('Authorization', owner.auth)
      .send({ value: SECRET })
      .expect(200);

    const res = await request(app)
      .delete(`/api/tasks/${task.id}/secrets/GONE`)
      .set('Authorization', owner.auth)
      .expect(200);
    expect(res.body.stored).toEqual([]);
    expect(await prisma.taskSecret.findUnique({ where: { taskId: task.id } })).toBeNull();

    await request(app)
      .delete(`/api/tasks/${task.id}/secrets/GONE`)
      .set('Authorization', owner.auth)
      .expect(404);
  });

  it('destroys the secrets with the task, and the archive never held one', async () => {
    const task = await createNativeTask(owner.user.id, { name: 'Doomed' });
    await request(app)
      .put(`/api/tasks/${task.id}/secrets/DOOMED`)
      .set('Authorization', owner.auth)
      .send({ value: SECRET })
      .expect(200);

    // The archive is written *because* it outlives the row, which makes it the
    // last place a credential should survive a delete.
    const { archiveId } = await archiveTaskBeforeDelete(task, { deletedVia: 'test' });
    const archive = await prisma.deletedTaskArchive.findUnique({ where: { id: archiveId } });
    expect(JSON.stringify(archive!.bundle)).not.toContain(SECRET);

    await prisma.task.delete({ where: { id: task.id } });
    expect(await prisma.taskSecret.findUnique({ where: { taskId: task.id } })).toBeNull();
    // The archive itself has no relation to Task and must outlive it.
    expect(await prisma.deletedTaskArchive.findUnique({ where: { id: archiveId } })).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // Reporting
  // -------------------------------------------------------------------------

  it('reports referenced, stored and missing as three separate facts', async () => {
    const task = await createNativeTask(owner.user.id, { name: 'Partly Set' });
    await request(app)
      .patch(`/api/tasks/${task.id}/job`)
      .set('Authorization', owner.auth)
      .send({
        job: {
          jobType: 'HTTP',
          url: 'https://x.example.com',
          headers: { A: '${secret.HAVE}', B: '${secret.LACK}' }
        }
      })
      .expect(200);
    await request(app)
      .put(`/api/tasks/${task.id}/secrets/HAVE`)
      .set('Authorization', owner.auth)
      .send({ value: SECRET })
      .expect(200);
    await request(app)
      .put(`/api/tasks/${task.id}/secrets/UNUSED`)
      .set('Authorization', owner.auth)
      .send({ value: 'value-unused' })
      .expect(200);

    const res = await request(app)
      .get(`/api/tasks/${task.id}/secrets`)
      .set('Authorization', owner.auth)
      .expect(200);

    expect(res.body.referenced).toEqual(['HAVE', 'LACK']);
    expect(res.body.stored).toEqual(['HAVE', 'UNUSED']);
    // Merging these three into one list would have to pick which of two
    // different disagreements to be wrong about.
    expect(res.body.missing).toEqual(['LACK']);
    expect(res.body.unreadable).toBe(false);
  });

  it('reports missingSecrets on create, always present and empty when there is none', async () => {
    const withRef = await request(app)
      .post('/api/tasks/native')
      .set('Authorization', owner.auth)
      .send({
        name: 'Needs one',
        schedule: '0 3 * * *',
        job: { jobType: 'HTTP', url: 'https://x.example.com/${secret.HOOK}' }
      })
      .expect(200);
    expect(withRef.body.missingSecrets).toEqual(['HOOK']);

    const plain = await request(app)
      .post('/api/tasks/native')
      .set('Authorization', owner.auth)
      .send({ name: 'Needs none', schedule: '0 3 * * *', job: { jobType: 'HTTP', url: 'https://x.example.com' } })
      .expect(200);
    expect(plain.body.missingSecrets).toEqual([]);
  });

  it('creates a task and its secret in one gesture', async () => {
    const res = await request(app)
      .post('/api/tasks/native')
      .set('Authorization', owner.auth)
      .send({
        name: 'Atomic',
        schedule: '0 3 * * *',
        job: { jobType: 'HTTP', url: 'https://x.example.com/${secret.HOOK}' },
        secrets: { HOOK: 'w3bh00k-path' }
      })
      .expect(200);

    expect(res.body.missingSecrets).toEqual([]);
    expect(JSON.stringify(res.body)).not.toContain('w3bh00k-path');
    const listed = await request(app)
      .get(`/api/tasks/${res.body.task.id}/secrets`)
      .set('Authorization', owner.auth)
      .expect(200);
    expect(listed.body.stored).toEqual(['HOOK']);
  });

  it('leaves no task behind when a create\'s secret is refused', async () => {
    const before = await prisma.task.count({ where: { userId: owner.user.id } });
    const res = await request(app)
      .post('/api/tasks/native')
      .set('Authorization', owner.auth)
      .send({
        name: 'Half a task',
        schedule: '0 3 * * *',
        job: { jobType: 'HTTP', url: 'https://x.example.com/${secret.HOOK}' },
        // Too short to redact out of captured output, so it is refused by name.
        secrets: { HOOK: 'ab' }
      })
      .expect(400);

    expect(res.body.error).toMatch(/at least/);
    expect(await prisma.task.count({ where: { userId: owner.user.id } })).toBe(before);
  });

  // -------------------------------------------------------------------------
  // Refusals
  // -------------------------------------------------------------------------

  it('refuses a job whose reference sits in a field that cannot hold one', async () => {
    const task = await createNativeTask(owner.user.id, { name: 'Illegal ref' });
    const res = await request(app)
      .patch(`/api/tasks/${task.id}/job`)
      .set('Authorization', owner.auth)
      .send({ job: { jobType: 'SCRIPT', interpreter: '${secret.I}', body: 'x' } })
      .expect(400);
    expect(res.body.error).toMatch(/allowlist/);
  });

  it('refuses secrets on a platform whose definition Cronsole does not own', async () => {
    const windows = await prisma.task.create({
      data: {
        userId: owner.user.id,
        platform: PlatformType.WINDOWS_TASK_SCHEDULER,
        externalId: '\\Cronsole\\Nightly',
        name: 'Nightly',
        category: 'Cronsole',
        schedule: '0 3 * * *',
        status: TaskStatus.ACTIVE
      }
    });

    const res = await request(app)
      .put(`/api/tasks/${windows.id}/secrets/T`)
      .set('Authorization', owner.auth)
      .send({ value: SECRET })
      .expect(400);
    expect(res.body.error).toMatch(/Cronsole-native/);
  });

  it('scopes every secret route by owner (IDOR)', async () => {
    const stranger = await createUser('stranger-secrets@example.com');
    const task = await createNativeTask(owner.user.id, { name: 'Mine' });
    await request(app)
      .put(`/api/tasks/${task.id}/secrets/MINE`)
      .set('Authorization', owner.auth)
      .send({ value: SECRET })
      .expect(200);

    await request(app).get(`/api/tasks/${task.id}/secrets`).set('Authorization', stranger.auth).expect(404);
    await request(app)
      .put(`/api/tasks/${task.id}/secrets/MINE`)
      .set('Authorization', stranger.auth)
      .send({ value: 'value-theirs' })
      .expect(404);
    await request(app)
      .delete(`/api/tasks/${task.id}/secrets/MINE`)
      .set('Authorization', stranger.auth)
      .expect(404);
  });

  it('reports an undecryptable store as unreadable rather than as no secrets', async () => {
    const task = await createNativeTask(owner.user.id, { name: 'Key rotated' });
    // Exactly what a changed ENCRYPTION_KEY leaves behind: a row that exists and
    // cannot be opened. Reporting zero names would tell the user to set values
    // that are already there — absence of evidence is `unknown`, never `ok`.
    await prisma.taskSecret.create({
      data: { taskId: task.id, data: 'deadbeef:deadbeef:deadbeef' }
    });

    const res = await request(app)
      .get(`/api/tasks/${task.id}/secrets`)
      .set('Authorization', owner.auth)
      .expect(200);
    expect(res.body.unreadable).toBe(true);
    expect(res.body.stored).toEqual([]);
  });
});
