import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
    // Playwright E2E specs live in tests/e2e and run under their own runner.
    exclude: ['**/node_modules/**', '**/dist/**', '**/tests/e2e/**'],
  },
});
