import { describe, it, expect } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
import { generateToken } from '../../src/auth/auth.js';

/**
 * Long-lived API tokens for non-browser clients (the MCP server above all), and
 * the revocation that is the only reason a `never` lifetime is offered at all.
 *
 * Driven through the real routes against real Postgres, because everything that
 * matters here — the stored `jti`, the revocation check, owner scoping — is
 * database behaviour that a stubbed test could not observe.
 */
const app = createApp();

const PASSWORD = 'correct-horse-battery-staple';

/** An owner with a real bcrypt password, plus a browser session to act with. */
async function createOwner(email: string) {
  const user = await prisma.user.create({
    data: { email, name: 'Owner', password: await bcrypt.hash(PASSWORD, 10) }
  });
  return { user, auth: `Bearer ${generateToken({ id: user.id, email: user.email })}` };
}

async function issue(auth: string, body: Record<string, unknown>) {
  return request(app).post('/api/auth/tokens').set('Authorization', auth).send(body);
}

/** Decode a JWT payload without verifying — we want to inspect the claims. */
function claims(token: string): { exp?: number; iat: number; jti?: string } {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
}

describe('issuing API tokens', () => {
  it('issues a token that authenticates a protected route', async () => {
    const { auth } = await createOwner('issue@example.com');

    const res = await issue(auth, { name: 'Claude Code', expiresIn: '30d', password: PASSWORD });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.apiToken.name).toBe('Claude Code');

    const used = await request(app).get('/api/tasks').set('Authorization', `Bearer ${res.body.token}`);
    expect(used.status).toBe(200);
  });

  it.each([
    ['30d', 30],
    ['60d', 60],
    ['90d', 90]
  ])('sets a real expiry for %s', async (lifetime, days) => {
    const { auth } = await createOwner(`life-${lifetime}@example.com`);

    const res = await issue(auth, { name: lifetime, expiresIn: lifetime, password: PASSWORD });
    expect(res.status).toBe(201);

    const { exp, iat } = claims(res.body.token);
    expect(exp! - iat).toBe(days * 24 * 60 * 60);
    // The stored date is an independent second check, not a copy of the claim.
    const stored = new Date(res.body.apiToken.expiresAt).getTime();
    expect(Math.abs(stored - exp! * 1000)).toBeLessThan(5000);
  });

  // `never` must mean NO exp claim — not a date far in the future. A sentinel
  // date is a different fact that happens to look the same for a while.
  it('issues a never-expiring token with no exp claim and a null expiresAt', async () => {
    const { auth } = await createOwner('never@example.com');

    const res = await issue(auth, { name: 'Forever', expiresIn: 'never', password: PASSWORD });
    expect(res.status).toBe(201);
    expect(claims(res.body.token).exp).toBeUndefined();
    expect(res.body.apiToken.expiresAt).toBeNull();

    const used = await request(app).get('/api/tasks').set('Authorization', `Bearer ${res.body.token}`);
    expect(used.status).toBe(200);
  });

  it('carries a jti, which is what makes revocation possible', async () => {
    const { auth } = await createOwner('jti@example.com');
    const res = await issue(auth, { name: 'With jti', expiresIn: '30d', password: PASSWORD });

    const jti = claims(res.body.token).jti;
    expect(jti).toBeTruthy();
    expect(await prisma.apiToken.findUnique({ where: { jti: jti! } })).toBeTruthy();
  });

  // A borrowed open tab must not be enough to mint a credential that outlives
  // every session — the same reasoning as PATCH /password.
  it('refuses without the current password, even with a valid session', async () => {
    const { auth } = await createOwner('nopw@example.com');

    expect((await issue(auth, { name: 'x', expiresIn: '30d', password: 'wrong' })).status).toBe(401);
    expect((await issue(auth, { name: 'x', expiresIn: '30d' })).status).toBe(400);
    expect(await prisma.apiToken.count()).toBe(0);
  });

  it('refuses an unauthenticated caller and an unknown lifetime', async () => {
    const { auth } = await createOwner('bad@example.com');

    expect((await request(app).post('/api/auth/tokens').send({ name: 'x', expiresIn: '30d', password: PASSWORD })).status).toBe(401);
    expect((await issue(auth, { name: 'x', expiresIn: '10y', password: PASSWORD })).status).toBe(400);
    expect((await issue(auth, { name: '  ', expiresIn: '30d', password: PASSWORD })).status).toBe(400);
  });
});

