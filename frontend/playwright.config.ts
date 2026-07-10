import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E config. Tests drive a real browser against the running TaskHub
 * dev stack (frontend + backend + Postgres), so bring it up first:
 *   pwsh scripts/taskhub.ps1 up
 * Point elsewhere with PLAYWRIGHT_BASE_URL (e.g. a staging host).
 *
 * These are separate from the Vitest component tests (which are excluded from
 * this testDir and vice-versa) — different runner, different purpose.
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: './tests/e2e',
  // Fail the run if a stray `test.only` is committed.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL,
    // Capture evidence only when something fails, so green runs stay cheap.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
});
