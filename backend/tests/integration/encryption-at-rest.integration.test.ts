import { describe, it, expect } from 'vitest';
import { PlatformType } from '@prisma/client';
import { prisma } from '../../src/db.js';
import { serializeConfig, deserializeConfig } from '../../src/auth/connectionConfig.js';
import { createUser } from './helpers.js';

// Verifies the P0 "encrypt PlatformConnection.config at rest" guarantee end-to-end
// against a real column: a config written through serializeConfig lands as
// AES-256-GCM ciphertext (never plaintext), round-trips back, rejects tampering,
// and still reads legacy plaintext rows.

const HEX_TRIPLE = /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/;

describe('PlatformConnection.config encryption at rest', () => {
  it('stores an encrypted string in the DB column, not plaintext', async () => {
    const { user } = await createUser('enc@example.com');
    const secret = 'super-secret-api-key-9f3a';

    await prisma.platformConnection.create({
      data: {
        userId: user.id,
        platform: PlatformType.CLAUDE_CODE,
        config: serializeConfig({ apiKey: secret, agentId: 'agent-x' }),
        isActive: true
      }
    });

    // Read the RAW column, bypassing the app helpers, to see what's on disk.
    const [row] = await prisma.$queryRaw<Array<{ config: unknown }>>`
      SELECT config FROM "PlatformConnection" WHERE "userId" = ${user.id}
    `;
    const stored = row.config;

    expect(typeof stored).toBe('string');
    expect(stored as string).toMatch(HEX_TRIPLE);
    // The plaintext secret must not appear anywhere in the stored value.
    expect(stored as string).not.toContain(secret);
    expect(stored as string).not.toContain('agent-x');
  });

  it('round-trips the config back to plaintext via deserializeConfig', async () => {
    const { user } = await createUser('enc2@example.com');
    const config = { apiKey: 'k-123', agentId: 'agent-y', nested: { pairing: 'p-456' } };

    await prisma.platformConnection.create({
      data: {
        userId: user.id,
        platform: PlatformType.CLAUDE_CODE,
        config: serializeConfig(config),
        isActive: true
      }
    });

    const conn = await prisma.platformConnection.findFirstOrThrow({ where: { userId: user.id } });
    expect(deserializeConfig(conn.config)).toEqual(config);
  });

  it('rejects a tampered ciphertext (GCM auth failure surfaces, not silent)', async () => {
    const { user } = await createUser('enc3@example.com');
    await prisma.platformConnection.create({
      data: {
        userId: user.id,
        platform: PlatformType.CLAUDE_CODE,
        config: serializeConfig({ apiKey: 'tamper-me' }),
        isActive: true
      }
    });

    const conn = await prisma.platformConnection.findFirstOrThrow({ where: { userId: user.id } });
    const stored = conn.config as string;
    // Flip the last ciphertext hex char.
    const tampered = stored.slice(0, -1) + (stored.slice(-1) === 'a' ? 'b' : 'a');

    expect(() => deserializeConfig(tampered)).toThrow();
  });

  it('still reads a legacy plaintext (object) row without a migration', async () => {
    const { user } = await createUser('legacy@example.com');
    // Simulate a pre-encryption row: config written as a raw JSON object.
    await prisma.platformConnection.create({
      data: {
        userId: user.id,
        platform: PlatformType.CLAUDE_CODE,
        config: { apiKey: 'legacy-plaintext' },
        isActive: true
      }
    });

    const conn = await prisma.platformConnection.findFirstOrThrow({ where: { userId: user.id } });
    expect(deserializeConfig(conn.config)).toEqual({ apiKey: 'legacy-plaintext' });
  });
});