describe('revoking API tokens', () => {
  it('stops a revoked token dead, including a never-expiring one', async () => {
    const { auth } = await createOwner('revoke@example.com');
    const res = await issue(auth, { name: 'Forever', expiresIn: 'never', password: PASSWORD });
    const bearer = `Bearer ${res.body.token}`;

    expect((await request(app).get('/api/tasks').set('Authorization', bearer)).status).toBe(200);

    const del = await request(app).delete(`/api/auth/tokens/${res.body.apiToken.id}`).set('Authorization', auth);
    expect(del.status).toBe(200);

    const after = await request(app).get('/api/tasks').set('Authorization', bearer);
    expect(after.status).toBe(403);
    expect(after.body.error).toMatch(/revoked/i);
  });

  it('keeps the revoked row visible rather than deleting it', async () => {
    const { auth } = await createOwner('visible@example.com');
    const res = await issue(auth, { name: 'Gone', expiresIn: '30d', password: PASSWORD });
    await request(app).delete(`/api/auth/tokens/${res.body.apiToken.id}`).set('Authorization', auth);

    const list = await request(app).get('/api/auth/tokens').set('Authorization', auth);
    expect(list.body.tokens).toHaveLength(1);
    expect(list.body.tokens[0].revokedAt).toBeTruthy();
  });

  it('is idempotent — a second revoke is a 404, not a success', async () => {
    const { auth } = await createOwner('twice@example.com');
    const res = await issue(auth, { name: 'Once', expiresIn: '30d', password: PASSWORD });
    const url = `/api/auth/tokens/${res.body.apiToken.id}`;

    expect((await request(app).delete(url).set('Authorization', auth)).status).toBe(200);
    expect((await request(app).delete(url).set('Authorization', auth)).status).toBe(404);
  });

  // IDOR: one owner must not be able to revoke another's token, and the refusal
  // must not distinguish "not yours" from "does not exist".
  it('cannot revoke another user\'s token, and says the same thing as not-found', async () => {
    const alice = await createOwner('alice@example.com');
    const bob = await createOwner('bob@example.com');

    const res = await issue(alice.auth, { name: "Alice's", expiresIn: '30d', password: PASSWORD });

    const attempt = await request(app)
      .delete(`/api/auth/tokens/${res.body.apiToken.id}`)
      .set('Authorization', bob.auth);
    expect(attempt.status).toBe(404);

    const missing = await request(app)
      .delete('/api/auth/tokens/does-not-exist')
      .set('Authorization', bob.auth);
    expect(missing.status).toBe(404);
    expect(attempt.body.error).toBe(missing.body.error);

    // And Alice's token still works — the refusal was not a partial success.
    expect(
      (await request(app).get('/api/tasks').set('Authorization', `Bearer ${res.body.token}`)).status
    ).toBe(200);
  });
});

describe('listing API tokens', () => {
  it('never returns the token itself', async () => {
    const { auth } = await createOwner('list@example.com');
    const res = await issue(auth, { name: 'Secret', expiresIn: '90d', password: PASSWORD });

    const list = await request(app).get('/api/auth/tokens').set('Authorization', auth);
    expect(list.status).toBe(200);
    expect(list.body.tokens).toHaveLength(1);

    const serialized = JSON.stringify(list.body);
    expect(serialized).not.toContain(res.body.token);
    expect(list.body.tokens[0]).not.toHaveProperty('jti');
    expect(list.body.tokens[0]).not.toHaveProperty('token');
  });

  it('is scoped to the owner', async () => {
    const alice = await createOwner('alice2@example.com');
    const bob = await createOwner('bob2@example.com');
    await issue(alice.auth, { name: "Alice's", expiresIn: '30d', password: PASSWORD });

    const list = await request(app).get('/api/auth/tokens').set('Authorization', bob.auth);
    expect(list.body.tokens).toEqual([]);
  });
});
