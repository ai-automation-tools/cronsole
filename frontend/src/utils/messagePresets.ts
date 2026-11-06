import type { NativeJobValues } from './taskEditing';

/**
 * "Send a message" — a starting point for an HTTP job, not a job type
 * (ADR 0002 deferred `NOTIFY` because it is a configuration of `HTTP`; ADR 0003's
 * secrets removed the reason to wait). Each preset fills the URL, method,
 * headers and body, and puts the webhook address behind a `${secret.…}`,
 * because for Discord and Slack the URL *is* the credential.
 */
export interface MessagePreset {
  id: 'discord' | 'slack' | 'ntfy' | 'webhook';
  label: string;
  /** The secret the URL refers to — named so the Secrets section can ask for it. */
  secret: string;
  url: string;
  headers: string;
  body: string;
}

const MESSAGE = 'Hello from Cronsole';

export const MESSAGE_PRESETS: MessagePreset[] = [
  {
    id: 'discord',
    label: 'Discord',
    secret: 'DISCORD_WEBHOOK_URL',
    url: '${secret.DISCORD_WEBHOOK_URL}',
    headers: 'Content-Type: application/json',
    body: JSON.stringify({ content: MESSAGE }, null, 2)
  },
  {
    id: 'slack',
    label: 'Slack',
    secret: 'SLACK_WEBHOOK_URL',
    url: '${secret.SLACK_WEBHOOK_URL}',
    headers: 'Content-Type: application/json',
    body: JSON.stringify({ text: MESSAGE }, null, 2)
  },
  {
    // A topic name is the only thing guarding an ntfy.sh topic, so it is the secret.
    id: 'ntfy',
    label: 'ntfy',
    secret: 'NTFY_TOPIC',
    url: 'https://ntfy.sh/${secret.NTFY_TOPIC}',
    headers: 'Title: Cronsole\nContent-Type: text/plain',
    body: MESSAGE
  },
  {
    id: 'webhook',
    label: 'Other webhook',
    secret: 'WEBHOOK_URL',
    url: '${secret.WEBHOOK_URL}',
    headers: 'Content-Type: application/json',
    body: JSON.stringify({ message: MESSAGE }, null, 2)
  }
];

/** Fill an HTTP job from a preset. Everything else on the form is kept. */
export const applyMessagePreset = (v: NativeJobValues, preset: MessagePreset): NativeJobValues => ({
  ...v,
  jobType: 'HTTP',
  url: preset.url,
  method: 'POST',
  headers: preset.headers,
  body: preset.body
});
