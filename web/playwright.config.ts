import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const artifacts = join(process.env.TEST_ARTIFACT_DIR ?? join(tmpdir(), 'nisar-calculation-tests'), 'functional');

export default defineConfig({
  testDir: './e2e',
  testIgnore: '**/*.stability.spec.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: true,
  workers: 3,
  timeout: 60_000,
  globalTimeout: 15 * 60_000,
  expect: { timeout: 15_000 },
  reporter: [
    ['list'],
    ['json', { outputFile: join(artifacts, 'report.json') }],
    ['junit', { outputFile: join(artifacts, 'junit.xml') }],
  ],
  outputDir: join(artifacts, 'results'),
  use: {
    baseURL: 'http://127.0.0.1:5181',
    actionTimeout: 15_000,
    navigationTimeout: 15_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: ['chromium', 'firefox', 'webkit'].flatMap((browserName) => [
    {
      name: `desktop-${browserName}`,
      use: { browserName: browserName as 'chromium' | 'firefox' | 'webkit', viewport: { width: 1448, height: 1086 } },
    },
    {
      name: `narrow-${browserName}`,
      use: { browserName: browserName as 'chromium' | 'firefox' | 'webkit', viewport: { width: 390, height: 844 } },
    },
  ]),
  webServer: {
    command: 'npm run preview',
    url: 'http://127.0.0.1:5181',
    reuseExistingServer: false,
    timeout: 30_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
  },
});
