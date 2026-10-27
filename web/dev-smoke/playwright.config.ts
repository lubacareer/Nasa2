import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'preview.spec.ts',
  retries: 0,
  timeout: 30_000,
  use: { browserName: 'chromium', baseURL: 'http://127.0.0.1:5182' },
  webServer: {
    cwd: '..',
    command: 'npx vite --host 127.0.0.1 --port 5182 --strictPort',
    url: 'http://127.0.0.1:5182',
    reuseExistingServer: false,
    timeout: 30_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
  },
});
