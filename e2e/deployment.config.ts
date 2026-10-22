import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './deployment',
  testMatch: 'production-build.spec.ts',
  workers: 2,
  forbidOnly: Boolean(process.env['CI']),
  retries: 0,
  outputDir: './test-results/deployment',
  use: { ...devices['Desktop Chrome'], trace: 'retain-on-failure' },
});
