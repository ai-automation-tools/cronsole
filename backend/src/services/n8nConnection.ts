import { z } from 'zod';
import { normalizeBaseUrl } from './n8nApi.js';

/**
 * **The n8n connection's config**: an instance URL, an API key, and the
 * instance's time zone.
 *
 * Shaped like Gemini's, for Gemini's reason: a key reaches one instance and
 * that instance's workflows are the whole set, so there is nothing to list,
 * no picker, and the tracked set is a constant ({@link N8N_CATEGORY}).
 *
 * **`timeZone` is the field no other connection has.** A Schedule Trigger is
 * wall-clock time in the instance's `GENERIC_TIMEZONE`, and the public API does
 * not report it. Without it every schedule is `null` with that reason, which is
 * correct and useless, so the panel asks for it next to the key. It is not a
 * credential, so unlike the key it is returned to the browser.
 */
export interface N8nConfig {
  /** Instance root, normalized — no `/api/v1`, no trailing slash. */
  baseUrl?: string;
  /** The `X-N8N-API-KEY`. Write-only: no route returns it. */
  apiKey?: string;
  /** IANA zone the instance schedules in, as the user declared it. */
  timeZone?: string;
}

export interface RedactedN8nConfig {
  baseUrl: string | null;
  hasKey: boolean;
  keyHint: string | null;
  timeZone: string | null;
}

/**
 * The one category every n8n workflow lands in.
 *
 * A constant, for the reason Gemini's is: one key sees one instance's flat
 * list. n8n does have folders and projects, but they are an enterprise and
 * a recent feature respectively, and a category built on either would change
 * meaning between installs.
 */
export const N8N_CATEGORY = 'n8n';

/** Read the stored config, tolerating a shape written by an older build. */
export function readConfig(raw: unknown): N8nConfig {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const baseUrl = str(c.baseUrl);
  const apiKey = str(c.apiKey);
  const timeZone = str(c.timeZone);
  return {
    ...(baseUrl ? { baseUrl: normalizeBaseUrl(baseUrl) } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(timeZone ? { timeZone } : {})
  };
}

/** Everything except the key. The only shape that leaves the server. */
export function redactConfig(config: N8nConfig): RedactedN8nConfig {
  return {
    baseUrl: config.baseUrl ?? null,
    hasKey: Boolean(config.apiKey),
    keyHint: config.apiKey ? config.apiKey.slice(-4) : null,
    timeZone: config.timeZone ?? null
  };
}

/** Does this runtime know the zone? `Intl` throws a RangeError on an unknown one. */
export function isKnownTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const timeZoneField = z
  .string()
  .trim()
  .max(64)
  .refine(v => v === '' || isKnownTimeZone(v), {
    message: 'Not a time zone this system recognises — use an IANA name such as America/New_York.'
  });

export const connectionInputSchema = z.object({
  baseUrl: z.string().trim().min(1, 'The n8n address is required').max(512),
  apiKey: z.string().trim().min(1, 'An API key is required').max(2048),
  /** Optional on connect; blank leaves every schedule unconverted, with that reason. */
  timeZone: timeZoneField.optional()
});

export const timeZoneInputSchema = z.object({
  /** Blank is legal and clears it — a way back, not a way to break it. */
  timeZone: timeZoneField
});
