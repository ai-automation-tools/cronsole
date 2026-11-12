/**
 * Move every stored credential to a new ENCRYPTION_KEY.
 *
 *   cd backend
 *   npm run rotate-key -- --dry-run     # read everything with the current key, change nothing
 *   npm run rotate-key                  # stop the backend first: cronsole down
 *
 * Why it exists: an install that stored credentials before 2026-11-11 may still be
 * on the key Cronsole used to publish in docker-compose.yml, and until now nothing
 * could move it off. It is also what you run after a key may have leaked.
 *
 * Order of operations, chosen so that no failure leaves data without its key:
 *   1. the new key is written to backend/.env as ENCRYPTION_KEY_NEXT
 *   2. every row is re-encrypted in ONE transaction
 *   3. ENCRYPTION_KEY becomes the new key and ENCRYPTION_KEY_NEXT is removed
 * Run again after an interruption and it finishes whichever step is left.
 *
 * It never prints a key.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// The override exists for the end-to-end check of this script against a scratch database.
const ENV_FILE = process.env.CRONSOLE_ROTATE_ENV_FILE ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
const dryRun = process.argv.includes('--dry-run');
const fail = (message: string): never => {
  console.error(`\n  ${message}\n`);
  process.exit(1);
};

const readEnvFile = () => (existsSync(ENV_FILE) ? dotenv.parse(readFileSync(ENV_FILE, 'utf8')) : {});
/** Set (string) or remove (null) NAME="value" lines, leaving the rest of the file alone. */
function editEnvFile(changes: Record<string, string | null>): void {
  const text = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8') : '';
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  let lines = text === '' ? [] : text.split(/\r?\n/);
  for (const [name, value] of Object.entries(changes)) {
    const isLine = (l: string) => new RegExp(`^\\s*${name}\\s*=`).test(l);
    if (value === null) lines = lines.filter(l => !isLine(l));
    else if (lines.some(isLine)) lines = lines.map(l => (isLine(l) ? `${name}="${value}"` : l));
    else {
      while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
      lines.push(`${name}="${value}"`);
    }
  }
  writeFileSync(ENV_FILE, lines.join(eol).replace(/(\r?\n)*$/, '') + eol, { mode: 0o600 });
}

// A key that comes from the real environment (Compose, a service definition) is not
// this script's to replace: it could re-encrypt the data but not change what the
// backend is started with.
const fromEnvironment = process.env.ENCRYPTION_KEY;
const fileKey = readEnvFile().ENCRYPTION_KEY;
if (!dryRun && fromEnvironment && fromEnvironment !== fileKey) {
  fail('ENCRYPTION_KEY is set in the environment, not in backend/.env, so this script cannot ' +
    'replace it. Unset it here, or rotate where that environment is defined.');
}

// Resolves the key exactly as the backend does at boot (config/secrets.ts).
await import('../src/config/secrets.js');
const { PUBLISHED_DEFAULTS } = await import('../src/config/secrets.js');
const { reencryptAll, keyReadsAll } = await import('../src/auth/keyRotation.js');
const { prisma } = await import('../src/db.js');
type Row = import('../src/auth/keyRotation.js').StoredCiphertext;

const currentKey = process.env.ENCRYPTION_KEY!;

async function loadRows(): Promise<Row[]> {
  const [connections, channels, secrets] = await Promise.all([
    prisma.platformConnection.findMany({ select: { id: true, config: true } }),
    prisma.notificationChannel.findMany({ select: { userId: true, config: true } }),
    prisma.taskSecret.findMany({ select: { taskId: true, data: true } })
  ]);
  return [
    // A non-string config is a pre-encryption plaintext row; there is nothing to rotate in it.
    ...connections.filter(c => typeof c.config === 'string')
      .map(c => ({ store: 'PlatformConnection' as const, id: c.id, value: c.config as string })),
    ...channels.filter(c => c.config)
      .map(c => ({ store: 'NotificationChannel' as const, id: c.userId, value: c.config as string })),
    ...secrets.map(s => ({ store: 'TaskSecret' as const, id: s.taskId, value: s.data }))
  ];
}

async function backendIsRunning(): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

const rows = await loadRows();
const count = (store: Row['store']) => rows.filter(r => r.store === store).length;
console.log(`\n  Stored credentials: ${count('PlatformConnection')} source connection(s), ` +
  `${count('NotificationChannel')} notification channel(s), ${count('TaskSecret')} task secret store(s).`);
console.log(`  Current key: ${currentKey === PUBLISHED_DEFAULTS.ENCRYPTION_KEY
  ? 'the one Cronsole used to publish. Anyone with a copy of the database can read these.'
  : 'private to this install.'}`);

const pending = readEnvFile().ENCRYPTION_KEY_NEXT;

if (dryRun) {
  const ok = keyReadsAll(rows, currentKey);
  console.log(ok
    ? '  The current key reads every one of them. Nothing was changed.\n'
    : pending && keyReadsAll(rows, pending)
      ? '  An interrupted rotation is waiting: the data is already under the new key. Run without --dry-run to finish.\n'
      : '  The current key CANNOT read all of them. Do not rotate; see troubleshooting #93.\n');
  await prisma.$disconnect();
  process.exit(ok ? 0 : 1);
}

if (await backendIsRunning()) {
  fail('The backend is running. It holds the current key in memory and would keep writing with it. ' +
    'Stop it first (cronsole down), run this again, then start it (cronsole up).');
}

let newKey: string;
if (pending && !keyReadsAll(rows, currentKey)) {
  // Interrupted after the transaction, before the swap.
  if (!keyReadsAll(rows, pending)) fail('Neither ENCRYPTION_KEY nor ENCRYPTION_KEY_NEXT reads the stored data. Nothing was changed.');
  newKey = pending;
  console.log('  Finishing an interrupted rotation: the data is already under the new key.');
} else {
  // 32 characters exactly: the value is used as the AES-256 key as it stands.
  newKey = pending && pending.length === 32 ? pending : randomBytes(24).toString('base64url');
  const next = reencryptAll(rows, currentKey, newKey);
  editEnvFile({ ENCRYPTION_KEY_NEXT: newKey });
  await prisma.$transaction(next.map(row =>
    row.store === 'PlatformConnection'
      ? prisma.platformConnection.update({ where: { id: row.id }, data: { config: row.value } })
      : row.store === 'NotificationChannel'
        ? prisma.notificationChannel.update({ where: { userId: row.id }, data: { config: row.value } })
        : prisma.taskSecret.update({ where: { taskId: row.id }, data: { data: row.value } })
  ));
  console.log(`  Re-encrypted ${next.length} stored value(s).`);
}

editEnvFile({ ENCRYPTION_KEY: newKey, ENCRYPTION_KEY_NEXT: null });
if (!keyReadsAll(await loadRows(), newKey)) fail('The new key does not read the stored data after the swap. Check backend/.env.');

console.log(`  ${ENV_FILE} now holds the new ENCRYPTION_KEY.`);
console.log('  A database backup made before this moment needs the OLD key to be read. Take a new backup,');
console.log('  and record the new key somewhere that survives this disk. Then start the backend: cronsole up\n');
await prisma.$disconnect();
