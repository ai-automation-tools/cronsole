import type { CorsOptions } from 'cors';

/**
 * One definition of "which browser origins may talk to this instance", shared by
 * the REST API (`app.ts`) and the Socket.IO server (`index.ts`).
 *
 * They used to disagree: Socket.IO was restricted to `ALLOWED_ORIGINS` while
 * Express ran a bare `app.use(cors())`, which reflects *any* origin — so the
 * REST API was readable cross-origin by any page the user happened to have open
 * while TaskHub was running. Two mechanisms answering the same question is how
 * one of them quietly stops matching the other, so there is now one parser and
 * one policy.
 */
export function parseAllowedOrigins(raw: string | undefined = process.env.ALLOWED_ORIGINS): string[] {
  return (raw || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * CORS policy for the REST API.
 *
 * Two rules, both deliberate:
 *
 * 1. **A request with no `Origin` header is always allowed.** That is every
 *    non-browser caller — the MCP server, curl, the integration suite — and CORS
 *    was never their gate anyway; refusing them here would break real clients
 *    while stopping nothing, since a non-browser caller simply omits or forges
 *    the header. Authentication is what guards those paths.
 * 2. **An empty `ALLOWED_ORIGINS` stays permissive**, so a dev who never set the
 *    variable is unaffected. It is not silent, though — `warnOnPermissiveCors()`
 *    says so at boot, because "unset" and "deliberately open" look identical
 *    from inside the process and only one of them is a decision.
 *
 * Both `.env.example` and `docker-compose.yml` ship the variable set, so the
 * normal path is the restricted one.
 */
export function corsOptions(allowed: string[] = parseAllowedOrigins()): CorsOptions {
  if (allowed.length === 0) return {};

  return {
    origin(origin, callback) {
      if (!origin || allowed.includes(origin)) return callback(null, true);
      // Refuse by declining the CORS headers, not by throwing: an error here
      // becomes a 500 for a request the browser was going to block anyway, and
      // a 500 reads as "the server is broken" rather than "that origin isn't
      // allowed".
      callback(null, false);
    }
  };
}

/**
 * Loud, non-fatal boot notice when nothing restricts browser origins. Non-fatal
 * because a local-only install with no `ALLOWED_ORIGINS` is a working, ordinary
 * setup — but the moment the P3 remote-access work puts a browser origin in
 * front of this API, "we never set it" stops being harmless.
 */
export function warnOnPermissiveCors(allowed: string[] = parseAllowedOrigins()): void {
  if (allowed.length > 0) return;

  console.warn(
    'ALLOWED_ORIGINS is unset — the REST API accepts requests from any browser origin. ' +
    'Set it to your frontend origin (e.g. http://localhost:7373) to restrict it.'
  );
}
