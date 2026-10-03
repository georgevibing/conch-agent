import { defineConfig } from '@playwright/test';

/**
 * The desktop app, driven for real (ADR 0054): Electron with the gateway it
 * carries (`pnpm desktop:start` builds both), the mock engine, and a fresh
 * CONCH_HOME and port per test.
 *
 *   pnpm desktop:e2e
 */
export default defineConfig({
  testDir: '.',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  // Each test runs a whole app and its gateway.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  outputDir: '../../../test-results/desktop',
});
