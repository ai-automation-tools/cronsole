import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';

/**
 * `checkToken` reads the `User` row on every call, so the mock is the whole
 * subject of the identity-resolution block below: it is what lets a test say
 * "this signature is good and the account is gone".
 */
const findUser = vi.fn();
const findApiToken = vi.fn();

vi.mock('../../db.js', () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => findUser(...args) },
    apiToken: {
      findUnique: (...args: unknown[]) => findApiToken(...args),
      update: () => Promise.resolve({})
    }
  }
}));

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
  findUser.mockReset();
  findApiToken.mockReset();
  // The ordinary case: the account named by the token still exists.
  findUser.mockResolvedValue({ id: USER.id, email: USER.email });
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
    const { generateToken, checkToken } = await loadAuth('24h');

    const good = await checkToken(generateToken(USER));
    expect(good).toMatchObject({ ok: true, user: { id: USER.id } });

    const forged = await checkToken(jwt.sign({ id: 'x', email: 'x@y.z' }, 'a-completely-different-secret'));
    expect(forged).toMatchObject({ ok: false, status: 403 });
  });

  it('rejects an expired token', async () => {
    const { checkToken } = await loadAuth('24h');
    const expired = jwt.sign({ id: USER.id, email: USER.email }, SECRET, { expiresIn: -10 });

    expect(await checkToken(expired)).toMatchObject({ ok: false, status: 403 });
  });
});

/**
 * The P0 item this block closes: a signature says who was signed for, not who
 * exists. Everything here is about the gap between those two.
 */
describe('resolving the identity from the database', () => {
  it('returns the row\'s email, not the claim — a stale claim never reaches req.user', async () => {
    const { generateToken, checkToken } = await loadAuth('24h');
    findUser.mockResolvedValue({ id: USER.id, email: 'renamed@example.test' });

    const result = await checkToken(generateToken(USER));

    expect(result).toEqual({ ok: true, user: { id: USER.id, email: 'renamed@example.test' } });
  });

  // The headline case. Before this, a correctly-signed token for a deleted user
  // stayed good for its whole life — up to `never`, for an API token.
  it('refuses a correctly-signed token whose account is gone, and says so', async () => {
    const { generateToken, checkToken } = await loadAuth('24h');
    findUser.mockResolvedValue(null);

    const result = await checkToken(generateToken(USER));

    expect(result).toEqual({ ok: false, status: 403, error: 'This account no longer exists' });
  });

  // Same rule the revocation lookup follows: being unable to ask is not
  // permission to assume yes.
  it('fails closed when the database cannot answer', async () => {
    const { generateToken, checkToken } = await loadAuth('24h');
    findUser.mockRejectedValue(new Error('connection refused'));

    expect(await checkToken(generateToken(USER))).toMatchObject({ ok: false, status: 503 });
  });

  // `findUnique({ where: { id: undefined } })` throws rather than refusing, so
  // this would surface as a 500 on a token that is merely unusable.
  it('refuses a signed token carrying no usable id', async () => {
    const { checkToken } = await loadAuth('24h');

    expect(await checkToken(jwt.sign({ email: USER.email }, SECRET))).toMatchObject({ ok: false, status: 403 });
    expect(findUser).not.toHaveBeenCalled();
  });

  // A revoked API token must never reach the user lookup — the cheap refusal
  // stays first, and a revoked token for a live account is still revoked.
  it('checks revocation before it checks the account', async () => {
    const { checkToken } = await loadAuth('24h');
    findApiToken.mockResolvedValue({ id: 'tok_1', revokedAt: new Date(), expiresAt: null, lastUsedAt: null });

    const token = jwt.sign({ ...USER, jti: 'jti-1' }, SECRET);
    expect(await checkToken(token)).toMatchObject({ ok: false, error: 'This API token has been revoked' });
    expect(findUser).not.toHaveBeenCalled();
  });
});
