import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    maxWorkers: 4,
    testTimeout: 15_000,
    clearMocks: true,
    restoreMocks: true,
  },
});
