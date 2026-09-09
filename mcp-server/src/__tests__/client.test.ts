import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { CronsoleClient, CronsoleApiError, configFromEnv } from '../client.js';

/**
 * The client owns exactly two things the backend can't cover for it: reading its
 * config from the environment, and turning an HTTP failure into an honest error.
 * Both have already shipped bugs (troubleshooting #8), so both are pinned here.
 *
 * Error normalization runs against a REAL local HTTP server rather than a mocked
 * axios: the thing under test is how axios reports failures, so mocking axios
 * would only assert our belief about it. A stub can't tell us we were wrong.
 */

// ---------------------------------------------------------------------------
// configFromEnv
// ---------------------------------------------------------------------------

describe('configFromEnv', () => {
  const saved = { ...process.env };

  // The pre-rename prefix, assembled rather than written literally: a rename
  // pass rewrote this file once already, turning the legacy-name tests into
  // assertions about the NEW name — which still passed, and so proved nothing.
  const LEGACY = ['TASK', 'HUB'].join('');

  beforeEach(() => {
    delete process.env.CRONSOLE_TOKEN;
    delete process.env.CRONSOLE_API_URL;
    delete process.env.CRONSOLE_TIMEOUT_MS;
    // The old names are still honored, so a developer with the legacy variable
    // still exported would otherwise make these tests pass or fail depending on
    // their shell — which is how a suite quietly stops testing.
    delete process.env[`${LEGACY}_TOKEN`];
    delete process.env[`${LEGACY}_API_URL`];
    delete process.env[`${LEGACY}_TIMEOUT_MS`];
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it('refuses to start when the token is unset', () => {
    expect(() => configFromEnv()).toThrow(/CRONSOLE_TOKEN is not set/);
  });

  it('still accepts the pre-rename variable names', () => {
    // The 2026-07-31 rename must not invalidate a working setup: the variable
    // lives in the USER's environment, not this repo, and on Windows it needs a
    // fresh terminal to even re-read (#8a). Renaming it in code alone would take
    // the tools away from anyone who hadn't re-exported yet.
    process.env[`${LEGACY}_TOKEN`] = 'legacy-token';
    process.env[`${LEGACY}_API_URL`] = 'http://legacy.test/api';

    const config = configFromEnv();
    expect(config.token).toBe('legacy-token');
    expect(config.baseUrl).toBe('http://legacy.test/api');
  });

  it('prefers the new name when both are set', () => {
    process.env[`${LEGACY}_TOKEN`] = 'legacy-token';
    process.env.CRONSOLE_TOKEN = 'current-token';
    expect(configFromEnv().token).toBe('current-token');
  });

  it('treats an unexpanded ${CRONSOLE_TOKEN} literal as unset, not as a token', () => {
    // The bug this pins: an MCP host passes an unset ${VAR} through as its
    // LITERAL text. A bare emptiness check sails past it, the backend rejects
    // the literal as "403 Invalid or expired token", and that reads as an
    // expired JWT — sending you to debug auth instead of your environment.
    process.env.CRONSOLE_TOKEN = '${CRONSOLE_TOKEN}';
    expect(() => configFromEnv()).toThrow(/passed through unexpanded/);
  });

  it('names the literal it actually received, so the message is diagnosable', () => {
    process.env.CRONSOLE_TOKEN = '${SOME_OTHER_VAR}';
    expect(() => configFromEnv()).toThrow(/\$\{SOME_OTHER_VAR\}/);
  });

  it('treats the ${VAR:-default} form as unexpanded too', () => {
    process.env.CRONSOLE_TOKEN = '${CRONSOLE_TOKEN:-}';
    expect(() => configFromEnv()).toThrow(/passed through unexpanded/);
  });

  it('does not mistake a real token that merely contains braces', () => {
    // Guards the guard: the check is anchored, so it must not swallow a
    // legitimate token. A false positive here would be a refusal to start.
    process.env.CRONSOLE_TOKEN = 'abc${nope}def';
    expect(configFromEnv().token).toBe('abc${nope}def');
  });

  it('trims surrounding whitespace from the token', () => {
    process.env.CRONSOLE_TOKEN = '  jwt.token.here  ';
    expect(configFromEnv().token).toBe('jwt.token.here');
  });

  it('defaults the base URL to the local backend', () => {
    process.env.CRONSOLE_TOKEN = 't';
    expect(configFromEnv().baseUrl).toBe('http://localhost:3000/api');
  });

  it('strips trailing slashes off the base URL', () => {
    process.env.CRONSOLE_TOKEN = 't';
    process.env.CRONSOLE_API_URL = 'https://example.com/api///';
    expect(configFromEnv().baseUrl).toBe('https://example.com/api');
  });

  it('defaults the timeout and honours an override', () => {
    process.env.CRONSOLE_TOKEN = 't';
    expect(configFromEnv().timeoutMs).toBe(15000);
    process.env.CRONSOLE_TIMEOUT_MS = '500';
    expect(configFromEnv().timeoutMs).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// CronsoleClient — against a real HTTP server
// ---------------------------------------------------------------------------

describe('CronsoleClient', () => {
  let server: Server;
  let baseUrl: string;
  let respond: (req: { url: string; method: string; body: string }) => {
    status: number;
    body: unknown;
  };
  let lastRequest: { url: string; method: string; body: string; auth?: string };

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', () => {
        lastRequest = {
          url: req.url ?? '',
          method: req.method ?? '',
          body,
          auth: req.headers.authorization
        };
        const r = respond({ url: req.url ?? '', method: req.method ?? '', body });
        res.writeHead(r.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r.body));
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  const client = () => new CronsoleClient({ baseUrl, token: 'test-token', timeoutMs: 2000 });

  it('sends the bearer token', async () => {
    respond = () => ({ status: 200, body: { ok: true } });
    await client().get('/tasks');
    expect(lastRequest.auth).toBe('Bearer test-token');
  });

  it('returns the response body on success', async () => {
    respond = () => ({ status: 200, body: [{ id: 'a' }] });
    await expect(client().get('/tasks')).resolves.toEqual([{ id: 'a' }]);
  });

  it('posts the body as JSON', async () => {
    respond = () => ({ status: 200, body: { ok: true } });
    await client().post('/tasks', { name: 'x' });
    expect(JSON.parse(lastRequest.body)).toEqual({ name: 'x' });
  });

  it("surfaces the backend's own { error } message and status", async () => {
    // The point of normalization: the caller must see "Task not found", not
    // axios's "Request failed with status code 404".
    respond = () => ({ status: 404, body: { error: 'Task not found' } });
    await expect(client().post('/tasks/x/run')).rejects.toMatchObject({
      name: 'CronsoleApiError',
      message: 'Task not found',
      status: 404
    });
  });

  it('falls back to { message } when there is no { error }', async () => {
    respond = () => ({ status: 409, body: { message: 'Name already exists' } });
    await expect(client().post('/tasks')).rejects.toMatchObject({
      message: 'Name already exists',
      status: 409
    });
  });

  it('still reports the status when the body carries neither', async () => {
    respond = () => ({ status: 500, body: {} });
    await expect(client().get('/tasks')).rejects.toMatchObject({
      message: 'Cronsole API returned HTTP 500',
      status: 500
    });
  });

  it('preserves the 403 an unexpanded token produces', async () => {
    respond = () => ({ status: 403, body: { error: 'Invalid or expired token' } });
    await expect(client().get('/tasks')).rejects.toMatchObject({
      message: 'Invalid or expired token',
      status: 403
    });
  });

  /** Await a call expected to fail and hand back the typed error. */
  const failure = async (p: Promise<unknown>): Promise<CronsoleApiError> => {
    try {
      await p;
      throw new Error('expected the call to reject, but it resolved');
    } catch (e) {
      expect(e).toBeInstanceOf(CronsoleApiError);
      return e as CronsoleApiError;
    }
  };

  it('explains an unreachable backend instead of leaking a connection code', async () => {
    // Port 1 is reserved and never listening.
    const dead = new CronsoleClient({ baseUrl: 'http://127.0.0.1:1', token: 't', timeoutMs: 1000 });
    const err = await failure(dead.get('/tasks'));
    expect(err.message).toMatch(/Could not reach the Cronsole backend/);
    expect(err.message).toMatch(/Is the backend running/);
    expect(err.status).toBeUndefined();
  });

  it('carries the raw error body as details', async () => {
    respond = () => ({ status: 400, body: { error: 'bad', warnings: ['w1'] } });
    const err = await failure(client().post('/tasks'));
    expect(err.details).toEqual({ error: 'bad', warnings: ['w1'] });
  });
});
