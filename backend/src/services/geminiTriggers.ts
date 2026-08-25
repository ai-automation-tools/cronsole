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

/**
 * **A saved MCP server — the thing a trigger references instead of carrying.**
 *
 * This is the one place Cronsole stores a credential it hands to *another*
 * platform, and it exists because the rule it replaces was built on a lifecycle
 * claim that live use falsified. §9 said such a token is "used once and stored
 * nowhere", and the reason recorded was that the value is needed *exactly once*.
 * It is needed once **per trigger** — again for the second task on the same
 * server, again on every prompt edit (a Gemini trigger is immutable, so editing
 * means recreating), and again for every trigger that used a rotated token.
 * Before this, rotating one key meant retyping it into every task by hand, from
 * memory, with nothing on screen saying which tasks were affected.
 *
 * **What did not change is the part that was always right.** No route returns
 * `headers` — {@link redactPreset} is the only shape that leaves the server, and
 * it reports *whether* a credential is set, never the value. A task stores the
 * preset's **name**, never its headers, which is
 * [ADR 0003](../../../docs/adr/0003-per-job-secrets.md)'s `${secret.NAME}` rule
 * one layer up: every existing reader — task metadata, an export, an archive, a
 * log line, an MCP tool response — is unchanged and none of them can leak a value
 * that was never put there.
 *
 * **Storing it here is not a new risk, and the precedent is two fields up.** This
 * config already holds the Gemini API key, under the same AES-256-GCM at rest,
 * and that key creates, runs, pauses and deletes every trigger in the project. A
 * third-party bearer token beside it is strictly the smaller credential. The
 * question was never whether Cronsole may hold a credential for this platform —
 * it holds a bigger one — but whether it needed to, and the answer turned out to
 * be yes.
 */
export interface AgentToolPreset {
  /**
   * What the user calls it, and what a task references.
   *
   * Compared case-insensitively so `Resend` and `resend` cannot both exist and
   * silently resolve to different credentials.
   */
  name: string;
  /**
   * The MCP endpoint.
   *
   * **Unique across presets**, enforced at the write. Two presets pointing at one
   * URL would be indistinguishable on a *synced* trigger — the platform reports a
   * tool's URL and nothing else — so "which triggers use this preset" could not be
   * answered, and a rotation would either miss triggers or rebuild ones belonging
   * to the other credential. Refusing the second one states that constraint at the
   * moment somebody could still choose another name for it.
   */
  url: string;
  /**
   * The headers the agent authenticates with, typically `Authorization`.
   *
   * Optional: an MCP server that needs no credential is a legitimate preset, and
   * this being absent is what {@link redactPreset} reports as `hasHeaders: false`.
   */
  headers?: Record<string, string>;
}

/** A preset as it leaves the server: everything except the credential. */
export interface RedactedToolPreset {
  name: string;
  url: string;
  /**
   * Whether a credential is stored — not a masked value pretending to be
   * revealable. The key's `keyHint` shows four characters because two API keys
   * need telling apart; a header value has no such use, so there is no hint at all.
   */
  hasHeaders: boolean;
}

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
  /**
   * Saved MCP servers, reusable across triggers. See {@link AgentToolPreset}.
   *
   * On the **connection** rather than on a task, because that is the scope the
   * credential actually has: one Resend key serves every trigger that mails, and
   * putting it on a task would recreate the retyping this exists to remove.
   */
  toolPresets?: AgentToolPreset[];
}

/** What may leave the server: the agent, a fact about the key, the presets. */
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
  /** Saved MCP servers, without their credentials. */
  presets: RedactedToolPreset[];
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
  const presets = readPresets(c.toolPresets);
  return {
    ...(typeof c.apiKey === 'string' && c.apiKey ? { apiKey: c.apiKey } : {}),
    agent: typeof c.agent === 'string' && c.agent ? c.agent : DEFAULT_GEMINI_AGENT,
    // Absent rather than `[]` on a connection that has none, so the stored blob
    // of an install that never used presets is byte-identical to what it was.
    ...(presets.length ? { toolPresets: presets } : {})
  };
}

