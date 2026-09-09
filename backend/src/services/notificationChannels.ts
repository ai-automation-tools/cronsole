import { prisma } from '../db.js';
import { encryptConfig, decryptConfig } from '../auth/encryption.js';

/**
 * A user's own opt-in run-outcome webhook (`NotificationChannel`, off by
 * default). Kept separate from `FailureNotificationService`'s
 * `FailureWebhookType` re-export to avoid a circular module dependency —
 * that service imports the CRUD functions below, so this file must not
 * import anything from it.
 */
export type NotificationWebhookType = 'generic' | 'discord' | 'ntfy' | 'resend';

export interface NotificationChannelConfig {
  url: string;
  type: NotificationWebhookType;
  headers: Record<string, string>;
  /** `resend` only. Neither is a credential — the API key lives in `headers`
   *  — so both are returned as-is by `redactChannel`, unlike `headers`. */
  to?: string;
  from?: string;
}

export interface NotificationChannelRow {
  enabled: boolean;
  notifyOnFailure: boolean;
  notifyOnSuccess: boolean;
  /** Empty = every task you own. Not encrypted — a `Task.id` is not a secret. */
  taskIds: string[];
  /** Decrypted. Null when nothing has been saved yet. */
  config: NotificationChannelConfig | null;
  updatedAt: Date;
}

export interface RedactedNotificationChannel {
  enabled: boolean;
  notifyOnFailure: boolean;
  notifyOnSuccess: boolean;
  taskIds: string[];
  url: string | null;
  type: NotificationWebhookType | null;
  /** Never the header values themselves — the `redactPreset` shape. */
  hasHeaders: boolean;
  to: string | null;
  from: string | null;
  updatedAt: Date | null;
}

const UNCONFIGURED: RedactedNotificationChannel = {
  enabled: false,
  notifyOnFailure: true,
  notifyOnSuccess: false,
  taskIds: [],
  url: null,
  type: null,
  hasHeaders: false,
  to: null,
  from: null,
  updatedAt: null
};

export async function getNotificationChannel(userId: string): Promise<NotificationChannelRow | null> {
  const row = await prisma.notificationChannel.findUnique({ where: { userId } });
  if (!row) return null;
  return {
    enabled: row.enabled,
    notifyOnFailure: row.notifyOnFailure,
    notifyOnSuccess: row.notifyOnSuccess,
    taskIds: row.taskIds,
    config: row.config ? (decryptConfig(row.config) as NotificationChannelConfig) : null,
    updatedAt: row.updatedAt
  };
}

export function redactChannel(row: NotificationChannelRow | null): RedactedNotificationChannel {
  if (!row) return UNCONFIGURED;
  return {
    enabled: row.enabled,
    notifyOnFailure: row.notifyOnFailure,
    notifyOnSuccess: row.notifyOnSuccess,
    taskIds: row.taskIds,
    url: row.config?.url ?? null,
    type: row.config?.type ?? null,
    hasHeaders: Object.keys(row.config?.headers ?? {}).length > 0,
    to: row.config?.to ?? null,
    from: row.config?.from ?? null,
    updatedAt: row.updatedAt
  };
}

/**
 * **Omitting `headers` keeps the stored ones** — the same rule the Gemini MCP
 * preset route (`routes/tools.ts`, saving a tool preset) already follows,
 * for the same reason: there is no reveal endpoint, so a caller that wants to
 * fix a typo'd URL without re-typing a token it may not have to hand needs a
 * way to say "don't touch this". `headers: {}` is the explicit clear; leaving
 * the field out of the request body is "unchanged". A caller that omits `url`
 * is saved with `config: null` — legal only while `enabled` is false (the
 * route's schema enforces that).
 */
export async function saveNotificationChannel(
  userId: string,
  input: {
    enabled: boolean;
    notifyOnFailure: boolean;
    notifyOnSuccess: boolean;
    /** Empty (or omitted) = every task you own. The route has already
     *  verified every id here belongs to this user. */
    taskIds?: string[];
    url?: string;
    type?: NotificationWebhookType;
    headers?: Record<string, string>;
    to?: string;
    from?: string;
  }
): Promise<NotificationChannelRow> {
  let headers = input.headers;
  if (headers === undefined) {
    const existing = await getNotificationChannel(userId);
    headers = existing?.config?.headers;
  }

  const config: NotificationChannelConfig | null = input.url
    ? { url: input.url, type: input.type ?? 'generic', headers: headers ?? {}, to: input.to, from: input.from }
    : null;

  const data = {
    enabled: input.enabled,
    notifyOnFailure: input.notifyOnFailure,
    notifyOnSuccess: input.notifyOnSuccess,
    taskIds: input.taskIds ?? [],
    config: config ? encryptConfig(config) : null
  };

  const row = await prisma.notificationChannel.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data
  });

  return {
    enabled: row.enabled,
    notifyOnFailure: row.notifyOnFailure,
    notifyOnSuccess: row.notifyOnSuccess,
    taskIds: row.taskIds,
    config,
    updatedAt: row.updatedAt
  };
}
