import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';

// Fail fast on a missing/weak JWT secret. A signing key is what stands between
// an anonymous request and a forged identity — booting with a hardcoded fallback
// would let anyone mint a valid token, so refuse to start without a real one.
const secret = process.env.JWT_SECRET;
if (!secret || secret.length < 16) {
  throw new Error(
    'JWT_SECRET must be set to a strong value (>= 16 chars). Refusing to start with a missing or weak secret.'
  );
}
const JWT_SECRET: string = secret;

/**
 * How long an issued token lives. Defaults to `24h`, so nothing changes for a
 * browser session unless someone deliberately sets this.
 *
 * It exists because the product could not issue the credential its own shipped
 * integration requires. `expiresIn` was hardcoded to `24h`, and the MCP server is
 * a long-lived stdio client that cannot re-authenticate — so the documented path
 * in MCP_Server_Guide.md told users to run `jsonwebtoken.sign(..., '30d')` by
 * hand, with `JWT_SECRET` in scope and a `userId` read out of the database. That
 * is not a workaround someone invented; it was the answer, and it required
 * forging a credential to use a feature we ship. This makes the long-lived token
 * a *supported* thing.
 *
 * **It is deliberately one value for all tokens, and that is the known limit.**
 * Raising it to `30d` for the MCP server also gives the browser a 30-day session
 * in `localStorage` — on a phone, if you use remote access. There is no way to
 * separate them without an issuing surface that can mint a token distinct from a
 * login, which is roadmap item (b): named tokens, listed and revocable, stored as
 * hashes. Until then the trade is explicit rather than hidden.
 */
const rawExpiresIn = (process.env.JWT_EXPIRES_IN ?? '24h').trim();

/**
 * An all-digits value means SECONDS, matching the JWT `exp` claim and every
 * reader's intuition.
 *
 * This conversion is load-bearing, not tidiness. `jsonwebtoken` hands a *string*
 * to the `ms` package, which reads a unitless string as **milliseconds** — so
 * `JWT_EXPIRES_IN=3600`, meaning "an hour" to anyone who writes it, would issue
 * tokens lasting 3.6 seconds. Every login would appear to succeed and every
 * subsequent request would 403. Passing a `number` instead makes jsonwebtoken
 * treat it as seconds, which is what the spec means and what the author meant.
 */
const JWT_EXPIRES_IN: string | number = /^\d+$/.test(rawExpiresIn)
  ? Number(rawExpiresIn)
  : rawExpiresIn;

// Fail fast on a value that cannot produce a usable token, for the same reason
// the secret does: the alternative is a process that boots fine and breaks at
// the first login, where the symptom (403 on every request) points at the token
// rather than at the config that produced it.
//
// Probe-sign rather than pattern-match. `ms` accepts a wide, undocumented range
// of spellings ('2 days', '10h', '1y'), so any regex here would reject valid
// values or admit invalid ones — asking the library the real question is both
// simpler and correct by construction.
try {
  const probe = jwt.sign({ probe: true }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions);
  const { exp } = jwt.decode(probe) as { exp?: number };
  if (!exp || exp * 1000 <= Date.now()) {
    // Catches values that parse but are nonsense — `0`, or a negative — which
    // would mint tokens that are already expired when they are handed out.
    throw new Error('it produces a token that is already expired');
  }
} catch (err) {
  throw new Error(
    `JWT_EXPIRES_IN is invalid ("${rawExpiresIn}"): ${(err as Error).message}. ` +
    'Use a duration like "24h", "30d", or a plain number of seconds. Refusing to start.'
  );
}

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
  };
}

/**
 * Selectable lifetimes for an issued API token. `never` is only offered because
 * these tokens are **revocable** — see `ApiToken`. A permanent credential that
 * cannot be withdrawn short of rotating `JWT_SECRET` (which signs out every
 * client at once) would not be a feature.
 */
export const API_TOKEN_LIFETIMES = {
  '30d': 30 * 24 * 60 * 60,
  '60d': 60 * 24 * 60 * 60,
  '90d': 90 * 24 * 60 * 60,
  never: null
} as const;

export type ApiTokenLifetime = keyof typeof API_TOKEN_LIFETIMES;

export const isApiTokenLifetime = (v: unknown): v is ApiTokenLifetime =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(API_TOKEN_LIFETIMES, v);

/**
 * How stale `ApiToken.lastUsedAt` may get. Without a floor, an active MCP client
 * turns every read into a write — the field is for "when did I last see this
 * credential", where a minute's precision is plenty and per-request accuracy
 * would cost more than the answer is worth.
 */
const LAST_USED_THROTTLE_MS = 60_000;

/**
 * Issue a long-lived API token for a non-browser client, and record it so it can
 * be revoked.
 *
 * The `jti` is what makes revocation possible: the database stores that claim and
 * nothing else about the token. The signature already proves authenticity, so the
 * only question the row has to answer is *"has this been withdrawn?"* — storing
 * the token, or even a hash of it, would be a second copy of a credential with no
 * use for it.
 */
