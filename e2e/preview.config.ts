import { defineConfig, devices } from '@playwright/test';

const previewUrl = process.env['DEPLOYMENT_URL'];
if (
  !previewUrl ||
  new URL(previewUrl).origin !== previewUrl ||
  !previewUrl.startsWith('https://')
) {
  throw new Error('DEPLOYMENT_URL must be an exact HTTPS preview origin without a trailing slash.');
}
const cspMode = process.env['DEPLOYMENT_CSP_MODE'];
if (cspMode && !['report-only', 'enforced'].includes(cspMode)) {
  throw new Error('DEPLOYMENT_CSP_MODE must be report-only or enforced.');
}

export default defineConfig({
  testDir: './deployment',
  testMatch: 'preview.spec.ts',
  workers: 1,
  forbidOnly: true,
  retries: 0,
  outputDir: './test-results/preview',
  use: { ...devices['Desktop Chrome'], baseURL: previewUrl, trace: 'retain-on-failure' },
});
