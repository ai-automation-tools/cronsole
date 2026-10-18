import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { PlatformType } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
import { createUser, createNativeConnection } from './helpers.js';
import { normalizeTemplate } from '../../src/catalog/normalize.js';

const app = createApp();

/**
 * Applying a Registry v1 `script` template to Cronsole-native — the shape the
 * ai-automation-recipes repo publishes: a long-running agent script that needs
 * a timeout above the 5-minute default and one or more API keys.
 */
describe('POST /templates/:id/apply — native script templates', () => {
  let owner: Awaited<ReturnType<typeof createUser>>;

  beforeEach(async () => {
    owner = await createUser('apply-native@example.com');
    await createNativeConnection(owner.user.id);
  });

  async function seed(over: { timeoutSec?: number | null; body?: string; parameters?: unknown[] } = {}) {
    const norm = normalizeTemplate({
      schemaVersion: '1.0',
      id: `recipe-${Math.random().toString(36).slice(2, 8)}`,
      name: 'Agent digest',
      trigger: { kind: 'schedule', cron: '0 6 * * *' },
      action: {
        kind: 'script',
        interpreter: 'python',
        body: over.body ?? 'import os\nprint(os.environ.get("X"))'
      },
      execution: { timeoutSec: over.timeoutSec },
      parameters: over.parameters as never,
      compatibleTargets: ['cronsole-native']
    });
    const { id: _id, ...data } = norm;
    return prisma.template.create({
      data: { ...data, userId: owner.user.id, parameters: (over.parameters ?? []) as never }
    });
  }

  const apply = (id: string, body: Record<string, unknown> = {}) =>
    request(app)
      .post(`/api/templates/${id}/apply`)
      .set('Authorization', owner.auth)
      .send({ platform: 'TASKHUB_NATIVE', ...body });

  it('maps execution.timeoutSec onto the task job, and returns the task id', async () => {
    const template = await seed({ timeoutSec: 2400 });
    const res = await apply(template.id).expect(200);

    expect(res.body.taskId).toEqual(expect.any(String));
    const task = await prisma.task.findUnique({ where: { id: res.body.taskId } });
    expect(task?.platform).toBe(PlatformType.TASKHUB_NATIVE);
    expect((task!.metadata as { job: { timeoutMs?: number } }).job.timeoutMs).toBe(2_400_000);
  });

  it('keeps the executor default when the template declares no timeout', async () => {
    const template = await seed({ timeoutSec: null });
    const res = await apply(template.id).expect(200);
    const task = await prisma.task.findUnique({ where: { id: res.body.taskId } });
    expect((task!.metadata as { job: Record<string, unknown> }).job).not.toHaveProperty('timeoutMs');
  });

  it('reports required secret references as missingSecrets, never optional ones', async () => {
    const template = await seed({
      body: 'k = "${secret.OPENAI_API_KEY}"\nimg = "${secret.IMAGE_KEY?}"'
    });
    const res = await apply(template.id).expect(200);
    expect(res.body.missingSecrets).toEqual(['OPENAI_API_KEY']);

    const listed = await request(app)
      .get(`/api/tasks/${res.body.taskId}/secrets`)
      .set('Authorization', owner.auth)
      .expect(200);
    expect(listed.body.referenced).toEqual(['OPENAI_API_KEY', 'IMAGE_KEY']);
    expect(listed.body.optional).toEqual(['IMAGE_KEY']);
    expect(listed.body.missing).toEqual(['OPENAI_API_KEY']);
  });

  it('fills {{placeholders}} from defaults when parameters is omitted', async () => {
    const template = await seed({
      body: 'print("{{topic}}")',
      parameters: [{ key: 'topic', label: 'Topic', default: 'AI news' }]
    });
    const res = await apply(template.id).expect(200);
    const task = await prisma.task.findUnique({ where: { id: res.body.taskId } });
    expect((task!.metadata as { job: { body: string } }).job.body).toBe('print("AI news")');
  });

  it('refuses rather than storing a raw placeholder a required parameter must fill', async () => {
    const template = await seed({
      body: 'print("{{topic}}")',
      parameters: [{ key: 'topic', label: 'Topic', required: true }]
    });
    const res = await apply(template.id);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/topic/);
    expect(await prisma.task.count({ where: { userId: owner.user.id } })).toBe(0);
  });
});
