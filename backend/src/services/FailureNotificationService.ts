import axios, { AxiosRequestConfig } from 'axios';
import type { ExecutionStatus, PlatformType, Task } from '@prisma/client';
import { getNotificationChannel } from './notificationChannels.js';

export type FailureNotificationTrigger = 'manual' | 'scheduled';
export type FailureWebhookType = 'generic' | 'discord' | 'ntfy' | 'resend';

/**
 * `SUCCESS` joined `FAILURE` / `TIMEOUT` here so a run's outcome is one event
 * shape regardless of which way it went — `notifyRunOutcome` below is the
 * only thing that reads a `SUCCESS` event; the legacy env-webhook path
 * (`sendFailureNotification`) never did and still refuses one (see there).
 */
export interface FailureNotificationEvent {
  task: Pick<Task, 'id' | 'userId' | 'platform' | 'externalId' | 'name'>;
  trigger: FailureNotificationTrigger;
  status: Extract<ExecutionStatus, 'FAILURE' | 'TIMEOUT' | 'SUCCESS'>;
  message: string;
  durationMs?: number | null;
  executionId?: string;
  triggeredAt?: Date;
}

export interface FailureNotificationResult {
  sent: boolean;
  reason?: 'not_configured' | 'delivery_failed' | 'invalid_headers';
}

interface FailureWebhookConfig {
  url: string;
  type: FailureWebhookType;
  headers: Record<string, string>;
  /** `resend` only — recipient and sender address. The API key rides in `headers.Authorization`. */
  to?: string;
  from?: string;
}

/** Resend has exactly one endpoint for this. Ignoring `config.url` here means a
 *  stored typo or a stale value can never send a would-be email nowhere. */
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

const WEBHOOK_URL_ENV = 'CRONSOLE_FAILURE_WEBHOOK_URL';
const WEBHOOK_TYPE_ENV = 'CRONSOLE_FAILURE_WEBHOOK_TYPE';
const WEBHOOK_HEADERS_ENV = 'CRONSOLE_FAILURE_WEBHOOK_HEADERS_JSON';

/**
 * The pre-rename prefix, assembled from parts so a future rename pass can't
 * helpfully rewrite it into `CRONSOLE_` and turn the fallback below into a
 * tautology. That is not hypothetical: it happened during stage 2 of the
 * 2026-07-31 rename, silently, and the pass rewrote the guarding test too.
 */
const LEGACY_PREFIX = ['TASK', 'HUB'].join('');

/**
 * These were `<legacy>_FAILURE_WEBHOOK_*` before the rename. The variable lives
 * in the operator's environment, not in this repo, so switching the name in code
 * alone would silently stop notifying on failure — the one feature whose whole
 * job is to speak up when something breaks. Read the new name, accept the old.
 */
function readEnv(name: string): string | undefined {
  const current = process.env[name];
  if (current !== undefined && current !== '') return current;
  return process.env[name.replace(/^CRONSOLE_/, `${LEGACY_PREFIX}_`)];
}
const DEFAULT_TIMEOUT_MS = 5000;

const pendingNotifications = new Set<Promise<FailureNotificationResult>>();

function configuredType(): FailureWebhookType {
  const raw = (readEnv(WEBHOOK_TYPE_ENV) ?? 'generic').trim().toLowerCase();
  if (raw === 'discord' || raw === 'ntfy' || raw === 'generic') return raw;
  return 'generic';
}

function configuredHeaders(): Record<string, string> | 'invalid' {
  const raw = readEnv(WEBHOOK_HEADERS_ENV)?.trim();
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'invalid';

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== 'string') return 'invalid';
      headers[key] = value;
    }
    return headers;
  } catch {
    return 'invalid';
  }
}

function readConfig(): FailureWebhookConfig | FailureNotificationResult {
  const url = readEnv(WEBHOOK_URL_ENV)?.trim();
  if (!url) return { sent: false, reason: 'not_configured' };

  const headers = configuredHeaders();
  if (headers === 'invalid') return { sent: false, reason: 'invalid_headers' };

  return { url, type: configuredType(), headers };
}

function truncate(value: string, length = 900): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}

function formatText(event: FailureNotificationEvent): string {
  const when = (event.triggeredAt ?? new Date()).toISOString();
  const duration = event.durationMs == null ? '' : ` in ${event.durationMs}ms`;
  const verb = event.status === 'SUCCESS' ? 'succeeded' : 'failed';
  return `Cronsole ${event.trigger} run ${verb}${duration}: ${event.task.name} (${event.task.platform}) at ${when}. ${event.message}`;
}

function eventPayload(event: FailureNotificationEvent) {
  return {
    taskId: event.task.id,
    userId: event.task.userId,
    taskName: event.task.name,
    platform: event.task.platform as PlatformType,
    externalId: event.task.externalId,
    trigger: event.trigger,
    status: event.status,
    message: event.message,
    durationMs: event.durationMs ?? null,
    executionId: event.executionId ?? null,
    triggeredAt: (event.triggeredAt ?? new Date()).toISOString()
  };
}

