import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Spawning fixtures and real HTTP on a shared CI runner is several times
    // slower than locally; the 5s default has failed CI twice.
    testTimeout: 15_000,
  },
});
