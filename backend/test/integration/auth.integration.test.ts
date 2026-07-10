import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';

// Exercises the real register/login flow end-to-end: bcrypt hashing, the Prisma
// unique-email constraint, JWT issuance, and the Zod boundary schemas — all
// against a real Postgres.

const app = createApp();

describe('auth flow', () => {
  const creds = { email: 'newuser@example.com', password: 'correct-horse-battery', name: 'New User' };

  it('registers, then authenticates a protected route with the issued token', async () => {
    const reg = await request(app).post('/api/auth/register').send(creds);
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
    await request(app).post('/api/auth/register').send(creds);

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

  it('rejects a duplicate email (Prisma P2002 → 400)', async () => {
    await request(app).post('/api/auth/register').send(creds);
    const dup = await request(app).post('/api/auth/register').send(creds);
    expect(dup.status).toBe(400);
    expect(dup.body.error).toMatch(/already exists/i);
  });

  it('rejects a weak password at the Zod boundary (400)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'weak@example.com', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/8 characters/i);
  });

  it('rejects a malformed email at the Zod boundary (400)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
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
