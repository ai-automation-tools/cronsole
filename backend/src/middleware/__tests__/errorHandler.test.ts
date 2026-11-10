import { describe, it, expect, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { errorHandler } from '../errorHandler.js';

afterEach(() => vi.restoreAllMocks());

describe('errorHandler', () => {
  it('keeps the request URL out of the log format string', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const boom = new Error('boom');
    const app = express();
    app.use((_req, _res, next) => next(boom));
    app.use(errorHandler);

    const res = await request(app).get('/x%25o%25s');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
    const [format, ...rest] = log.mock.calls[0];
    expect(format).toBe('[%s %s]');
    expect(rest).toEqual(['GET', '/x%25o%25s', boom]);
  });
});
