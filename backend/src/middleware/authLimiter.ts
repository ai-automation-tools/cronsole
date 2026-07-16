import rateLimit from 'express-rate-limit';

/**
 * Rate-limiter for the credential-guessing surfaces (login + first-run setup).
 * A factory so the router uses production defaults while a test can build one
 * with a tiny `max` and prove the 429 fires.
 *
 * Skipped under `NODE_ENV=test` (so the auth integration suite isn't throttled)
 * and via `DISABLE_AUTH_RATE_LIMIT=true` (an escape hatch for local load
 * testing). Per-IP; on a local-first single-user app the point is to blunt
 * automated password guessing, not to be a fortress.
 *
 * Kept free of db/JWT imports so it can be unit-tested in isolation.
 */
export function makeAuthLimiter(opts?: { windowMs?: number; max?: number }) {
  return rateLimit({
    windowMs: opts?.windowMs ?? 15 * 60 * 1000,
    limit: opts?.max ?? 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
    skip: () => process.env.NODE_ENV === 'test' || process.env.DISABLE_AUTH_RATE_LIMIT === 'true'
  });
}
