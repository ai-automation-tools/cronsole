import { describe, it, expect, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { makeAuthLimiter } from '../authLimiter.js';

// The limiter skips itself under NODE_ENV=test (so the auth integration suite
// isn't throttled), so these tests flip NODE_ENV to exercise the real path.
function appWith(limiter: express.RequestHandler) {
  const app = express();
  app.post('/login', limiter, (_req, res) => res.json({ ok: true }));
  return app;
}

describe('makeAuthLimiter', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('returns 429 once the attempt limit is exceeded', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const app = appWith(makeAuthLimiter({ max: 3, windowMs: 60_000 }));

    // 3 allowed, the 4th blocked.
    for (let i = 0; i < 3; i++) {
      expect((await request(app).post('/login')).status).toBe(200);
    }
    const blocked = await request(app).post('/login');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/too many/i);
  });

  it('is disabled under NODE_ENV=test (never throttles the test suite)', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const app = appWith(makeAuthLimiter({ max: 1, windowMs: 60_000 }));

    for (let i = 0; i < 5; i++) {
      expect((await request(app).post('/login')).status).toBe(200);
    }
  });

  it('is disabled by DISABLE_AUTH_RATE_LIMIT even outside test', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DISABLE_AUTH_RATE_LIMIT', 'true');
    const app = appWith(makeAuthLimiter({ max: 1, windowMs: 60_000 }));

    for (let i = 0; i < 5; i++) {
      expect((await request(app).post('/login')).status).toBe(200);
    }
  });
});
