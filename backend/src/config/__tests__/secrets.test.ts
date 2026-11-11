import { describe, it, expect, vi } from 'vitest';
import { planSecrets, upsertEnvLines, PUBLISHED_DEFAULTS } from '../secrets.js';

const noData = async () => false;
const hasData = async () => true;

describe('planSecrets', () => {
  it('keeps private values and never asks the database', async () => {
    const env = { JWT_SECRET: 'a-private-jwt-secret', ENCRYPTION_KEY: 'k'.repeat(32), AGENT_PAIRING_SECRET: 'a-private-pairing' };
    const probe = vi.fn(noData);
    const plan = await planSecrets(env, {}, probe);
    expect(plan.generated).toEqual([]);
    expect(plan.values).toEqual(env);
    expect(probe).not.toHaveBeenCalled();
  });

  it('generates all three on a fresh install, with a 32-character encryption key', async () => {
    const plan = await planSecrets({ JWT_SECRET: '' }, {}, noData);
    expect(plan.generated).toEqual(['JWT_SECRET', 'ENCRYPTION_KEY', 'AGENT_PAIRING_SECRET']);
    expect(plan.values.ENCRYPTION_KEY).toHaveLength(32);
    expect(plan.values.JWT_SECRET!.length).toBeGreaterThanOrEqual(32);
    expect(plan.values.JWT_SECRET).not.toBe(plan.values.AGENT_PAIRING_SECRET);
  });

  it('replaces a published default, and reads backend/.env when the environment is empty', async () => {
    const plan = await planSecrets(
      { JWT_SECRET: PUBLISHED_DEFAULTS.JWT_SECRET, AGENT_PAIRING_SECRET: '' },
      { AGENT_PAIRING_SECRET: 'from-the-env-file', ENCRYPTION_KEY: 'f'.repeat(32) },
      noData
    );
    expect(plan.generated).toEqual(['JWT_SECRET']);
    expect(plan.values.JWT_SECRET).not.toBe(PUBLISHED_DEFAULTS.JWT_SECRET);
    expect(plan.values.AGENT_PAIRING_SECRET).toBe('from-the-env-file');
    expect(plan.values.ENCRYPTION_KEY).toBe('f'.repeat(32));
  });

  it('keeps the published encryption key when data already exists under it, and says so', async () => {
    for (const current of ['', PUBLISHED_DEFAULTS.ENCRYPTION_KEY]) {
      const plan = await planSecrets({ ENCRYPTION_KEY: current }, {}, hasData);
      expect(plan.values.ENCRYPTION_KEY).toBe(PUBLISHED_DEFAULTS.ENCRYPTION_KEY);
      expect(plan.legacyEncryptionKey).toBe(true);
      expect(plan.generated).not.toContain('ENCRYPTION_KEY');
    }
  });
});

describe('upsertEnvLines', () => {
  it('replaces an existing line, appends a missing one, and leaves the rest alone', () => {
    const before = '# comment\r\nPORT=3000\r\nJWT_SECRET=""\r\n';
    const after = upsertEnvLines(before, { JWT_SECRET: 'new', ENCRYPTION_KEY: 'key' });
    expect(after).toBe('# comment\r\nPORT=3000\r\nJWT_SECRET="new"\r\nENCRYPTION_KEY="key"\r\n');
    expect(upsertEnvLines('', { JWT_SECRET: 'x' })).toBe('JWT_SECRET="x"\n');
  });
});
