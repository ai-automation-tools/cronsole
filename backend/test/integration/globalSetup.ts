import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

// Must match the default in vitest.integration.config.ts.
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://taskhub:password@localhost:5432/taskhub_test';

/**
 * Runs once before the integration suite: ensure the dedicated test database
 * exists, then apply the Prisma schema to it. Both steps are idempotent, so
 * re-running the suite is safe.
 */
export default async function setup() {
  const dbName = new URL(TEST_DATABASE_URL).pathname.replace(/^\//, '');

  // CREATE DATABASE can't run against the target DB itself; connect to the
  // always-present `postgres` maintenance database to create it if absent.
  const adminUrl = new URL(TEST_DATABASE_URL);
  adminUrl.pathname = '/postgres';
  const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
    console.log(`[integration] created database ${dbName}`);
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    if (!msg.includes('already exists')) throw err;
  } finally {
    await admin.$disconnect();
  }

  // Apply migrations to the test DB (idempotent).
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'inherit'
  });
}
