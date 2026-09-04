import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `NotificationChannel.config` round-trips through the same AES-256-GCM
 * envelope as `PlatformConnection.config` — this pins the encrypt-on-write /
 * decrypt-on-read contract and the `redactChannel` shape (`hasHeaders`,
 * never the header values themselves — the `redactPreset` rule one layer up,
 * services/geminiTriggers.ts).
 */

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? '01234567890123456789012345678901';

vi.mock('../../db.js', () => ({
  prisma: {
    notificationChannel: { findUnique: vi.fn(), upsert: vi.fn() }
  }
}));

import { prisma } from '../../db.js';
import { getNotificationChannel, redactChannel, saveNotificationChannel } from '../notificationChannels.js';

const findUnique = prisma.notificationChannel.findUnique as unknown as ReturnType<typeof vi.fn>;
const upsert = prisma.notificationChannel.upsert as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  findUnique.mockReset();
  upsert.mockReset();
});

describe('notificationChannels', () => {
  it('redacts an unconfigured channel to off, no url, no headers', () => {
    expect(redactChannel(null)).toEqual({
      enabled: false,
      notifyOnFailure: true,
      notifyOnSuccess: false,
      url: null,
      type: null,
      hasHeaders: false,
      to: null,
      from: null,
      updatedAt: null
    });
  });

  it('saves a channel with headers encrypted, and reads it back decrypted', async () => {
    let stored: any = null;
    upsert.mockImplementation(async ({ create, update }: any) => {
      stored = { userId: 'u1', ...(stored ?? create), ...update, updatedAt: new Date('2026-09-01T00:00:00Z') };
      return stored;
    });
    findUnique.mockImplementation(async () => stored);

    const saved = await saveNotificationChannel('u1', {
      enabled: true,
      notifyOnFailure: true,
      notifyOnSuccess: true,
      url: 'https://hooks.example.com/cronsole',
      type: 'discord',
      headers: { Authorization: 'Bearer secret' }
    });

    expect(saved.config).toEqual({
      url: 'https://hooks.example.com/cronsole',
      type: 'discord',
      headers: { Authorization: 'Bearer secret' }
    });
    // The ciphertext, not the plaintext, is what actually lands in the column.
    expect(stored.config).not.toContain('secret');
    expect(stored.config).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);

    const read = await getNotificationChannel('u1');
    expect(read?.config).toEqual(saved.config);

    expect(redactChannel(read)).toEqual({
      enabled: true,
      notifyOnFailure: true,
      notifyOnSuccess: true,
      url: 'https://hooks.example.com/cronsole',
      type: 'discord',
      hasHeaders: true,
      to: null,
      from: null,
      updatedAt: stored.updatedAt
    });
  });

  it('keeps the stored headers when a later save omits them', async () => {
    let stored: any = null;
    upsert.mockImplementation(async ({ create, update }: any) => {
      stored = { userId: 'u1', ...(stored ?? create), ...update, updatedAt: new Date() };
      return stored;
    });
    findUnique.mockImplementation(async () => stored);

    await saveNotificationChannel('u1', {
      enabled: true,
      notifyOnFailure: true,
      notifyOnSuccess: false,
      url: 'https://hooks.example.com/cronsole',
      type: 'generic',
      headers: { Authorization: 'Bearer secret' }
    });

    // Fixing a typo'd URL — no headers in this call at all.
    const saved = await saveNotificationChannel('u1', {
      enabled: true,
      notifyOnFailure: true,
      notifyOnSuccess: false,
      url: 'https://hooks.example.com/cronsole-fixed',
      type: 'generic'
    });

    expect(saved.config).toEqual({
      url: 'https://hooks.example.com/cronsole-fixed',
      type: 'generic',
      headers: { Authorization: 'Bearer secret' }
    });
  });

  it('clears stored headers only when a save explicitly sends an empty object', async () => {
    let stored: any = null;
    upsert.mockImplementation(async ({ create, update }: any) => {
      stored = { userId: 'u1', ...(stored ?? create), ...update, updatedAt: new Date() };
      return stored;
    });
    findUnique.mockImplementation(async () => stored);

    await saveNotificationChannel('u1', {
      enabled: true,
      notifyOnFailure: true,
      notifyOnSuccess: false,
      url: 'https://hooks.example.com/cronsole',
      type: 'generic',
      headers: { Authorization: 'Bearer secret' }
    });

    const saved = await saveNotificationChannel('u1', {
      enabled: true,
      notifyOnFailure: true,
      notifyOnSuccess: false,
      url: 'https://hooks.example.com/cronsole',
      type: 'generic',
      headers: {}
    });

    expect(saved.config?.headers).toEqual({});
    expect(redactChannel(saved).hasHeaders).toBe(false);
  });

  it('round-trips a resend channel\'s "to" and "from" — neither is redacted, unlike headers', async () => {
    let stored: any = null;
    upsert.mockImplementation(async ({ create, update }: any) => {
      stored = { userId: 'u1', ...(stored ?? create), ...update, updatedAt: new Date() };
      return stored;
    });
    findUnique.mockImplementation(async () => stored);

    const saved = await saveNotificationChannel('u1', {
      enabled: true,
      notifyOnFailure: true,
      notifyOnSuccess: false,
      url: 'https://api.resend.com/emails',
      type: 'resend',
      headers: { Authorization: 'Bearer re_123' },
      to: 'mike@example.com',
      from: 'Cronsole <alerts@example.com>'
    });

    expect(saved.config).toEqual({
      url: 'https://api.resend.com/emails',
      type: 'resend',
      headers: { Authorization: 'Bearer re_123' },
      to: 'mike@example.com',
      from: 'Cronsole <alerts@example.com>'
    });

    expect(redactChannel(saved)).toEqual(expect.objectContaining({
      to: 'mike@example.com',
      from: 'Cronsole <alerts@example.com>',
      hasHeaders: true
    }));
  });

  it('stores no config when disabling with no url typed', async () => {
    upsert.mockImplementation(async ({ create }: any) => ({ userId: 'u1', ...create, updatedAt: new Date() }));

    const saved = await saveNotificationChannel('u1', {
      enabled: false,
      notifyOnFailure: true,
      notifyOnSuccess: false
    });

    expect(saved.config).toBeNull();
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ config: null })
    }));
  });
});
