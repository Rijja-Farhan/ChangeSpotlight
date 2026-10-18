import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Every test dev server writes the same .change-spotlight/dev-server.json; run files one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
