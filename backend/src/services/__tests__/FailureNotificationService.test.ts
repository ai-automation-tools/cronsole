import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import {
  flushFailureNotifications,
  queueFailureNotification,
  sendFailureNotification,
  type FailureNotificationEvent
} from '../FailureNotificationService.js';

vi.mock('axios', () => ({
  default: { request: vi.fn() }
}));

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
    delete process.env.TASKHUB_FAILURE_WEBHOOK_URL;
    delete process.env.TASKHUB_FAILURE_WEBHOOK_TYPE;
    delete process.env.TASKHUB_FAILURE_WEBHOOK_HEADERS_JSON;
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
    process.env.TASKHUB_FAILURE_WEBHOOK_URL = 'https://hooks.example.com/taskhub';
    process.env.TASKHUB_FAILURE_WEBHOOK_HEADERS_JSON = '{"Authorization":"Bearer secret"}';
    vi.mocked(axios.request).mockResolvedValue({ status: 204 });

    const result = await sendFailureNotification(event);

    expect(result).toEqual({ sent: true });
    expect(axios.request).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://hooks.example.com/taskhub',
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
    process.env.TASKHUB_FAILURE_WEBHOOK_URL = 'https://discord.example.com/webhook';
    process.env.TASKHUB_FAILURE_WEBHOOK_TYPE = 'discord';
    vi.mocked(axios.request).mockResolvedValue({ status: 204 });

    await sendFailureNotification({ ...event, trigger: 'manual' });

    expect(axios.request).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        content: expect.stringContaining('manual run failed'),
        embeds: [expect.objectContaining({
          title: 'TaskHub run failed',
          color: 0xdc2626,
          description: expect.stringContaining('503')
        })]
      })
    }));
  });

  it('formats ntfy payloads', async () => {
    process.env.TASKHUB_FAILURE_WEBHOOK_URL = 'https://ntfy.example.com/taskhub';
    process.env.TASKHUB_FAILURE_WEBHOOK_TYPE = 'ntfy';
    vi.mocked(axios.request).mockResolvedValue({ status: 200 });

    await sendFailureNotification(event);

    expect(axios.request).toHaveBeenCalledWith(expect.objectContaining({
      headers: expect.objectContaining({
        Title: 'TaskHub failed: Nightly backup',
        Tags: 'warning',
        Priority: 'high'
      }),
      data: expect.stringContaining('Nightly backup')
    }));
  });

  it('returns invalid_headers without sending when header JSON is malformed', async () => {
    process.env.TASKHUB_FAILURE_WEBHOOK_URL = 'https://hooks.example.com/taskhub';
    process.env.TASKHUB_FAILURE_WEBHOOK_HEADERS_JSON = '{"Authorization":123}';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await sendFailureNotification(event);

    expect(result).toEqual({ sent: false, reason: 'invalid_headers' });
    expect(axios.request).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('TASKHUB_FAILURE_WEBHOOK_HEADERS_JSON'));
    warn.mockRestore();
  });

  it('swallows delivery failures and keeps queue flushing observable for tests', async () => {
    process.env.TASKHUB_FAILURE_WEBHOOK_URL = 'https://hooks.example.com/taskhub';
    vi.mocked(axios.request).mockRejectedValue(new Error('ECONNREFUSED'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    queueFailureNotification(event);
    await flushFailureNotifications();

    expect(axios.request).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('delivery failed'));
    warn.mockRestore();
  });
});

