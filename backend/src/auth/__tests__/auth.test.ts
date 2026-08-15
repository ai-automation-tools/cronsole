import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';

/**
 * `auth.ts` reads its config at MODULE LOAD (that is the point — it fails fast
 * rather than at the first login), so every case here sets the environment and
 * then re-imports through `vi.resetModules()`.
 */
const SECRET = 'test-secret-at-least-16-chars-long';
const USER = { id: 'user_1', email: 'owner@example.test' };

async function loadAuth(expiresIn?: string) {
  vi.resetModules();
  process.env.JWT_SECRET = SECRET;
  if (expiresIn === undefined) delete process.env.JWT_EXPIRES_IN;
  else process.env.JWT_EXPIRES_IN = expiresIn;
  return import('../auth.js');
}

/** Seconds of life left on a freshly-minted token. */
function lifetimeSeconds(token: string): number {
  const { exp, iat } = jwt.decode(token) as { exp: number; iat: number };
  return exp - iat;
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('JWT_EXPIRES_IN', () => {
  it('defaults to 24h when unset, so a browser session is unchanged', async () => {
    const { generateToken, tokenLifetime } = await loadAuth(undefined);

    expect(lifetimeSeconds(generateToken(USER))).toBe(24 * 60 * 60);
    expect(tokenLifetime()).toBe('24h');
  });

  it('honours a duration string, which is what makes a long-lived MCP token supported', async () => {
    const { generateToken, tokenLifetime } = await loadAuth('30d');

    expect(lifetimeSeconds(generateToken(USER))).toBe(30 * 24 * 60 * 60);
    expect(tokenLifetime()).toBe('30d');
  });

  // THE footgun. `jsonwebtoken` passes a *string* to `ms`, which reads a unitless
  // string as MILLISECONDS — so '3600' would mean 3.6 seconds, every login would
  // appear to succeed, and every request after it would 403. Converting an
  // all-digits value to a number makes jsonwebtoken read it as seconds instead.
  it('reads a bare number as SECONDS, not milliseconds', async () => {
    const { generateToken } = await loadAuth('3600');

    expect(lifetimeSeconds(generateToken(USER))).toBe(3600);
  });

  it('tolerates surrounding whitespace from an env file', async () => {
    const { generateToken } = await loadAuth('  12h  ');

    expect(lifetimeSeconds(generateToken(USER))).toBe(12 * 60 * 60);
  });

  it('still signs the real user id and email', async () => {
    const { generateToken } = await loadAuth('24h');
    const payload = jwt.decode(generateToken(USER)) as { id: string; email: string };

    expect(payload.id).toBe(USER.id);
    expect(payload.email).toBe(USER.email);
  });
});

describe('JWT_EXPIRES_IN — refusing to start', () => {
  // Fail at boot, not at the first login. The runtime symptom of a bad value is
  // a 403 on every request, which points at the token rather than at the config
  // that produced it.
  it('refuses an unparseable duration', async () => {
    await expect(loadAuth('banana')).rejects.toThrow(/JWT_EXPIRES_IN is invalid \("banana"\)/);
  });

  // Parses fine, and is nonsense: every token is expired before it is handed out.
  it('refuses a zero lifetime', async () => {
    await expect(loadAuth('0')).rejects.toThrow(/already expired/);
  });

  it('refuses a negative lifetime', async () => {
    await expect(loadAuth('-5m')).rejects.toThrow(/JWT_EXPIRES_IN is invalid/);
  });

  it('names the offending value and the accepted forms', async () => {
    await expect(loadAuth('24 hours please')).rejects.toThrow(/"24 hours please"/);
    await expect(loadAuth('24 hours please')).rejects.toThrow(/"24h", "30d", or a plain number of seconds/);
  });
});

describe('token verification', () => {
  it('accepts a token it just issued and rejects one signed with another secret', async () => {
    const { generateToken, verifyToken } = await loadAuth('24h');

    expect(verifyToken(generateToken(USER))?.id).toBe(USER.id);
    expect(verifyToken(jwt.sign({ id: 'x', email: 'x@y.z' }, 'a-completely-different-secret'))).toBeNull();
  });

  it('rejects an expired token', async () => {
    const { verifyToken } = await loadAuth('24h');
    const expired = jwt.sign({ id: USER.id, email: USER.email }, SECRET, { expiresIn: -10 });

    expect(verifyToken(expired)).toBeNull();
  });
});
