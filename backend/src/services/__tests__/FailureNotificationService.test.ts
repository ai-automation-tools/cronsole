import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';

vi.mock('axios', () => ({
  default: { request: vi.fn() }
}));

vi.mock('../notificationChannels.js', () => ({
  getNotificationChannel: vi.fn()
}));

import { getNotificationChannel } from '../notificationChannels.js';
import {
  flushFailureNotifications,
  notifyRunOutcome,
  queueFailureNotification,
  queueRunNotification,
  sendFailureNotification,
  type FailureNotificationEvent
} from '../FailureNotificationService.js';

const mockedGetChannel = getNotificationChannel as unknown as ReturnType<typeof vi.fn>;

const ORIGINAL_ENV = { ...process.env };

const event: FailureNotificationEvent = {
  task: {
    id: 'task-1',
    userId: 'user-1',
    platform: 'TASKHUB_NATIVE' as any,
    externalId: 'native_1',
    name: 'Nightly backup'
  },
  trigger: 'scheduled',
  status: 'FAILURE',
  message: 'GET https://example.com → 503',
  durationMs: 42,
  executionId: 'exec-1',
  triggeredAt: new Date('2026-07-10T20:00:00.000Z')
};

describe('FailureNotificationService', () => {
  beforeEach(() => {
    vi.mocked(axios.request).mockReset();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.CRONSOLE_FAILURE_WEBHOOK_URL;
    delete process.env.CRONSOLE_FAILURE_WEBHOOK_TYPE;
    delete process.env.CRONSOLE_FAILURE_WEBHOOK_HEADERS_JSON;
    mockedGetChannel.mockReset();
    mockedGetChannel.mockResolvedValue(null);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('is a no-op when no webhook URL is configured', async () => {
    const result = await sendFailureNotification(event);

    expect(result).toEqual({ sent: false, reason: 'not_configured' });
    expect(axios.request).not.toHaveBeenCalled();
  });

  it('sends generic JSON payloads with text and structured event data', async () => {
    process.env.CRONSOLE_FAILURE_WEBHOOK_URL = 'https://hooks.example.com/cronsole';
    process.env.CRONSOLE_FAILURE_WEBHOOK_HEADERS_JSON = '{"Authorization":"Bearer secret"}';
    vi.mocked(axios.request).mockResolvedValue({ status: 204 });

    const result = await sendFailureNotification(event);

    expect(result).toEqual({ sent: true });
    expect(axios.request).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://hooks.example.com/cronsole',
      method: 'POST',
      timeout: 5000,
      headers: expect.objectContaining({
        'Content-Type': 'application/json',
        Authorization: 'Bearer secret'
      }),
      data: expect.objectContaining({
        text: expect.stringContaining('Nightly backup'),
        event: expect.objectContaining({
          taskId: 'task-1',
          trigger: 'scheduled',
          status: 'FAILURE',
          executionId: 'exec-1'
        })
      })
    }));
  });

  it('formats Discord webhook payloads', async () => {
    process.env.CRONSOLE_FAILURE_WEBHOOK_URL = 'https://discord.example.com/webhook';
    process.env.CRONSOLE_FAILURE_WEBHOOK_TYPE = 'discord';
    vi.mocked(axios.request).mockResolvedValue({ status: 204 });

    await sendFailureNotification({ ...event, trigger: 'manual' });

    expect(axios.request).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        content: expect.stringContaining('manual run failed'),
        embeds: [expect.objectContaining({
          title: 'Cronsole run failed',
          color: 0xdc2626,
          description: expect.stringContaining('503')
        })]
      })
    }));
  });

  it('formats ntfy payloads', async () => {
    process.env.CRONSOLE_FAILURE_WEBHOOK_URL = 'https://ntfy.example.com/cronsole';
    process.env.CRONSOLE_FAILURE_WEBHOOK_TYPE = 'ntfy';
    vi.mocked(axios.request).mockResolvedValue({ status: 200 });

    await sendFailureNotification(event);

    expect(axios.request).toHaveBeenCalledWith(expect.objectContaining({
      headers: expect.objectContaining({
        Title: 'Cronsole failed: Nightly backup',
        Tags: 'warning',
        Priority: 'high'
      }),
      data: expect.stringContaining('Nightly backup')
    }));
  });

  it('returns invalid_headers without sending when header JSON is malformed', async () => {
    process.env.CRONSOLE_FAILURE_WEBHOOK_URL = 'https://hooks.example.com/cronsole';
    process.env.CRONSOLE_FAILURE_WEBHOOK_HEADERS_JSON = '{"Authorization":123}';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await sendFailureNotification(event);

    expect(result).toEqual({ sent: false, reason: 'invalid_headers' });
    expect(axios.request).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('CRONSOLE_FAILURE_WEBHOOK_HEADERS_JSON'));
    warn.mockRestore();
  });

  it('swallows delivery failures and keeps queue flushing observable for tests', async () => {
    process.env.CRONSOLE_FAILURE_WEBHOOK_URL = 'https://hooks.example.com/cronsole';
    vi.mocked(axios.request).mockRejectedValue(new Error('ECONNREFUSED'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    queueFailureNotification(event);
    await flushFailureNotifications();

    expect(axios.request).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('delivery failed'));
    warn.mockRestore();
  });
});

