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

  it('exports a Cronsole-native task as JSON', async () => {
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
      cronsoleTaskVersion: '1.0',
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

  /**
   * `?format=template` — the portable half.
   *
   * The cases that matter are the ones where it behaves *differently* from the
   * native export, because those are the reasons it exists: it reaches no
   * platform, so it works with the agent offline and on a platform whose native
   * definition Cronsole cannot fetch at all.
   */
  describe('?format=template', () => {
    it('exports a Registry v1 template, and writes nothing to the catalog', async () => {
      const before = await prisma.template.count();
      const task = await createTask(
        owner.user.id,
        PlatformType.TASKHUB_NATIVE,
        { job: { jobType: 'HTTP', url: 'https://example.com/health', method: 'GET' } },
        '*/5 * * * *',
        'Health Check'
      );

      const res = await request(app)
        .get(`/api/tasks/${task.id}/export?format=template`)
        .set('Authorization', owner.auth);

      expect(res.status).toBe(200);
      expect(res.headers['content-disposition']).toContain('cronsole-template-Health_Check.json');
      expect(res.body).toMatchObject({
        schemaVersion: '1.0',
        name: 'Health Check',
        // The schedule rides on the target-agnostic trigger, not a platform field.
        trigger: { kind: 'schedule', cron: '*/5 * * * *' },
        commandTemplate: 'https://example.com/health'
      });
      // The whole reason this is not "save as template, then export it".
      expect(await prisma.template.count()).toBe(before);
    });

    it('works for a Windows task with the agent offline', async () => {
      // The native export 502s here (asserted above). This one is built from the
      // DB row and never asks the agent anything, which is most of its value.
      const task = await createTask(
        owner.user.id,
        PlatformType.WINDOWS_TASK_SCHEDULER,
        { command: 'cmd.exe /c echo hi' }
      );
      const res = await request(app)
        .get(`/api/tasks/${task.id}/export?format=template`)
        .set('Authorization', owner.auth);

      expect(res.status).toBe(200);
      expect(res.body.compatibleTargets).toContain('windows');
    });

    it('works for a platform whose native export is refused outright', async () => {
      // CLAUDE_CODE 400s on the native path — the routine lives at claude.ai.
      // The template still describes what it runs, so the button need not vanish.
      const task = await createTask(owner.user.id, PlatformType.CLAUDE_CODE, { command: 'Review yesterday\'s PRs' });
      const res = await request(app)
        .get(`/api/tasks/${task.id}/export?format=template`)
        .set('Authorization', owner.auth);

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Export Fixture');
    });

    it('refuses a task with no cron-expressible schedule, by name', async () => {
      // A boot/logon trigger is not expressible as a 5-field cron, so there is
      // no honest template for it — and the refusal says which fact stopped it.
      const task = await createTask(
        owner.user.id,
        PlatformType.WINDOWS_TASK_SCHEDULER,
        { command: 'cmd.exe /c echo hi' },
        null
      );
      const res = await request(app)
        .get(`/api/tasks/${task.id}/export?format=template`)
        .set('Authorization', owner.auth);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/schedule/i);
    });

    it('refuses an unknown format and names the two that exist', async () => {
      const task = await createTask(owner.user.id, PlatformType.TASKHUB_NATIVE, { job: { url: 'https://x' } });
      const res = await request(app)
        .get(`/api/tasks/${task.id}/export?format=yaml`)
        .set('Authorization', owner.auth);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/native/);
      expect(res.body.error).toMatch(/template/);
    });

    it('produces a file POST /api/templates/import accepts verbatim', async () => {
      // The claim the whole format rests on: "portable" means another install
      // can read it. Asserting the shape alone would prove nothing — the
      // importer is the only judge of whether this is a valid template, and it
      // applies the same {{placeholder}} resolvability check as any catalog
      // content. Without this, export and import could drift into two dialects
      // of Registry v1 and every test would stay green.
      const task = await createTask(
        owner.user.id,
        PlatformType.TASKHUB_NATIVE,
        { job: { jobType: 'HTTP', url: 'https://example.com/health', method: 'GET' } },
        '0 6 * * 1',
        'Round Trip'
      );

      const exported = await request(app)
        .get(`/api/tasks/${task.id}/export?format=template`)
        .set('Authorization', owner.auth);
      expect(exported.status).toBe(200);

      const imported = await request(app)
        .post('/api/templates/import')
        .set('Authorization', owner.auth)
        .send(exported.body);

      expect(imported.status).toBe(200);
      expect(imported.body.created).toHaveLength(1);
      expect(imported.body.errors ?? []).toHaveLength(0);

      const row = await prisma.template.findUnique({ where: { id: imported.body.created[0] } });
      expect(row?.name).toBe('Round Trip');
      // Imported rows are never pruned by catalogSync — they are the user's.
      expect(row?.managed).toBe(false);
    });

    it('treats an absent format as native, so existing callers are untouched', async () => {
      const task = await createTask(owner.user.id, PlatformType.TASKHUB_NATIVE, { job: { url: 'https://x' } });
      const res = await request(app)
        .get(`/api/tasks/${task.id}/export`)
        .set('Authorization', owner.auth);

      expect(res.status).toBe(200);
      expect(res.body.cronsoleTaskVersion).toBe('1.0');
    });
  });
});
