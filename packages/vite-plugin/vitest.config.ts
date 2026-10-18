import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // e2e tests drive real Chrome against real dev servers; running files one at a time keeps timing
    // (dwell + batch windows) predictable on slower machines.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
