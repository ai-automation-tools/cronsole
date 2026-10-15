import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { PlatformType } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
import { createUser } from './helpers.js';

const app = createApp();

async function createTemplate(userId: string, data: { id?: string; managed?: boolean } = {}) {
  return prisma.template.create({
    data: {
      userId,
      name: 'Fixture Template',
      sourcePlatform: PlatformType.WINDOWS_TASK_SCHEDULER,
      targetPlatforms: [PlatformType.WINDOWS_TASK_SCHEDULER],
      scheduleExpression: '0 3 * * *',
      ...data
    }
  });
}

describe('DELETE /api/templates/:id', () => {
  let owner: Awaited<ReturnType<typeof createUser>>;

  beforeEach(async () => {
    owner = await createUser('tpl-delete@example.com');
  });

  it('deletes a user-authored template by its catalog id, with its favorites', async () => {
    const template = await createTemplate(owner.user.id, { id: 'recipe-test-delete' });
    await request(app).post(`/api/templates/${template.id}/favorite`).set('Authorization', owner.auth);

    const res = await request(app).delete('/api/templates/recipe-test-delete').set('Authorization', owner.auth);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'recipe-test-delete', deleted: true });

    expect(await prisma.template.findUnique({ where: { id: template.id } })).toBeNull();
    expect(await prisma.templateFavorite.count({ where: { templateId: template.id } })).toBe(0);
  });

  it('leaves tasks alone — a task never depends on its template', async () => {
    const template = await createTemplate(owner.user.id);
    const task = await prisma.task.create({
      data: {
        userId: owner.user.id,
        platform: PlatformType.TASKHUB_NATIVE,
        externalId: 'from-template',
        name: 'From Template',
        status: 'ACTIVE'
      }
    });

    const res = await request(app).delete(`/api/templates/${template.id}`).set('Authorization', owner.auth);
    expect(res.status).toBe(200);
    expect(await prisma.task.findUnique({ where: { id: task.id } })).not.toBeNull();
  });

  it('refuses a managed (catalog-synced) template with 409 and keeps it', async () => {
    const template = await createTemplate(owner.user.id, { managed: true });

    const res = await request(app).delete(`/api/templates/${template.id}`).set('Authorization', owner.auth);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('TEMPLATE_MANAGED');
    expect(res.body.error).toMatch(/next catalog sync/);
    expect(await prisma.template.findUnique({ where: { id: template.id } })).not.toBeNull();
  });

  it('404s for an unknown id', async () => {
    const res = await request(app).delete('/api/templates/no-such-template').set('Authorization', owner.auth);
    expect(res.status).toBe(404);
  });

  it('401s when unauthenticated', async () => {
    const template = await createTemplate(owner.user.id);
    const res = await request(app).delete(`/api/templates/${template.id}`);
    expect(res.status).toBe(401);
    expect(await prisma.template.findUnique({ where: { id: template.id } })).not.toBeNull();
  });
});
