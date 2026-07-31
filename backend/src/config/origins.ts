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
 *
 * A refusal is **logged once per distinct origin** — see `makeRefusalLogger`.
 */
export function corsOptions(
  allowed: string[] = parseAllowedOrigins(),
  warn: (message: string) => void = console.warn
): CorsOptions {
  if (allowed.length === 0) return {};

  // Per-instance, not module-global: each app owns its own memory of what it
  // has already complained about.
  const noteRefusal = makeRefusalLogger(allowed, warn);

  return {
    origin(origin, callback) {
      if (!origin || allowed.includes(origin)) return callback(null, true);

      noteRefusal(origin);
      // Refuse by declining the CORS headers, not by throwing: an error here
      // becomes a 500 for a request the browser was going to block anyway, and
      // a 500 reads as "the server is broken" rather than "that origin isn't
      // allowed".
      callback(null, false);
    }
  };
}

/**
 * Cap on how many distinct refused origins get logged. A refusal is driven by a
 * request header, so an unbounded log is a request-driven memory leak and a way
 * to bury everything else in the log.
 */
const MAX_LOGGED_REFUSALS = 20;

/**
 * Says, once per origin, exactly what was refused and what would have been
 * accepted.
 *
 * **This is the whole point of the function.** The refusal itself is correct and
 * cheap; the expensive part is diagnosing it, because the failure appears in the
 * *browser* as a generic CORS error while `curl` — which sends no `Origin` — keeps
 * working and confirms the wrong theory. The server is the only party that knows
 * both the rejected origin and the configured list, and it was saying nothing.
 * See [troubleshooting #31].
 *
 * Once per origin, not once per request: a dashboard that can't reach the API
 * retries, and a warning that repeats forever is one you learn to scroll past.
 */
function makeRefusalLogger(allowed: string[], warn: (message: string) => void): (origin: string) => void {
  const seen = new Set<string>();
  let suppressed = false;

  return (origin: string) => {
    if (seen.has(origin)) return;

    if (seen.size >= MAX_LOGGED_REFUSALS) {
      if (!suppressed) {
        suppressed = true;
        warn(`CORS: more than ${MAX_LOGGED_REFUSALS} distinct origins refused — further refusals will not be logged.`);
      }
      return;
    }

    seen.add(origin);
    warn(
      `CORS: refused origin "${forLog(origin)}" — not in ALLOWED_ORIGINS (allowed: ${allowed.join(', ')}). ` +
      `If that is your dashboard, add it to ALLOWED_ORIGINS and restart the backend.`
    );
  };
}

/**
 * The refused origin is attacker-controlled request-header content on its way
 * into a log line, so it is truncated and stripped of control characters —
 * otherwise a crafted `Origin` could forge log entries around itself. Same
 * instinct as neutralizing formula injection in the CSV export: the sink decides
 * what its own dangerous characters are.
 */
function forLog(origin: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = origin.replace(/[\x00-\x1f\x7f]/g, '?');
  return clean.length > 120 ? `${clean.slice(0, 120)}…` : clean;
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