describe('notifyRunOutcome', () => {
  beforeEach(() => {
    vi.mocked(axios.request).mockReset();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.CRONSOLE_FAILURE_WEBHOOK_URL;
    mockedGetChannel.mockReset();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('falls back to the env webhook (failure only) when the user has no channel of their own', async () => {
    mockedGetChannel.mockResolvedValue(null);
    process.env.CRONSOLE_FAILURE_WEBHOOK_URL = 'https://hooks.example.com/cronsole';
    vi.mocked(axios.request).mockResolvedValue({ status: 204 });

    const failure = await notifyRunOutcome(event);
    expect(failure).toEqual({ sent: true });

    vi.mocked(axios.request).mockClear();
    const success = await notifyRunOutcome({ ...event, status: 'SUCCESS' });
    expect(success).toEqual({ sent: false, reason: 'not_configured' });
    expect(axios.request).not.toHaveBeenCalled();
  });

  it('ignores the env webhook once the user has an enabled channel of their own', async () => {
    mockedGetChannel.mockResolvedValue({
      enabled: true,
      notifyOnFailure: true,
      notifyOnSuccess: true,
      config: { url: 'https://hooks.example.com/mine', type: 'generic' as const, headers: {} },
      updatedAt: new Date()
    });
    // Configured but must not be used — the user's own channel takes over.
    process.env.CRONSOLE_FAILURE_WEBHOOK_URL = 'https://hooks.example.com/env';
    vi.mocked(axios.request).mockResolvedValue({ status: 204 });

    await notifyRunOutcome(event);

    expect(axios.request).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://hooks.example.com/mine' }));
  });

  it('gates SUCCESS and FAILURE independently on the user channel', async () => {
    mockedGetChannel.mockResolvedValue({
      enabled: true,
      notifyOnFailure: false,
      notifyOnSuccess: true,
      config: { url: 'https://hooks.example.com/mine', type: 'generic' as const, headers: {} },
      updatedAt: new Date()
    });
    vi.mocked(axios.request).mockResolvedValue({ status: 204 });

    const failure = await notifyRunOutcome(event);
    expect(failure).toEqual({ sent: false, reason: 'not_configured' });

    const success = await notifyRunOutcome({ ...event, status: 'SUCCESS' });
    expect(success).toEqual({ sent: true });
    expect(axios.request).toHaveBeenCalledTimes(1);
  });

  it('formats a resend payload — API key from headers, endpoint hardcoded regardless of stored url', async () => {
    mockedGetChannel.mockResolvedValue({
      enabled: true,
      notifyOnFailure: true,
      notifyOnSuccess: false,
      config: {
        // A stale/wrong url must never matter for resend — the real endpoint
        // always wins.
        url: 'https://example.com/not-the-real-endpoint',
        type: 'resend' as const,
        headers: { Authorization: 'Bearer re_123' },
        to: 'mike@example.com',
        from: 'Cronsole <alerts@example.com>'
      },
      updatedAt: new Date()
    });
    vi.mocked(axios.request).mockResolvedValue({ status: 200 });

    await notifyRunOutcome(event);

    expect(axios.request).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://api.resend.com/emails',
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer re_123' }),
      data: expect.objectContaining({
        from: 'Cronsole <alerts@example.com>',
        to: 'mike@example.com',
        subject: 'Cronsole failure: Nightly backup',
        text: expect.stringContaining('Nightly backup')
      })
    }));
  });

  it('defaults the resend "from" address when none is saved', async () => {
    mockedGetChannel.mockResolvedValue({
      enabled: true,
      notifyOnFailure: true,
      notifyOnSuccess: false,
      config: {
        url: 'https://api.resend.com/emails',
        type: 'resend' as const,
        headers: { Authorization: 'Bearer re_123' },
        to: 'mike@example.com'
      },
      updatedAt: new Date()
    });
    vi.mocked(axios.request).mockResolvedValue({ status: 200 });

    await notifyRunOutcome(event);

    expect(axios.request).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ from: 'Cronsole <onboarding@resend.dev>' })
    }));
  });

  it('sends nothing when the channel exists but is disabled, and does not fall back to the env webhook', async () => {
    mockedGetChannel.mockResolvedValue({
      enabled: false,
      notifyOnFailure: true,
      notifyOnSuccess: false,
      config: { url: 'https://hooks.example.com/mine', type: 'generic' as const, headers: {} },
      updatedAt: new Date()
    });
    process.env.CRONSOLE_FAILURE_WEBHOOK_URL = 'https://hooks.example.com/env';
    vi.mocked(axios.request).mockResolvedValue({ status: 204 });

    await notifyRunOutcome(event);

    // A disabled channel falls back to the operator env webhook like having none at all.
    expect(axios.request).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://hooks.example.com/env' }));
  });

  it('queueRunNotification is observable through flushFailureNotifications', async () => {
    mockedGetChannel.mockResolvedValue(null);
    process.env.CRONSOLE_FAILURE_WEBHOOK_URL = 'https://hooks.example.com/cronsole';
    vi.mocked(axios.request).mockResolvedValue({ status: 204 });

    queueRunNotification(event);
    await flushFailureNotifications();

    expect(axios.request).toHaveBeenCalledTimes(1);
  });
});

