import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  /*
   * `docsLinks.test.ts` imports the repo's markdown guides with `?raw` to check
   * that every in-app help link still points at a heading that exists. Those
   * files live above this project, and Vite's dev-server sandbox denies them by
   * default.
   *
   * Widened **here rather than in `vite.config.ts`** on purpose: this config is
   * the test runner's alone, so the running dev server keeps its default
   * sandbox and gains no ability to serve anything outside `frontend/`.
   */
  server: {
    fs: { allow: ['..'] }
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
    // Playwright E2E specs live in tests/e2e and run under their own runner.
    exclude: ['**/node_modules/**', '**/dist/**', '**/tests/e2e/**'],
  },
});
