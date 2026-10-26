import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const artifacts = join(process.env.TEST_ARTIFACT_DIR ?? join(tmpdir(), 'nisar-calculation-tests'), 'stability');

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.stability.spec.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  failOnFlakyTests: true,
  workers: 3,
  timeout: 11 * 60_000,
  globalTimeout: 12 * 60_000,
  expect: { timeout: 15_000 },
  reporter: [
    ['list'],
    ['json', { outputFile: join(artifacts, 'report.json') }],
    ['junit', { outputFile: join(artifacts, 'junit.xml') }],
  ],
  outputDir: join(artifacts, 'results'),
  use: {
    baseURL: 'http://127.0.0.1:5181',
    viewport: { width: 1448, height: 1086 },
    actionTimeout: 15_000,
    navigationTimeout: 15_000,
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: ['chromium', 'firefox', 'webkit'].map((browserName) => ({
    name: `stability-${browserName}`,
    use: { browserName: browserName as 'chromium' | 'firefox' | 'webkit' },
  })),
  webServer: {
    command: 'npm run preview',
    url: 'http://127.0.0.1:5181',
    reuseExistingServer: false,
    timeout: 30_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
  },
});
