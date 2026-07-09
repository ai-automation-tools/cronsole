import { describe, it, expect } from 'vitest';
import { serializeConfig, deserializeConfig } from '../connectionConfig.js';
import { encryptConfig } from '../encryption.js';

describe('connectionConfig (encryption at rest)', () => {
  it('round-trips a config object through serialize/deserialize', () => {
    const config = { apiKey: 'sk-secret', agentId: 'agent-1', pairingSecret: 'abc' };
    const stored = serializeConfig(config);

    // Stored form is an opaque encrypted string, not the plaintext object.
    expect(typeof stored).toBe('string');
    expect(stored).not.toContain('sk-secret');

    expect(deserializeConfig(stored)).toEqual(config);
  });

  it('serializes an empty config and reads it back as {}', () => {
    const stored = serializeConfig({});
    expect(typeof stored).toBe('string');
    expect(deserializeConfig(stored)).toEqual({});
  });

  it('reads legacy plaintext object rows unchanged (migration-free)', () => {
    const legacy = { apiKey: 'plaintext-key' };
    expect(deserializeConfig(legacy)).toEqual(legacy);
  });

  it('treats null/undefined as an empty config', () => {
    expect(deserializeConfig(null)).toEqual({});
    expect(deserializeConfig(undefined)).toEqual({});
  });

  it('rejects a tampered ciphertext (GCM auth failure surfaces)', () => {
    const stored = encryptConfig({ apiKey: 'sk-secret' });
    const [iv, tag, data] = stored.split(':');
    // Flip a byte in the ciphertext body — the auth tag must no longer validate.
    const tampered = `${iv}:${tag}:${data.slice(0, -2)}${data.endsWith('00') ? '11' : '00'}`;
    expect(() => deserializeConfig(tampered)).toThrow();
  });
});
