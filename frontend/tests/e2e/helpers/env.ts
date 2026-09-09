import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(process.cwd(), '..');

function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};

  return Object.fromEntries(
    fs
      .readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const eq = line.indexOf('=');
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        return [key, value];
      })
  );
}

function readEnvValue(name: string): string | undefined {
  if (process.env[name]) return process.env[name];

  const files = [
    path.join(process.cwd(), '.env.local'),
    path.join(process.cwd(), '.env'),
    path.join(repoRoot, '.env'),
    path.join(repoRoot, 'backend', '.env')
  ];

  for (const file of files) {
    const value = parseEnvFile(file)[name];
    if (value) return value;
  }

  return undefined;
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signDevJwt(secret: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    id: 'cli_user_placeholder',
    email: 'mike@example.com',
    iat: now,
    exp: now + 24 * 60 * 60
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = crypto.createHmac('sha256', secret).update(unsigned).digest();
  return `${unsigned}.${base64url(signature)}`;
}

export function backendOrigin(): string {
  return readEnvValue('PLAYWRIGHT_API_URL') ?? readEnvValue('VITE_API_URL') ?? 'http://localhost:3000';
}

export function agentPairingSecret(): string {
  return readEnvValue('AGENT_PAIRING_SECRET') ?? 'dev-pairing-secret-change-me';
}

export function devToken(): string {
  const token = readEnvValue('VITE_DEV_TOKEN');
  if (token) return token;

  const jwtSecret =
    readEnvValue('JWT_SECRET') ?? 'dev-jwt-secret-change-in-production';
  return signDevJwt(jwtSecret);
}

