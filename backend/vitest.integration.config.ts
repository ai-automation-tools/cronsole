import { defineConfig } from 'vitest/config';

// Default points at a dedicated `taskhub_test` database on the dev Postgres so a
// local run works out of the box; override with TEST_DATABASE_URL (CI sets its
// own). The integration suite creates + migrates this DB in globalSetup and
// truncates it between tests — never point it at a database you care about.
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://taskhub:password@localhost:5432/taskhub_test';

export default defineConfig({
  test: {
    include: ['test/integration/**/*.integration.test.ts'],
    environment: 'node',
    globalSetup: ['./test/integration/globalSetup.ts'],
    setupFiles: ['./test/integration/setupEach.ts'],
    // One shared database → run serially in a single worker, never in parallel.
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 20000,
    hookTimeout: 60000,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      // The app's fail-fast config guards need these present; integration-safe
      // fixed values (ENCRYPTION_KEY must be exactly 32 chars).
      JWT_SECRET: process.env.JWT_SECRET ?? 'integration-test-jwt-secret-value',
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ?? '0123456789abcdef0123456789abcdef',
      AGENT_PAIRING_SECRET:
        process.env.AGENT_PAIRING_SECRET ?? 'integration-test-pairing-secret'
    }
  }
});
