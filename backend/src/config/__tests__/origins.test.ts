import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import cors from 'cors';
import request from 'supertest';
import { parseAllowedOrigins, corsOptions, warnOnPermissiveCors } from '../origins.js';

// The assertions below are about the response HEADERS, not the status code:
// CORS is enforced by the browser, so a refused origin still gets a 200 body —
// what it does not get is `Access-Control-Allow-Origin`, which is the only thing
// that makes the response readable to the calling page.
function appWith(allowed: string[]) {
  const app = express();
  app.use(cors(corsOptions(allowed)));
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  return app;
}

describe('parseAllowedOrigins', () => {
  it('splits, trims, and drops empties', () => {
    expect(parseAllowedOrigins('http://a.test, http://b.test ,,')).toEqual([
      'http://a.test',
      'http://b.test'
    ]);
  });

  it('treats empty and whitespace as no configured origins', () => {
    expect(parseAllowedOrigins('')).toEqual([]);
    expect(parseAllowedOrigins('   ')).toEqual([]);
  });

  it('reads ALLOWED_ORIGINS when given no argument', () => {
    vi.stubEnv('ALLOWED_ORIGINS', 'http://env.test');
    expect(parseAllowedOrigins()).toEqual(['http://env.test']);

    // ...including when the variable is absent entirely.
    vi.stubEnv('ALLOWED_ORIGINS', '');
    expect(parseAllowedOrigins()).toEqual([]);
    vi.unstubAllEnvs();
  });
});

describe('REST CORS policy', () => {
  it('allows a configured origin', async () => {
    const res = await request(appWith(['http://localhost:7373']))
      .get('/api/health')
      .set('Origin', 'http://localhost:7373');

    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:7373');
  });

  it('refuses an origin that is not on the list', async () => {
    const res = await request(appWith(['http://localhost:7373']))
      .get('/api/health')
      .set('Origin', 'http://evil.test');

    // This is the regression the bare `app.use(cors())` allowed: any page the
    // user had open could read this response.
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('refuses a near-miss on port and scheme', async () => {
    const app = appWith(['http://localhost:7373']);

    for (const origin of ['http://localhost:7374', 'https://localhost:7373']) {
      const res = await request(app).get('/api/health').set('Origin', origin);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    }
  });

  it('allows a request with no Origin header — every non-browser caller', async () => {
    // The MCP server, curl, and the integration suite send no Origin. Refusing
    // them would break real clients and stop nothing: authentication, not CORS,
    // is what guards those paths.
    const res = await request(appWith(['http://localhost:7373'])).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('refuses the preflight for a disallowed origin', async () => {
    const res = await request(appWith(['http://localhost:7373']))
      .options('/api/health')
      .set('Origin', 'http://evil.test')
      .set('Access-Control-Request-Method', 'GET');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('stays permissive when nothing is configured, so an unset dev env is unchanged', async () => {
    const res = await request(appWith([]))
      .get('/api/health')
      .set('Origin', 'http://anything.test');

    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});

describe('warnOnPermissiveCors', () => {
  afterEach(() => vi.restoreAllMocks());

  it('warns when no origins are configured', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    warnOnPermissiveCors([]);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toMatch(/ALLOWED_ORIGINS/);
  });

  it('stays quiet when origins are configured', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    warnOnPermissiveCors(['http://localhost:7373']);
    expect(warn).not.toHaveBeenCalled();
  });
});
