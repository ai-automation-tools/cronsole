/**
 * First-run secrets. Imported by index.ts before anything that reads them.
 *
 * Cronsole used to boot from Docker Compose with three published default values, and
 * each of them passed the length checks: anyone who had read the repo could sign an
 * owner token or pair as the agent. So a secret that is missing, or is one of those
 * published values, is generated here and written to backend/.env, where the agent
 * setup script and the next boot both find it.
 *
 * ENCRYPTION_KEY is the exception, because replacing it makes stored credentials
 * unreadable. It is generated only while the database holds nothing encrypted. An
 * install that already has data under the published default keeps it for now, and
 * says so on every boot, until a re-encrypting rotation exists (ROADMAP, P0).
 *
 * Precedence per secret: the process environment, then backend/.env, then generated.
 * Compose passes these three through as empty strings when unset, and dotenv never
 * overrides a variable that is defined, so the file is read here directly as well.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';

/** The values docker-compose.yml shipped with until 2026-11-11. Public, so never valid. */
export const PUBLISHED_DEFAULTS: Record<SecretName, string> = {
  JWT_SECRET: 'dev-jwt-secret-change-in-production',
  ENCRYPTION_KEY: 'dev_encryption_key_32_chars_1234',
  AGENT_PAIRING_SECRET: 'dev-pairing-secret-change-me'
};

export type SecretName = 'JWT_SECRET' | 'ENCRYPTION_KEY' | 'AGENT_PAIRING_SECRET';
const NAMES: SecretName[] = ['JWT_SECRET', 'ENCRYPTION_KEY', 'AGENT_PAIRING_SECRET'];

export interface SecretPlan {
  /** Values to put in process.env for this run. */
  values: Partial<Record<SecretName, string>>;
  /** The subset of `values` that is new and must be written to backend/.env. */
  generated: SecretName[];
  /** True when existing data forces the published ENCRYPTION_KEY to stay in use. */
  legacyEncryptionKey: boolean;
}

const generate = (name: SecretName): string =>
  // ENCRYPTION_KEY must be exactly 32 characters (it is used as the AES-256 key).
  name === 'ENCRYPTION_KEY' ? randomBytes(24).toString('base64url') : randomBytes(32).toString('hex');

/**
 * Decide what each secret is for this run. Pure: `hasEncryptedData` is only called
 * when the answer depends on it.
 */
export async function planSecrets(
  env: Record<string, string | undefined>,
  file: Record<string, string>,
  hasEncryptedData: () => Promise<boolean>
): Promise<SecretPlan> {
  const plan: SecretPlan = { values: {}, generated: [], legacyEncryptionKey: false };
  for (const name of NAMES) {
    const current = env[name] || file[name] || '';
    const usable = current !== '' && current !== PUBLISHED_DEFAULTS[name];
    if (usable) {
      plan.values[name] = current;
      continue;
    }
    if (name === 'ENCRYPTION_KEY' && (await hasEncryptedData())) {
      // Data exists and no private key is configured: it was written under the
      // published default, which is the only key this install has ever had.
      plan.values[name] = PUBLISHED_DEFAULTS.ENCRYPTION_KEY;
      plan.legacyEncryptionKey = true;
      continue;
    }
    plan.values[name] = generate(name);
    plan.generated.push(name);
  }
  return plan;
}

/** Replace or append `NAME="value"` lines, leaving everything else in the file alone. */
export function upsertEnvLines(text: string, values: Partial<Record<SecretName, string>>): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text === '' ? [] : text.split(/\r?\n/);
  for (const [name, value] of Object.entries(values)) {
    const line = `${name}="${value}"`;
    const at = lines.findIndex(l => new RegExp(`^\\s*${name}\\s*=`).test(l));
    if (at >= 0) lines[at] = line;
    else {
      while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
      lines.push(line);
    }
  }
  return lines.join(eol) + eol;
}

// backend/.env, from src/config or dist/config alike.
const ENV_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.env');

async function ensureSecrets(): Promise<void> {
  const file = existsSync(ENV_FILE) ? dotenv.parse(readFileSync(ENV_FILE, 'utf8')) : {};
  const plan = await planSecrets(process.env, file, async () => {
    const { prisma } = await import('../db.js');
    return (await prisma.platformConnection.count()) > 0;
  });

  if (plan.generated.length > 0) {
    const written: Partial<Record<SecretName, string>> = {};
    for (const name of plan.generated) written[name] = plan.values[name]!;
    try {
      const before = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8') : '';
      writeFileSync(ENV_FILE, upsertEnvLines(before, written), { mode: 0o600 });
    } catch (err) {
      // A secret that lives only in memory changes on the next boot: sessions drop,
      // the agent stops pairing, and a generated ENCRYPTION_KEY loses stored credentials.
      throw new Error(
        `Could not write generated secrets (${plan.generated.join(', ')}) to ${ENV_FILE}: ` +
          `${err instanceof Error ? err.message : String(err)}. Set them yourself; see backend/.env.example.`
      );
    }
    console.log(`[secrets] Generated ${plan.generated.join(', ')} and wrote ${ENV_FILE}.`);
    if (plan.generated.includes('AGENT_PAIRING_SECRET')) {
      console.log(
        '[secrets] The Windows agent needs the new AGENT_PAIRING_SECRET: run agent\\setup-agent-startup.ps1, ' +
          'or copy the value into its appsettings.json.'
      );
    }
  }
  if (plan.legacyEncryptionKey) {
    console.warn(
      '[secrets] WARNING: stored credentials are encrypted with the ENCRYPTION_KEY that Cronsole published in ' +
        'docker-compose.yml. It is kept because replacing it would make them unreadable. Anyone holding a copy ' +
        'of the database can decrypt them.'
    );
  }
  for (const name of NAMES) process.env[name] = plan.values[name];
}

// Tests set their own environment and must not touch a real backend/.env.
if (process.env.NODE_ENV !== 'test') await ensureSecrets();
