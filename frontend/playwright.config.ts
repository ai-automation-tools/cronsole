import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E config. Tests drive a real browser against the running Cronsole
 * dev stack (frontend + backend + Postgres), so bring it up first:
 *   pwsh scripts/cronsole.ps1 up
 * Point elsewhere with PLAYWRIGHT_BASE_URL (e.g. a staging host).
 *
 * These are separate from the Vitest component tests (which are excluded from
 * this testDir and vice-versa) — different runner, different purpose.
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:7373';

export default defineConfig({
  testDir: './tests/e2e',
  expect: {
    toHaveScreenshot: {
      /**
       * A few pixels of tolerance, because the default is zero and GPU text
       * antialiasing is not deterministic — the visual baselines were failing on
       * a **single** differing pixel, run to run, with nothing changed.
       *
       * 40 is chosen to be far above that noise and far below any regression
       * this suite exists to catch: the smallest real one is a one-pixel spacing
       * change, which shifts a whole row of glyphs and differs in the hundreds
       * or thousands of pixels. A threshold that can hide a layout change would
       * be worse than no threshold; this one cannot reach a single character.
       */
      maxDiffPixels: 40
    }
  },
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