/**
 * Parse the stored preset list, dropping anything unusable.
 *
 * Tolerant because this reads a blob written by an **older or newer build** and a
 * single malformed entry must not take the connection down with it — the same
 * call `readConfig` makes about every other field. A preset without a name or a
 * URL cannot be referenced or connected to, so it is not a narrower grant, it is
 * nothing at all.
 */
function readPresets(raw: unknown): AgentToolPreset[] {
  if (!Array.isArray(raw)) return [];
  const out: AgentToolPreset[] = [];
  for (const entry of raw) {
    const p = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    const name = typeof p.name === 'string' ? p.name.trim() : '';
    const url = typeof p.url === 'string' ? p.url.trim() : '';
    if (!name || !url) continue;
    const headers: Record<string, string> = {};
    if (p.headers && typeof p.headers === 'object' && !Array.isArray(p.headers)) {
      for (const [k, v] of Object.entries(p.headers as Record<string, unknown>)) {
        if (typeof v === 'string' && k.trim()) headers[k.trim()] = v;
      }
    }
    out.push({ name, url, ...(Object.keys(headers).length ? { headers } : {}) });
  }
  return out;
}

/** Everything except the secrets. The only shape that leaves the server. */
export function redactConfig(config: GeminiConfig): RedactedGeminiConfig {
  return {
    hasKey: Boolean(config.apiKey),
    keyHint: config.apiKey ? config.apiKey.slice(-4) : null,
    agent: config.agent ?? null,
    defaultAgent: DEFAULT_GEMINI_AGENT,
    presets: (config.toolPresets ?? []).map(redactPreset)
  };
}

/**
 * One preset, without its credential.
 *
 * A named function rather than an inline map, because this is the boundary the
 * whole design rests on: if a header value ever reaches a response it will be
 * through a caller that built its own shape instead of calling this. Grep for it
 * before adding any route that returns a preset.
 */
export function redactPreset(preset: AgentToolPreset): RedactedToolPreset {
  return {
    name: preset.name,
    url: preset.url,
    hasHeaders: Object.keys(preset.headers ?? {}).length > 0
  };
}

/**
 * Find a preset by name, case-insensitively.
 *
 * Case-insensitive because the name is typed twice — once when saved, once when
 * referenced by a create — and a mismatch of capitals would fail a create with
 * "no such preset" over a name plainly visible on screen.
 */
export function findPreset(config: GeminiConfig, name: string): AgentToolPreset | undefined {
  const wanted = name.trim().toLowerCase();
  return (config.toolPresets ?? []).find(p => p.name.toLowerCase() === wanted);
}

/**
 * How many presets one connection may hold.
 *
 * A bound rather than a considered maximum: this list lives inside an encrypted
 * blob that is read on every sync, and an unbounded array in it is a slow leak
 * nobody would notice. Twenty is far past any real use of MCP servers on one
 * Google project.
 */
export const MAX_TOOL_PRESETS = 20;

export const presetInputSchema = z.object({
  /**
   * Letters, digits, dashes and underscores.
   *
   * The same shape as a `TaskSecret` name and for the same reason: this is a
   * **reference** typed into a form and matched later, so a name carrying spaces
   * or punctuation makes a failed match look like a bug rather than a typo.
   */
  name: z
    .string()
    .trim()
    .min(1, 'A name is required')
    .max(60)
    .regex(/^[A-Za-z0-9_-]+$/, 'Use letters, numbers, dashes and underscores.'),
  url: z.string().trim().url('That is not a valid URL').max(500),
  /**
   * Optional, and **absent means "leave whatever is stored alone"** on an update
   * of an existing preset — which is what lets somebody fix a typo in a URL
   * without retyping a token they may not have to hand. Sending `{}` explicitly
   * clears the credential, so both intents are expressible.
   */
  headers: z.record(z.string().trim().min(1).max(100), z.string().max(4096)).optional()
});

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
