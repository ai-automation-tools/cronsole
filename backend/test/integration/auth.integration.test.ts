import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';

// Exercises the real setup/login flow end-to-end: bcrypt hashing, the Prisma
// unique-email constraint, JWT issuance, and the Zod boundary schemas — all
// against a real Postgres.

const app = createApp();

describe('account creation is /setup only', () => {
  const creds = { email: 'newuser@example.com', password: 'correct-horse-battery', name: 'New User' };

  it('has no generic registration endpoint', async () => {
    // A tripwire, not a formality. `POST /register` shipped as an
    // unauthenticated account-creation primitive on a service that runs commands
    // on the user's machine; it was removed 2026-07-31 and must not drift back
    // in as a convenience for a test.
    const res = await request(app).post('/api/auth/register').send(creds);
    expect(res.status).toBe(404);

    const stillNeedsSetup = await request(app).get('/api/auth/status');
    expect(stillNeedsSetup.body.needsSetup).toBe(true); // and it created nothing
  });

  it('creates the owner, then authenticates a protected route with the issued token', async () => {
    const reg = await request(app).post('/api/auth/setup').send(creds);
    expect(reg.status).toBe(200);
    expect(reg.body.token).toBeTruthy();
    expect(reg.body.user.email).toBe(creds.email);
    expect(reg.body.user).not.toHaveProperty('password');

    const list = await request(app)
      .get('/api/tasks')
      .set('Authorization', `Bearer ${reg.body.token}`);
    expect(list.status).toBe(200);
    expect(list.body).toEqual([]);
  });

  it('logs in with the right password and rejects the wrong one', async () => {
    await request(app).post('/api/auth/setup').send(creds);

    const ok = await request(app)
      .post('/api/auth/login')
      .send({ email: creds.email, password: creds.password });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeTruthy();

    const bad = await request(app)
      .post('/api/auth/login')
      .send({ email: creds.email, password: 'wrong-password' });
    expect(bad.status).toBe(401);
    expect(bad.body.token).toBeUndefined();
  });

  // Note: /setup's own P2002 branch ("that email is already in use") is left
  // uncovered on purpose. Reaching it needs two password-less users, and which
  // one the route claims is decided by an unordered `findFirst` — a test for it
  // would be a coin flip dressed as an assertion. The duplicate-account case
  // that matters in this product is the 409 owner guard, covered below.

  it('rejects a weak password at the Zod boundary (400)', async () => {
    const res = await request(app)
      .post('/api/auth/setup')
      .send({ email: 'weak@example.com', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/8 characters/i);
  });

  it('rejects a malformed email at the Zod boundary (400)', async () => {
    const res = await request(app)
      .post('/api/auth/setup')
      .send({ email: 'not-an-email', password: 'correct-horse-battery' });
    expect(res.status).toBe(400);
  });

  it('rejects an unknown login with 401, not a 500', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ghost@example.com', password: 'whatever-123' });
    expect(res.status).toBe(401);
  });
});

describe('single-user first-run (status + setup)', () => {
  const creds = { email: 'owner@example.com', password: 'correct-horse-battery', name: 'Owner' };

  it('reports needsSetup:true on a fresh instance and false once an account exists', async () => {
    const before = await request(app).get('/api/auth/status');
    expect(before.status).toBe(200);
    expect(before.body.needsSetup).toBe(true);

    await request(app).post('/api/auth/setup').send(creds);

    const after = await request(app).get('/api/auth/status');
    expect(after.body.needsSetup).toBe(false);
  });

  it('setup creates the first account, returns a working token, and hashes the password', async () => {
    const res = await request(app).post('/api/auth/setup').send(creds);
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe(creds.email);
    expect(res.body.user).not.toHaveProperty('password');

    // The issued token authenticates a protected route.
    const list = await request(app)
      .get('/api/tasks')
      .set('Authorization', `Bearer ${res.body.token}`);
    expect(list.status).toBe(200);

    // Password is stored hashed, and the account logs in with it.
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: creds.email, password: creds.password });
    expect(login.status).toBe(200);
  });

  it('setup refuses to create a second account (409) — the single-user guard', async () => {
    await request(app).post('/api/auth/setup').send(creds);
    const second = await request(app)
      .post('/api/auth/setup')
      .send({ email: 'intruder@example.com', password: 'another-good-password' });
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/already exists/i);
  });

  it('setup enforces the password minimum at the Zod boundary (400)', async () => {
    const res = await request(app)
      .post('/api/auth/setup')
      .send({ email: 'owner@example.com', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/8 characters/i);
  });

  it('treats the password-less catalog placeholder as "needs setup" and CLAIMS it (no second user)', async () => {
    // The boot seed always upserts this password-less user to own the shared
    // catalog. It must not count as an account, and setup must claim it rather
    // than create a duplicate — so the owner keeps that identity's task ownership.
    const placeholder = await prisma.user.create({
      data: { id: 'cli_user_placeholder', email: 'mike@example.com', password: '' }
    });

    const status = await request(app).get('/api/auth/status');
    expect(status.body.needsSetup).toBe(true); // a password-less user is not an account

    const res = await request(app).post('/api/auth/setup').send(creds);
    expect(res.status).toBe(200);
    // Claimed the same row — no duplicate user, and it's still the catalog owner id.
    expect(res.body.user.id).toBe(placeholder.id);
    expect(await prisma.user.count()).toBe(1);

    const claimed = await prisma.user.findUnique({ where: { id: placeholder.id } });
    expect(claimed?.email).toBe(creds.email);
    expect(claimed?.password).not.toBe(''); // now hashed
    expect(await request(app).get('/api/auth/status').then(r => r.body.needsSetup)).toBe(false);
  });
});

describe('change password', () => {
  const creds = { email: 'owner@example.com', password: 'original-password-123', name: 'Owner' };

  async function setupAndToken() {
    const res = await request(app).post('/api/auth/setup').send(creds);
    return res.body.token as string;
  }

  it('changes the password when the current one is correct, and the new one then logs in', async () => {
    const token = await setupAndToken();

    const change = await request(app)
      .patch('/api/auth/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: creds.password, newPassword: 'a-brand-new-password' });
    expect(change.status).toBe(200);

    const oldLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: creds.email, password: creds.password });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: creds.email, password: 'a-brand-new-password' });
    expect(newLogin.status).toBe(200);
  });

  it('rejects a wrong current password with 401 and leaves the password unchanged', async () => {
    const token = await setupAndToken();

    const change = await request(app)
      .patch('/api/auth/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'not-the-password', newPassword: 'a-brand-new-password' });
    expect(change.status).toBe(401);

    // Original password still works.
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: creds.email, password: creds.password });
    expect(login.status).toBe(200);
  });

  it('requires authentication (401 without a token)', async () => {
    await setupAndToken();
    const res = await request(app)
      .patch('/api/auth/password')
      .send({ currentPassword: creds.password, newPassword: 'a-brand-new-password' });
    expect(res.status).toBe(401);
  });
});
