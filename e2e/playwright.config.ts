import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run the real gateway (with the scripted mock engine) serving
 * the production web build. Each scenario gets its own fresh CONCH_HOME and
 * port so onboarding always starts from a clean slate.
 *
 *   pnpm e2e            (builds the web app first)
 */
const scenarios = {
  ready: { port: 4391, env: { CONCH_MOCK_STATE: 'ready' } },
  models: { port: 4394, env: { CONCH_MOCK_STATE: 'ready' } },
  search: { port: 4396, env: { CONCH_MOCK_STATE: 'ready' } },
  routines: { port: 4395, env: { CONCH_MOCK_STATE: 'ready' } },
  'signed-out': { port: 4392, env: { CONCH_MOCK_STATE: 'signed-out' } },
  'not-installed': {
    port: 4393,
    env: { CONCH_MOCK_STATE: 'not-installed', CONCH_MOCK_INSTALL_AFTER: '2' },
  },
} as const;

const root = join(import.meta.dirname, '..');

export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    channel: 'chrome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: Object.entries(scenarios).map(([name, s]) => ({
    name,
    testMatch: `${name}.spec.ts`,
    use: { baseURL: `http://localhost:${s.port}` },
  })),
  webServer: Object.values(scenarios).map((s) => ({
    // Run tsx directly (not via pnpm) so Playwright's shutdown signal reaches the server.
    command: './node_modules/.bin/tsx src/main.ts',
    cwd: join(root, 'apps/server'),
    url: `http://localhost:${s.port}/api/health`,
    reuseExistingServer: false,
    env: {
      ...s.env,
      CONCH_ENGINE: 'mock',
      CONCH_MOCK_SPEED: '0.25',
      CONCH_PORT: String(s.port),
      CONCH_HOME: mkdtempSync(join(tmpdir(), 'conch-e2e-')),
      CONCH_WEB_DIST: join(root, 'apps/web/dist'),
      CONCH_LOG_LEVEL: 'warn',
    },
  })),
});
