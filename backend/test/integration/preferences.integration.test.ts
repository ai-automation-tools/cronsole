import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
import { createUser } from './helpers.js';

const app = createApp();

/**
 * The account-level preferences blob.
 *
 * Against real Postgres because what is worth pinning here is mostly database
 * shape: **one row per user** (the primary key is the foreign key, so a second
 * row is unrepresentable rather than merely unwritten), the JSONB round trip,
 * and the cascade. A stubbed client would assert the mock for all three.
 *
 * The other half is tenancy. This row holds a description of one person's
 * sidebar and there is exactly one of them per user, so the failure to rule out
 * is a GET or a PUT that reaches somebody else's — the same shape as the
 * collections suite, with a smaller surface.
 */
describe('preferences', () => {
  let owner: Awaited<ReturnType<typeof createUser>>;

  beforeEach(async () => {
    owner = await createUser('prefs@example.com');
  });

  const get = () => request(app).get('/api/preferences').set('Authorization', owner.auth);
  const put = (body: unknown) =>
    request(app).put('/api/preferences').set('Authorization', owner.auth).send(body);

  /**
   * The distinction the client's whole anti-clobber rule rests on: a user who
   * has never stored preferences reads back `null`, NOT `{}`. Null means "seed
   * me from this browser"; `{}` means "the account's preferences are the
   * defaults", which must win over a local blob. Collapsing them would let a
   * second device re-seed the account from its own empty state.
   */
  it('reads back null — not an empty object — before anything is stored', async () => {
    const res = await get().expect(200);
    expect(res.body.data).toBeNull();
    expect(res.body.updatedAt).toBeNull();
  });

  it('stores a blob and hands it back verbatim', async () => {
    const data = {
      railPins: [{ id: 'pin-1', nodeKey: 'src:windows:AI-Maintenance', label: 'AI-Maintenance', patch: { source: 'windows', category: 'AI-Maintenance' } }],
      timezone: 'America/Los_Angeles',
      railCollapsed: true
    };

    const saved = await put({ data }).expect(200);
    expect(saved.body.data).toEqual(data);

    const read = await get().expect(200);
    expect(read.body.data).toEqual(data);
    expect(read.body.updatedAt).not.toBeNull();
  });

  /**
   * The server stores this shape; it does not know it. A key no backend release
   * has ever heard of must survive the round trip untouched, because the
   * alternative — stripping it — silently loses a preference a newer browser
   * just set, with nothing anywhere reporting the loss.
   */
  it('round-trips keys the backend has never heard of', async () => {
    const data = { somethingShippedNextRelease: { nested: [1, 'two', null, true] } };
    await put({ data }).expect(200);
    const read = await get().expect(200);
    expect(read.body.data).toEqual(data);
  });

  it('overwrites rather than merging — a second write is the whole state', async () => {
    await put({ data: { railCollapsed: true, timezone: 'UTC' } }).expect(200);
    await put({ data: { railCollapsed: false } }).expect(200);

    const read = await get().expect(200);
    // `timezone` is gone, not merged forward: last write wins over the document,
    // not field by field. The client always sends its complete blob.
    expect(read.body.data).toEqual({ railCollapsed: false });
  });

  it('keeps exactly one row per user however many times it is written', async () => {
    await put({ data: { a: 1 } }).expect(200);
    await put({ data: { a: 2 } }).expect(200);
    await put({ data: { a: 3 } }).expect(200);

    const rows = await prisma.userPreference.findMany({ where: { userId: owner.user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.data).toEqual({ a: 3 });
  });

  describe('boundary', () => {
    it('refuses a top-level array', async () => {
      await put({ data: [1, 2, 3] }).expect(400);
    });

    it('refuses a top-level scalar', async () => {
      await put({ data: 'railCollapsed' }).expect(400);
    });

    it('refuses a blob over the size cap, and says so', async () => {
      // Comfortably past 64 kB, and well under Express's 100 kB body limit would
      // NOT be — so this also pins that our cap is the one that fires, not
      // body-parser's, whose message is about a request rather than about
      // preferences.
      const res = await put({ data: { blob: 'x'.repeat(70 * 1024) } });
      expect(res.status).toBe(413);
      expect(String(res.body.error ?? res.body.message)).toMatch(/limit/i);
    });

    it('accepts an empty object — the defaults are a real answer', async () => {
      await put({ data: {} }).expect(200);
      const read = await get().expect(200);
      expect(read.body.data).toEqual({});
    });
  });

  describe('tenancy', () => {
    it('never reads another user’s preferences', async () => {
      const other = await createUser('prefs-other@example.com');
      await put({ data: { railCollapsed: true } }).expect(200);

      const res = await request(app)
        .get('/api/preferences')
        .set('Authorization', other.auth)
        .expect(200);

      expect(res.body.data).toBeNull();
    });

    it('never overwrites another user’s preferences', async () => {
      const other = await createUser('prefs-other2@example.com');
      await put({ data: { mine: true } }).expect(200);

      await request(app)
        .put('/api/preferences')
        .set('Authorization', other.auth)
        .send({ data: { mine: false } })
        .expect(200);

      const read = await get().expect(200);
      expect(read.body.data).toEqual({ mine: true });
    });

    it('requires authentication', async () => {
      await request(app).get('/api/preferences').expect(401);
      await request(app).put('/api/preferences').send({ data: {} }).expect(401);
    });
  });

  /**
   * Cascade, and it is the opposite of `TaskExclusion`'s shape on purpose: there
   * is nothing about a deleted account's sidebar worth outliving the account.
   */
  it('goes away with the user', async () => {
    await put({ data: { railCollapsed: true } }).expect(200);
    await prisma.user.delete({ where: { id: owner.user.id } });

    const rows = await prisma.userPreference.findMany({ where: { userId: owner.user.id } });
    expect(rows).toHaveLength(0);
  });
});
