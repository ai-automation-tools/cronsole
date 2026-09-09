import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { executionHost } from './runtimeContext.js';

/**
 * **The Claude Code account credential — the widest-reaching secret Cronsole
 * ever touches, and the only one it deliberately does not own.**
 *
 * Claude Code routines have two doors, and Cronsole now knows about both:
 *
 * | | Door 1 — per-routine token | Door 2 — account OAuth (this module) |
 * |---|---|---|
 * | Endpoint | `POST /v1/claude_code/routines/{id}/fire` | `/v1/code/triggers`, `/v1/code/sessions` |
 * | Verbs | fire, and nothing else | list · get · create · update · run · run history |
 * | Credential | `sk-ant-oat01-…`, minted per routine in the claude.ai UI | the account token Claude Code itself logged in with |
 * | Documented | yes | **no** — beta-gated, undocumented |
 *
 * Door 1 is what `ClaudeConnector` shipped on (2026-08-12), and its limits were
 * written into the architecture as facts about the platform: *"`/fire` is the
 * entire API surface"*, `create` and `setStatus` declared structurally
 * impossible, `syncTasks` reduced to reading back the user's own typed registry.
 * **Every one of those statements was true of the documented API and false of
 * the product.** Door 2 has existed the whole time; it is what `/schedule` and
 * `/code-review --post` use.
 *
 * ## Why the credential is read here and never stored
 *
 * Cronsole holds secrets already — agent pairing tokens, per-routine fire
 * tokens, whatever a `PlatformConnection.config` carries — and every one of them
 * is encrypted at rest and scoped to one thing. This one is different in kind,
 * not degree: it is the user's whole Claude Code identity, and with it a caller
 * can **create routines that run code in cloud sandboxes against their GitHub
 * repositories**. Copying that into Postgres would mean a second, longer-lived
 * copy of a credential that already has a home, guarded by an AES key sitting in
 * the same `.env` as the database URL that reaches the ciphertext.
 *
 * So it is never persisted, never logged, never returned to a browser, and never
 * written into `PlatformConnection.config`. It is read from disk at the moment a
 * request needs it and discarded. The single copy stays where Claude Code put it.
 *
 * ## Why Cronsole refuses to refresh it
 *
 * `~/.claude/.credentials.json` also holds a refresh token, and
 * `/v1/code/auth/refresh` exists — so refreshing an expired access token is
 * mechanically easy and **must not be done here**. A refresh rotates the stored
 * pair. Two processes refreshing the same credential race, and the loser is left
 * holding a revoked refresh token: Cronsole would silently log the user out of
 * the Claude Code CLI, from a scheduled background poll, with the symptom
 * appearing hours later in an unrelated terminal.
 *
 * **A task manager may not invalidate the login of the tool that created it.**
 * So this module opens the file read-only, in every sense: expiry is *reported*,
 * never repaired, and the repair instruction is the one the user already knows
 * (`claude` → `/login`). That is also why the connector degrades to door 1
 * rather than failing — an expired credential costs you the new verbs, not the
 * routines you had.
 *
 * ## Why a container refuses rather than tries
 *
 * The file lives in the user's home directory on their machine. In the
 * Dockerized stack that path is inside the container and simply is not there —
 * the same class of confusion `runtimeContext` exists to prevent for native
 * `EXEC` jobs, where a path the user can see in Explorer is not a path the
 * process can open. Reporting *"no credential found at /root/.claude"* would send
 * someone hunting for a file they are looking straight at. So a container says
 * what is actually true: this mode needs a host-run backend, or an explicit
 * `CLAUDE_OAUTH_TOKEN`.
 */

/** Anthropic's issued prefix for these tokens. Advisory — never enforced. */
const TOKEN_PREFIX = 'sk-ant-oat01-';

/**
 * How long a resolution is reused before the file is read again.
 *
 * `verbReachability` is synchronous and asks the connector whether a verb is
 * reachable once per verb per platform, and the Platforms matrix renders ten
 * verbs on a 45-second poll. Re-reading and JSON-parsing a ~40 KB credentials
 * file on each of those is pure waste that can only ever produce the same
 * answer. Short enough that a fresh `/login` is picked up within a minute
 * without restarting the backend.
 */
const CACHE_TTL_MS = 30_000;

/** Treat a token as expired this long before it actually is. */
const EXPIRY_SKEW_MS = 60_000;

export type ClaudeCredentialSource = 'env' | 'file';

/**
 * Why door 2 is unavailable. Each maps to a different sentence for the user, and
 * they are genuinely different situations — conflating them is how someone ends
 * up regenerating a token when the real problem is that they are in Docker.
 */