function requestFor(config: FailureWebhookConfig, event: FailureNotificationEvent): AxiosRequestConfig {
  const text = truncate(formatText(event));
  const baseHeaders = { ...config.headers };
  const isFailure = event.status !== 'SUCCESS';

  if (config.type === 'discord') {
    return {
      url: config.url,
      method: 'POST',
      timeout: DEFAULT_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json', ...baseHeaders },
      data: {
        content: text,
        embeds: [{
          title: isFailure ? 'Cronsole run failed' : 'Cronsole run succeeded',
          color: isFailure ? 0xdc2626 : 0x16a34a,
          fields: [
            { name: 'Task', value: event.task.name, inline: true },
            { name: 'Platform', value: String(event.task.platform), inline: true },
            { name: 'Trigger', value: event.trigger, inline: true }
          ],
          description: truncate(event.message, 500),
          timestamp: (event.triggeredAt ?? new Date()).toISOString()
        }]
      },
      validateStatus: (status) => status >= 200 && status < 300
    };
  }

  if (config.type === 'resend') {
    const subject = `Cronsole ${isFailure ? 'failure' : 'success'}: ${event.task.name}`;
    return {
      url: RESEND_ENDPOINT,
      method: 'POST',
      timeout: DEFAULT_TIMEOUT_MS,
      // The API key is a bearer token in `headers.Authorization` — the same
      // write-only `Extra headers` field every other type already uses, so
      // Resend needed no credential storage of its own.
      headers: { 'Content-Type': 'application/json', ...baseHeaders },
      data: {
        from: config.from || 'Cronsole <onboarding@resend.dev>',
        to: config.to,
        subject,
        text
      },
      validateStatus: (status) => status >= 200 && status < 300
    };
  }

  if (config.type === 'ntfy') {
    return {
      url: config.url,
      method: 'POST',
      timeout: DEFAULT_TIMEOUT_MS,
      headers: {
        Title: `Cronsole ${isFailure ? 'failed' : 'succeeded'}: ${event.task.name}`,
        Tags: isFailure ? 'warning' : 'white_check_mark',
        Priority: isFailure ? 'high' : 'default',
        ...baseHeaders
      },
      data: text,
      validateStatus: (status) => status >= 200 && status < 300
    };
  }

  return {
    url: config.url,
    method: 'POST',
    timeout: DEFAULT_TIMEOUT_MS,
    headers: { 'Content-Type': 'application/json', ...baseHeaders },
    data: {
      text,
      event: eventPayload(event)
    },
    validateStatus: (status) => status >= 200 && status < 300
  };
}

function safeFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function sendFailureNotification(
  event: FailureNotificationEvent
): Promise<FailureNotificationResult> {
  const config = readConfig();
  if ('sent' in config) {
    if (config.reason === 'invalid_headers') {
      console.warn(`[FailureNotification] ${WEBHOOK_HEADERS_ENV} must be a JSON object with string values`);
    }
    return config;
  }

  try {
    await axios.request(requestFor(config, event));
    return { sent: true };
  } catch (error) {
    console.warn(`[FailureNotification] delivery failed: ${safeFailureMessage(error)}`);
    return { sent: false, reason: 'delivery_failed' };
  }
}

/**
 * Fire-and-forget notification delivery for hot paths. Tests can call
 * `flushFailureNotifications()` to wait for queued work without making the run
 * route or scheduler depend on webhook latency.
 */
export function queueFailureNotification(event: FailureNotificationEvent): void {
  const pending = sendFailureNotification(event).finally(() => {
    pendingNotifications.delete(pending);
  });
  pendingNotifications.add(pending);
}

export async function flushFailureNotifications(): Promise<void> {
  await Promise.allSettled(Array.from(pendingNotifications));
}

/**
 * The path every run outcome — success or failure — should go through.
 *
 * A user's own `NotificationChannel` (off by default) takes over the moment
 * it is `enabled`, and it is the only path that ever sends a `SUCCESS` event
 * — the env webhook above has only ever spoken about failures, and stays
 * that way for a user who hasn't opted into anything of their own, so a
 * zero-config single-user install is unchanged.
 *
 * ponytail: one DB read (`userId` is the primary key) per run, including
 * every success once a channel exists — no caching yet. Add a short-lived
 * in-memory cache, invalidated on save, if that read shows up under load.
 */
export async function notifyRunOutcome(event: FailureNotificationEvent): Promise<FailureNotificationResult> {
  const channel = await getNotificationChannel(event.task.userId);

  if (channel?.enabled && channel.config) {
    const wants = event.status === 'SUCCESS' ? channel.notifyOnSuccess : channel.notifyOnFailure;
    if (!wants) return { sent: false, reason: 'not_configured' };

    try {
      await axios.request(requestFor(channel.config, event));
      return { sent: true };
    } catch (error) {
      console.warn(`[FailureNotification] delivery failed: ${safeFailureMessage(error)}`);
      return { sent: false, reason: 'delivery_failed' };
    }
  }

  // No channel of this user's own (or one that exists but is off) — the
  // legacy operator-wide env webhook, which never offered a SUCCESS event.
  if (event.status === 'SUCCESS') return { sent: false, reason: 'not_configured' };
  return sendFailureNotification(event);
}

/** `queueFailureNotification`'s twin for both outcomes — see `notifyRunOutcome`. */
export function queueRunNotification(event: FailureNotificationEvent): void {
  const pending = notifyRunOutcome(event).finally(() => {
    pendingNotifications.delete(pending);
  });
  pendingNotifications.add(pending);
}

