import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { PlatformType } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
import { createUser } from './helpers.js';

const app = createApp();

/** A shared-catalog template owned by `userId` (favorites are per-viewer, so the
 *  owner is irrelevant to who can favorite it). */
async function createTemplate(userId: string, name = 'Fixture Template') {
  return prisma.template.create({
    data: {
      userId,
      name,
      sourcePlatform: PlatformType.WINDOWS_TASK_SCHEDULER,
      targetPlatforms: [PlatformType.WINDOWS_TASK_SCHEDULER],
      scheduleExpression: '0 3 * * *'
    }
  });
}

/** Read one template's isFavorite flag from GET /api/templates as `auth`. */
async function isFavorite(auth: string, templateId: string): Promise<boolean | undefined> {
  const res = await request(app).get('/api/templates').set('Authorization', auth);
  expect(res.status).toBe(200);
  return res.body.find((t: { id: string; isFavorite?: boolean }) => t.id === templateId)?.isFavorite;
}

describe('template favorites', () => {
  let owner: Awaited<ReturnType<typeof createUser>>;

  beforeEach(async () => {
    owner = await createUser('fav-owner@example.com');
  });

  it('favorites a template and reflects it in the list (isFavorite=true)', async () => {
    const template = await createTemplate(owner.user.id);
    expect(await isFavorite(owner.auth, template.id)).toBe(false);

    const res = await request(app)
      .post(`/api/templates/${template.id}/favorite`)
      .set('Authorization', owner.auth);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: template.id, isFavorite: true });

    expect(await isFavorite(owner.auth, template.id)).toBe(true);
  });

  it('is idempotent — favoriting twice keeps a single row', async () => {
    const template = await createTemplate(owner.user.id);
    await request(app).post(`/api/templates/${template.id}/favorite`).set('Authorization', owner.auth);
    await request(app).post(`/api/templates/${template.id}/favorite`).set('Authorization', owner.auth);

    const rows = await prisma.templateFavorite.findMany({
      where: { userId: owner.user.id, templateId: template.id }
    });
    expect(rows).toHaveLength(1);
    expect(await isFavorite(owner.auth, template.id)).toBe(true);
  });

  it('unfavorites (idempotent — removing a non-favorite is a success)', async () => {
    const template = await createTemplate(owner.user.id);

    // Removing before it was ever favorited still succeeds.
    const pre = await request(app).delete(`/api/templates/${template.id}/favorite`).set('Authorization', owner.auth);
    expect(pre.status).toBe(200);
    expect(pre.body).toMatchObject({ id: template.id, isFavorite: false });

    await request(app).post(`/api/templates/${template.id}/favorite`).set('Authorization', owner.auth);
    expect(await isFavorite(owner.auth, template.id)).toBe(true);

    const res = await request(app).delete(`/api/templates/${template.id}/favorite`).set('Authorization', owner.auth);
    expect(res.status).toBe(200);
    expect(await isFavorite(owner.auth, template.id)).toBe(false);
  });

  it('does not leak favorites across users', async () => {
    const template = await createTemplate(owner.user.id);
    const userB = await createUser('fav-b@example.com');

    await request(app).post(`/api/templates/${template.id}/favorite`).set('Authorization', owner.auth);

    // Owner sees it favorited; user B does not.
    expect(await isFavorite(owner.auth, template.id)).toBe(true);
    expect(await isFavorite(userB.auth, template.id)).toBe(false);
  });

  it('404s when favoriting a non-existent template', async () => {
    const res = await request(app)
      .post('/api/templates/non-existent-id/favorite')
      .set('Authorization', owner.auth);
    expect(res.status).toBe(404);
  });

  it('401s when unauthenticated', async () => {
    const template = await createTemplate(owner.user.id);
    const res = await request(app).post(`/api/templates/${template.id}/favorite`);
    expect(res.status).toBe(401);
  });
});