export type ClaudeCredentialProblem =
  | 'container'
  | 'no-file'
  | 'unreadable'
  | 'absent'
  | 'expired';

export interface ClaudeCredential {
  token: string;
  source: ClaudeCredentialSource;
  /** Absent for an env-supplied token — the env carries no expiry. */
  expiresAt?: Date;
}

export interface ClaudeCredentialResult {
  credential: ClaudeCredential | null;
  problem?: ClaudeCredentialProblem;
  /** One sentence naming the cause and the fix. Safe to show a user. */
  reason?: string;
  /** Where we looked, so a wrong `CLAUDE_CONFIG_DIR` is visible. Never the value. */
  checkedPath?: string;
}

/**
 * Where Claude Code keeps its credentials.
 *
 * `CLAUDE_CONFIG_DIR` is Claude Code's own override, honoured here so a
 * relocated config directory does not silently disable the connector. Resolved
 * per call rather than at import so tests can move it.
 */
export function credentialsPath(): string {
  const dir = process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude');
  return join(dir, '.credentials.json');
}

let cached: { at: number; result: ClaudeCredentialResult } | null = null;

/** Drop the memoized resolution. For tests, and for an explicit re-check. */
export function resetClaudeCredentialCache(): void {
  cached = null;
}

function resolve(): ClaudeCredentialResult {
  // An explicit env var outranks everything, including the container refusal:
  // someone who set it has stated what they want, and the reason a container
  // cannot use the file does not apply to a value handed in directly.
  const fromEnv = process.env.CLAUDE_OAUTH_TOKEN?.trim();
  if (fromEnv) {
    return { credential: { token: fromEnv, source: 'env' } };
  }

  if (executionHost.kind === 'container') {
    return {
      credential: null,
      problem: 'container',
      reason:
        'The backend is running in a container, so it cannot read your machine\'s Claude Code ' +
        'credentials. Run the backend on the host, or set CLAUDE_OAUTH_TOKEN for this container.'
    };
  }

  const path = credentialsPath();
  if (!existsSync(path)) {
    return {
      credential: null,
      problem: 'no-file',
      checkedPath: path,
      reason: `No Claude Code credentials at ${path}. Sign in with the Claude Code CLI (\`claude\`, then \`/login\`).`
    };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    // Deliberately not including the parse error: this file is a secret store,
    // and a JSON error message can quote the bytes it choked on.
    return {
      credential: null,
      problem: 'unreadable',
      checkedPath: path,
      reason: `Could not read ${path}. Re-authenticate with the Claude Code CLI (\`/login\`).`
    };
  }

  const oauth = parsed?.claudeAiOauth;
  const token = typeof oauth?.accessToken === 'string' ? oauth.accessToken.trim() : '';
  if (!token) {
    return {
      credential: null,
      problem: 'absent',
      checkedPath: path,
      reason:
        'Claude Code credentials exist but hold no account token. Sign in with the Claude Code CLI (`/login`).'
    };
  }

  const expiresAtMs = typeof oauth?.expiresAt === 'number' ? oauth.expiresAt : null;
  if (expiresAtMs !== null && expiresAtMs - EXPIRY_SKEW_MS <= Date.now()) {
    // Reported, never repaired — refreshing here would rotate the CLI's own
    // refresh token. See the header.
    return {
      credential: null,
      problem: 'expired',
      checkedPath: path,
      reason:
        'Your Claude Code session has expired. Refresh it in the Claude Code CLI (`/login`) — ' +
        'Cronsole deliberately does not refresh it for you, because that would rotate the CLI\'s own token.'
    };
  }

  return {
    credential: {
      token,
      source: 'file',
      ...(expiresAtMs !== null ? { expiresAt: new Date(expiresAtMs) } : {})
    },
    checkedPath: path
  };
}

/**
 * Resolve the account credential, memoized for {@link CACHE_TTL_MS}.
 *
 * Synchronous on purpose: `verbReachability` is sync, and the capability matrix
 * must be able to ask "can this install create a routine?" without becoming
 * async all the way up.
 */
export function getClaudeCredential(): ClaudeCredentialResult {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.result;
  const result = resolve();
  cached = { at: now, result };
  return result;
}

/** Is door 2 open on this install? The question the capability matrix asks. */
export const hasClaudeCredential = (): boolean => getClaudeCredential().credential !== null;

/** Does this look like an account token? Advisory, used only for a hint. */
export const looksLikeAccountToken = (token: string): boolean => token.startsWith(TOKEN_PREFIX);
