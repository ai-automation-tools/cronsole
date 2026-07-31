import axios, { AxiosRequestConfig } from 'axios';
import type { ExecutionStatus, PlatformType, Task } from '@prisma/client';

export type FailureNotificationTrigger = 'manual' | 'scheduled';
export type FailureWebhookType = 'generic' | 'discord' | 'ntfy';

export interface FailureNotificationEvent {
  task: Pick<Task, 'id' | 'userId' | 'platform' | 'externalId' | 'name'>;
  trigger: FailureNotificationTrigger;
  status: Extract<ExecutionStatus, 'FAILURE' | 'TIMEOUT'>;
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
}

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
  return `Cronsole ${event.trigger} run failed${duration}: ${event.task.name} (${event.task.platform}) at ${when}. ${event.message}`;
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

  if (config.type === 'discord') {
    return {
      url: config.url,
      method: 'POST',
      timeout: DEFAULT_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json', ...baseHeaders },
      data: {
        content: text,
        embeds: [{
          title: 'Cronsole run failed',
          color: 0xdc2626,
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

  if (config.type === 'ntfy') {
    return {
      url: config.url,
      method: 'POST',
      timeout: DEFAULT_TIMEOUT_MS,
      headers: {
        Title: `Cronsole failed: ${event.task.name}`,
        Tags: 'warning',
        Priority: 'high',
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