export async function issueApiToken(
  user: { id: string; email: string },
  opts: { name: string; lifetime: ApiTokenLifetime }
): Promise<{ token: string; record: { id: string; name: string; expiresAt: Date | null; createdAt: Date } }> {
  const seconds = API_TOKEN_LIFETIMES[opts.lifetime];
  const jti = randomUUID();
  const expiresAt = seconds === null ? null : new Date(Date.now() + seconds * 1000);

  const token = jwt.sign(
    { id: user.id, email: user.email, jti },
    JWT_SECRET,
    // No `expiresIn` at all for `never`. Deliberately not a date far in the
    // future: "this token has no expiry" and "this token expires in 2099" are
    // different facts, and only one of them stays true.
    (seconds === null ? {} : { expiresIn: seconds }) as jwt.SignOptions
  );

  const record = await prisma.apiToken.create({
    data: { userId: user.id, name: opts.name, jti, expiresAt },
    select: { id: true, name: true, expiresAt: true, createdAt: true }
  });

  return { token, record };
}

/**
 * Middleware to verify a JWT.
 *
 * Two kinds of token reach here and they are checked differently. A **browser
 * session** carries no `jti`: the signature and `exp` are the whole story, and it
 * costs no database round trip — which matters, because every dashboard poll goes
 * through this. An **API token** carries a `jti` and is looked up, because the
 * point of issuing it was to be able to take it back.
 *
 * That split is why revocation did not cost the hot path anything.
 */
export type TokenCheck =
  | { ok: true; user: { id: string; email: string } }
  | { ok: false; status: number; error: string };

/**
 * The single definition of "is this token good right now", shared by the REST
 * middleware and the Socket.IO handshake.
 *
 * It is one function on purpose. Revocation that the API honours and the live-update
 * socket ignores is not revocation — a withdrawn token would keep an open channel
 * streaming task updates, which is the half nobody would think to test.
 */
export async function checkToken(token: string): Promise<TokenCheck> {
  let payload: { id: string; email: string; jti?: string };
  try {
    payload = jwt.verify(token, JWT_SECRET) as typeof payload;
  } catch {
    return { ok: false, status: 403, error: 'Invalid or expired token' };
  }

  if (payload.jti) {
    let record;
    try {
      record = await prisma.apiToken.findUnique({
        where: { jti: payload.jti },
        select: { id: true, revokedAt: true, expiresAt: true, lastUsedAt: true }
      });
    } catch {
      // The database is the only thing that can answer "was this revoked?", so
      // being unable to ask is not permission to assume "no". Fail closed.
      return { ok: false, status: 503, error: 'Cannot verify token right now' };
    }

    // A missing row means the token was signed by this secret but is unknown to
    // this database — treat it as withdrawn, not as unrecognised-but-fine.
    if (!record || record.revokedAt) {
      return { ok: false, status: 403, error: 'This API token has been revoked' };
    }

    // `never` tokens carry no `exp`, so for anything WITH an expiry the stored
    // date is a second check that does not depend on the claim inside the token.
    if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) {
      return { ok: false, status: 403, error: 'Invalid or expired token' };
    }

    const stale = !record.lastUsedAt || Date.now() - record.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS;
    if (stale) {
      // Observing a request must never fail it — the rule `recordCapability`
      // follows. This is bookkeeping, not a precondition.
      prisma.apiToken
        .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
        .catch(() => {});
    }
  }

  return { ok: true, user: { id: payload.id, email: payload.email } };
}

export const authenticateToken = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  const result = await checkToken(token);
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error });
  }

  req.user = result.user;
  next();
};

/**
 * Verify a JWT and return its payload, or null if invalid/expired. Used by the
 * Socket.IO UI channel, which authenticates on the handshake instead of a header.
 */
export function verifyToken(token: string): { id: string; email: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { id: string; email: string };
  } catch {
    return null;
  }
}

/**
 * Generate a JWT for a user. Lifetime comes from `JWT_EXPIRES_IN` (default `24h`).
 */
export const generateToken = (user: { id: string; email: string }) => {
  return jwt.sign(
    { id: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions
  );
};

/**
 * The configured token lifetime, as written. Exported so a route can *tell* the
 * caller how long the credential it just handed them will last.
 *
 * That reporting is the point. The failure this whole item exists to fix is a
 * credential lapsing silently — an expired `CRONSOLE_TOKEN` makes the MCP server
 * refuse to start, so the tools go *missing* rather than erroring, which reads as
 * "the integration is broken" instead of "your token expired" (troubleshooting
 * #8). A token you were never told the lifetime of can only be discovered to have
 * expired.
 */
export const tokenLifetime = (): string => String(rawExpiresIn);
