import { z } from 'zod';

/**
 * The Claude connection's config — the one place a user hands Cronsole a secret
 * by typing it in.
 *
 * Every other platform gets its credentials some other way: the Windows agent
 * pairs, Cronsole-native has no credential at all. Claude routines are the first
 * config a user *composes*, because Anthropic mints a **separate bearer token per
 * routine** in the web UI and exposes no API to read or manage them. So the list
 * is a registry the user maintains, and this module owns its shape.
 *
 * Two rules run through everything here, and they are the reason this is a module
 * rather than a Zod schema inline in the route:
 *
 * **1. The token is write-only.** It goes in and is never read back out — not by
 * a route, not into task metadata, not into a log line. `redactRoutines` is the
 * only shape that leaves the server, and it reports `hasToken` instead of the
 * value. There is no "reveal" endpoint: the token cannot be recovered from
 * claude.ai either (it is shown once), so a user who loses it regenerates, which
 * is the correct and only recovery.
 *
 * **2. What the user has in their hand is a URL, not an id.** The claude.ai modal
 * shows the full fire URL beside the token, so pasting the URL is the *expected*
 * mistake, not an edge case. `normalizeRoutineId` accepts it and extracts the id
 * rather than storing a URL that would 404 much later, at the first run.
 */

/** The token prefix Anthropic documents for per-routine OAuth tokens. */
const TOKEN_PREFIX = 'sk-ant-oat01-';

/**
 * The routine id is `trig_`-prefixed even though the API path calls it
 * `routine_id` — the docs flag their own mismatch.
 *
 * Checked against the live UI (2026-08-12): the routine's **page** URL
 * (`claude.ai/code/routines/trig_…`) and the API trigger's **Fire URL** carry
 * the same id, so both are valid places to copy it from. Worth stating because
 * the obvious assumption — that a product with two id-shaped URLs has two
 * different ids — is wrong here, and an earlier version of the warning text
 * asserted it.
 */
const ID_PREFIX = 'trig_';

export interface StoredRoutine {
  id: string;
  token: string;
  name?: string;
}

/** What may leave the server: everything except the secret. */
export interface RedactedRoutine {
  id: string;
  name?: string;
  /** Always true for a stored routine — present so the absence is representable. */
  hasToken: boolean;
}

/**
 * Pull the routine id out of whatever the user pasted.
 *
 * Accepts the bare id or the full fire URL the API-trigger modal displays:
 * `https://api.anthropic.com/v1/claude_code/routines/trig_01ABC/fire`. Storing
 * the URL would be accepted here and then fail as a 404 at the first run, with
 * nothing pointing at the paste as the cause.
 *
 * Returns null when there is no `trig_` segment to find, which the caller turns
 * into a 400 that says what to copy.
 */
export function normalizeRoutineId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // A URL (or any path-ish paste): find the trig_ segment wherever it sits.
  const fromPath = trimmed.split(/[/?#]/).find(segment => segment.startsWith(ID_PREFIX));
  if (fromPath) return fromPath;

  // A bare value. Accepted without a prefix check — /fire is an experimental
  // API behind a dated beta header and the id format is not promised to hold.
  // Refusing an id Anthropic later changes would be worse than a 404 that names
  // itself; the route warns on the shape instead.
  return trimmed.includes('/') ? null : trimmed;
}

/** Does this id look like what the modal hands out? Advisory, never enforced. */
export const looksLikeRoutineId = (id: string) => id.startsWith(ID_PREFIX);

/** Does this token look like what the modal hands out? Advisory, never enforced. */
export const looksLikeRoutineToken = (token: string) => token.startsWith(TOKEN_PREFIX);

export const routineInputSchema = z.object({
  /** The bare `trig_…` id, or the whole fire URL — normalized before storage. */
  id: z.string().min(1, 'A routine id (or its fire URL) is required'),
  /**
   * Per-routine bearer token from *Edit routine → Add another trigger → API →
   * Generate token*. Shown once by claude.ai and never retrievable again.
   */
  token: z.string().min(1, 'A routine token is required'),
  /** Display name. Defaults to the id, which is unreadable but never wrong. */
  name: z.string().trim().min(1).max(120).optional()
});

export type RoutineInput = z.infer<typeof routineInputSchema>;

/**
 * Correcting a connected routine. Both fields optional — but at least one must
 * be present, or the request is a no-op the caller probably did not intend.
 *
 * There is **no `token` here on purpose**: keeping the stored token is the whole
 * reason this exists (a mistyped id should not cost a credential). Rotating a
 * token is the connect route's job, where re-adding an id replaces it.
 */
export const routineEditSchema = z
  .object({
    id: z.string().min(1).optional(),
    name: z.string().trim().min(1).max(120).optional()
  })
  .refine(v => v.id !== undefined || v.name !== undefined, {
    message: 'Provide a new id, a new name, or both'
  });

/**
 * Read the routines out of a decrypted connection config.
 *
 * Tolerant on purpose: this config is hand-maintained, and one malformed entry
 * must not make the other routines unrunnable. A bad entry is dropped here and
 * simply does not appear, rather than throwing and taking the whole list down.
 */
export function readRoutines(config: unknown): StoredRoutine[] {
  const raw = (config as { routines?: unknown } | null)?.routines;
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((entry): StoredRoutine[] => {
    if (!entry || typeof entry !== 'object') return [];
    const { id, token, name } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || !id) return [];
    if (typeof token !== 'string' || !token) return [];
    return [{ id, token, ...(typeof name === 'string' && name ? { name } : {}) }];
  });
}

/**
 * The only routine shape allowed out of the server.
 *
 * Not `{ ...routine, token: undefined }` — that leaves the key present and keeps
 * the secret out of the response only because `JSON.stringify` drops undefined.
 * The same near-miss was in `ClaudeConnector.syncTasks`; a secret staying out of
 * a payload on a serializer's incidental behaviour is not a decision.
 */
export const redactRoutines = (routines: StoredRoutine[]): RedactedRoutine[] =>
  routines.map(({ id, name }) => ({ id, ...(name ? { name } : {}), hasToken: true }));

/**
 * Add a routine, or replace the one already stored under that id.
 *
 * Replace rather than reject, because **re-adding is how you rotate**: a
 * regenerated token revokes its predecessor at Anthropic, so the stored one is
 * dead the moment the user clicks Generate. Making them delete first would add a
 * step to the only recovery path there is.
 */
export function upsertRoutine(existing: StoredRoutine[], routine: StoredRoutine): StoredRoutine[] {
  const others = existing.filter(r => r.id !== routine.id);
  return [...others, routine];
}
