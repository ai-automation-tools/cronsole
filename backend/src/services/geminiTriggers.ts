import { z } from 'zod';

/**
 * **The Gemini connection's config** — one API key, and the agent to create with.
 *
 * The fourth connection a user composes by hand, and the **simplest of the
 * four**, because the platform gives it nothing to be complicated about:
 *
 * - Claude's config is a list of `(routine id, token)` pairs, because Anthropic
 *   mints a bearer token **per routine**.
 * - GitHub's and Vercel's are one token plus a list of the repositories or
 *   projects to watch, because a token there reaches thousands of things and the
 *   user has to name which ones matter.
 * - **Gemini's is one key and nothing to enumerate.** A key is scoped to one
 *   Google Cloud project, and that project's triggers are the whole set. There is
 *   no container to add, so there is no add-a-thing gesture, no picker, and no
 *   `TaskExclusion`-adjacent question about what a refresh includes.
 *
 * That absence is the reason `trackedCategories` is a constant here rather than
 * a read of the config: troubleshooting #75 was about a tracked set that lived in
 * the config and was wrongly derived from stored rows. This one lives *nowhere*,
 * because the platform has no such concept — so the honest answer is the single
 * constant category every trigger lands in.
 *
 * Two rules run through the module.
 *
 * **The key is write-only.** It goes in and never comes back — not from a route,
 * not into task metadata, not into a log line. {@link redactConfig} is the only
 * shape that leaves the server, and it reports `hasKey` plus the last four
 * characters rather than the value. There is no reveal endpoint: Google shows an
 * API key in its own console, which is the right place to go and look.
 *
 * **The agent id is configuration, not a constant.** `antigravity-preview-05-2026`
 * is what the docs name today and it is a *preview* string — it has a date in it.
 * Compiling it in would mean a create that starts 400ing on a Tuesday, months
 * after the code was written, with nothing in Cronsole to change. It is stored,
 * defaulted for convenience, and shown in the panel so the fix is a text field
 * rather than a release.
 */

export interface GeminiConfig {
  /** The Gemini API key. Absent on a connection whose key was cleared. */
  apiKey?: string;
  /**
   * The managed agent a Cronsole-created trigger runs.
   *
   * Not a credential and not a secret, so unlike the key this **is** returned to
   * the browser: the panel shows it, because a user whose creates start failing
   * needs to see the value before they can suspect it.
   */
  agent?: string;
}

/** What may leave the server: the agent, and a fact about the key. */
export interface RedactedGeminiConfig {
  hasKey: boolean;
  /**
   * The last four characters of the stored key, or null.
   *
   * Not a masked value pretending to be revealable — four characters is enough to
   * answer *"is this the key I just made?"* when someone has two, and not enough
   * to be one. Null when no key is stored, so "not connected" and "connected with
   * a key I cannot show you" stay different answers on screen.
   */
  keyHint: string | null;
  /** The stored agent, or null when the connection has never set one. */
  agent: string | null;
  /** The agent a create uses when none is stored — shown as the placeholder. */
  defaultAgent: string;
}

/**
 * The managed agent Cronsole creates triggers with when the connection names none.
 *
 * A **default, never a constant the code depends on**: it is the agent Google's
 * own trigger documentation uses as of 2026-08-24, and the date inside the string
 * is the platform telling you it will be replaced. `readConfig` falls back to it
 * so a fresh connection works without a decision; the panel shows it so the day
 * it stops working the fix is visible, editable, and does not need a release.
 */
export const DEFAULT_GEMINI_AGENT = 'antigravity-preview-05-2026';

/**
 * The one category every Gemini trigger lands in.
 *
 * A constant, for the reason `TaskService.extractCategory` returns `'Claude'` for
 * a routine: **the platform has no hierarchy to reflect.** A trigger has no
 * repository, project, folder or team — a key sees a flat list, and inventing a
 * grouping (by agent id, say) would put a preview string that changes with the
 * model release into the rail and into every saved view keyed on it.
 *
 * `'Uncategorized'` was the alternative and is actively worse here: the Import
 * screen is where a user picks which categories to track, and a source whose only
 * category is the word for *no category* reads as a bug.
 */
export const GEMINI_CATEGORY = 'Gemini';

/**
 * Read the stored config, tolerating a shape written by an older build.
 *
 * `agent` falls back to {@link DEFAULT_GEMINI_AGENT} rather than staying
 * undefined, so every caller downstream has a value and none of them has to
 * repeat the fallback — a second copy of "which agent do we use" is how a create
 * and a preview end up disagreeing about what a trigger will run.
 */
export function readConfig(raw: unknown): Required<Pick<GeminiConfig, 'agent'>> & GeminiConfig {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    ...(typeof c.apiKey === 'string' && c.apiKey ? { apiKey: c.apiKey } : {}),
    agent: typeof c.agent === 'string' && c.agent ? c.agent : DEFAULT_GEMINI_AGENT
  };
}

/** Everything except the secret. The only shape that leaves the server. */
export function redactConfig(config: GeminiConfig): RedactedGeminiConfig {
  return {
    hasKey: Boolean(config.apiKey),
    keyHint: config.apiKey ? config.apiKey.slice(-4) : null,
    agent: config.agent ?? null,
    defaultAgent: DEFAULT_GEMINI_AGENT
  };
}

/**
 * Does this look like a Google API key?
 *
 * **Advisory, never enforced** — the same call `looksLikeVercelToken` and
 * `looksLikeGitHubToken` make. Google's keys start `AIza` and run 39 characters
 * today, and that is a fact about this year rather than a contract. Refusing a
 * format Google introduces later would be a worse failure than the 403 that
 * names itself, so a mismatch is a warning beside a saved key.
 */
export const looksLikeGeminiKey = (key: string): boolean => /^AIza[A-Za-z0-9_-]{20,}$/.test(key);

export const keyInputSchema = z.object({
  apiKey: z.string().min(1, 'An API key is required').max(512)
});

export const agentInputSchema = z.object({
  /**
   * Blank is legal and means *use the default*, which is why this is not
   * `.min(1)`: clearing the field has to be a way back to the shipped default,
   * or a user who typed a wrong agent id has no path that does not involve
   * guessing the right one.
   */
  agent: z.string().max(200)
});
