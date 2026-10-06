import { z } from 'zod';
import { normalizeBaseUrl } from './n8nApi.js';
import { describeDbUrl, isPostgresUrl } from './n8nFolders.js';

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
  /**
   * Optional Postgres URL for a read-only role on n8n's database — the only
   * place folder membership is readable (`services/n8nFolders.ts`). Holds a
   * password, so it is write-only like the key.
   */
  folderDbUrl?: string;
  /**
   * Optional token for the instance's MCP server (n8n → Settings › MCP access),
   * the one door that starts a workflow — `services/n8nMcp.ts`. Without it
   * `run` is refused with the setup named. A credential, so write-only.
   */
  mcpToken?: string;
  /**
   * Also track workflows with no schedule (form, webhook, manual, chat…) as
   * on-demand tasks. Absent means **on**; only an explicit `false` turns it off.
   */
  includeOnDemand?: boolean;
  /**
   * How workflows nest under `n8n` when no folder database is connected:
   * `trigger` (Scheduled / Forms / Webhooks / …) or `none`. Absent means
   * `trigger`. Real n8n folders always win when they can be read.
   */
  groupBy?: N8nGroupBy;
}

export type N8nGroupBy = 'trigger' | 'none';

export interface RedactedN8nConfig {
  baseUrl: string | null;
  hasKey: boolean;
  keyHint: string | null;
  timeZone: string | null;
  hasFolderDb: boolean;
  /** `host:port/db` — never the credentials. */
  folderDbHint: string | null;
  /** An MCP access token is stored, so Run now reaches n8n. */
  hasMcpToken: boolean;
  includeOnDemand: boolean;
  groupBy: N8nGroupBy;
}

/**
 * The one category every n8n workflow lands in.
 *
 * A constant, for the reason Gemini's is: one key sees one instance's flat
 * list. Folders nest *beneath* it from `metadata.folderPath` rather than
 * replacing it, because a category is derived from `externalId` (the sync
 * fence) and a workflow moved between folders keeps its id — so the folder is
 * refreshed metadata, not identity.
 */
export const N8N_CATEGORY = 'n8n';

/** Read the stored config, tolerating a shape written by an older build. */
export function readConfig(raw: unknown): N8nConfig {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const baseUrl = str(c.baseUrl);
  const apiKey = str(c.apiKey);
  const timeZone = str(c.timeZone);
  const folderDbUrl = str(c.folderDbUrl);
  const mcpToken = str(c.mcpToken);
  return {
    ...(baseUrl ? { baseUrl: normalizeBaseUrl(baseUrl) } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(timeZone ? { timeZone } : {}),
    ...(folderDbUrl ? { folderDbUrl } : {}),
    ...(mcpToken ? { mcpToken } : {}),
    ...(typeof c.includeOnDemand === 'boolean' ? { includeOnDemand: c.includeOnDemand } : {}),
    ...(c.groupBy === 'trigger' || c.groupBy === 'none' ? { groupBy: c.groupBy } : {})
  };
}

/** Everything except the three credentials. The only shape that leaves the server. */
export function redactConfig(config: N8nConfig): RedactedN8nConfig {
  return {
    baseUrl: config.baseUrl ?? null,
    hasKey: Boolean(config.apiKey),
    keyHint: config.apiKey ? config.apiKey.slice(-4) : null,
    timeZone: config.timeZone ?? null,
    hasFolderDb: Boolean(config.folderDbUrl),
    folderDbHint: config.folderDbUrl ? describeDbUrl(config.folderDbUrl) : null,
    hasMcpToken: Boolean(config.mcpToken),
    includeOnDemand: config.includeOnDemand !== false,
    groupBy: config.groupBy ?? 'trigger'
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

/** Either or both — a field left out keeps its stored value. */
export const optionsInputSchema = z
  .object({
    includeOnDemand: z.boolean().optional(),
    groupBy: z.enum(['trigger', 'none']).optional()
  })
  .refine(v => v.includeOnDemand !== undefined || v.groupBy !== undefined, { message: 'Nothing to change.' });

export const folderDbInputSchema = z.object({
  /** Blank clears it and folders stop being read. */
  url: z
    .string()
    .trim()
    .max(1024)
    .refine(v => v === '' || isPostgresUrl(v), { message: 'Use a postgres:// connection URL.' })
});

export const mcpTokenInputSchema = z.object({
  /** Blank clears it and Run now goes back to refusing with the setup named. */
  token: z.string().trim().max(4096)
});
