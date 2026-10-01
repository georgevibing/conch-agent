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
/**
 * The `devices` journey runs `pnpm conch devices` beside its gateway, so it
 * needs to know where that gateway keeps its files.
 */
// Workers load this file again: they inherit the folder the main process made.
const devicesHome = (process.env.CONCH_E2E_DEVICES_HOME ??= mkdtempSync(
  join(tmpdir(), 'conch-e2e-devices-'),
));

const scenarios = {
  ready: { port: 4391, env: { CONCH_MOCK_STATE: 'ready' } },
  models: { port: 4394, env: { CONCH_MOCK_STATE: 'ready' } },
  search: { port: 4396, env: { CONCH_MOCK_STATE: 'ready' } },
  routines: { port: 4395, env: { CONCH_MOCK_STATE: 'ready' } },
  integrations: { port: 4398, env: { CONCH_MOCK_STATE: 'ready' } },
  browser: { port: 4399, env: { CONCH_MOCK_STATE: 'ready' } },
  terminal: { port: 4390, env: { CONCH_MOCK_STATE: 'ready' } },
  recovery: { port: 4388, env: { CONCH_MOCK_STATE: 'ready' } },
  offline: { port: 4385, env: { CONCH_MOCK_STATE: 'ready' } },
  attachments: { port: 4389, env: { CONCH_MOCK_STATE: 'ready' } },
  passwords: { port: 4386, env: { CONCH_MOCK_STATE: 'ready' } },
  suggest: { port: 4383, env: { CONCH_MOCK_STATE: 'ready' } },
  // Runs under the supervisor (`pnpm start`), so a restore can start Conch again.
  backups: { port: 4382, env: { CONCH_MOCK_STATE: 'ready', CONCH_SUPERVISE: '1' }, entry: 'start' },
  channels: { port: 4387, env: { CONCH_MOCK_STATE: 'ready' } },
  // Safe hands: checking after reading, the timeline, skills read before they're used.
  safety: { port: 4378, env: { CONCH_MOCK_STATE: 'ready' } },
  // Undo (ADR 0030): the mock really writes note.md in the work folder, then it's put back.
  undo: { port: 4375, env: { CONCH_MOCK_STATE: 'ready' } },
  // Conch in your pocket: the app, the offline screen, the phone's address (a pretend Tailscale).
  pocket: { port: 4379, env: { CONCH_MOCK_STATE: 'ready' } },
  // Under the supervisor, like `pnpm start`: Conch runs "in a Terminal window", and can quit.
  'always-on': {
    port: 4380,
    env: { CONCH_MOCK_STATE: 'ready', CONCH_SUPERVISE: '1' },
    entry: 'start',
  },
  // Approving new devices: "other devices" arrive through a pretend proxy (X-Forwarded-For).
  devices: { port: 4381, env: { CONCH_MOCK_STATE: 'ready', CONCH_HOME: devicesHome } },
  security: {
    port: 4397,
    env: { CONCH_MOCK_STATE: 'ready', CONCH_ALLOWED_HOSTS: 'studio-mac.tail1234.ts.net' },
  },
  'signed-out': { port: 4392, env: { CONCH_MOCK_STATE: 'signed-out' } },
  'not-installed': {
    port: 4393,
    env: { CONCH_MOCK_STATE: 'not-installed', CONCH_MOCK_INSTALL_AFTER: '2' },
  },
  // A model on this computer, against a pretend Ollama (e2e/fake-ollama.ts) on a port the
  // system picks. The only provider is Ollama; nothing here reaches the internet.
  local: {
    port: 4384,
    env: { CONCH_ENGINE: 'ollama' },
    command: 'node --import tsx ../../e2e/local-gateway.ts',
  },
} as const satisfies Record<
  string,
  { port: number; env: Record<string, string>; command?: string; entry?: 'main' | 'start' }
>;

const root = join(import.meta.dirname, '..');

/**
 * Which journeys run, so only their gateways start (other sessions may be using
 * the other ports): `--project x`, or `CONCH_E2E_ONLY=local,ready`. The browser
 * journeys depend on every other one, so choosing them runs everything.
 */
function picked(): Set<string> | undefined {
  const names = [
    ...process.argv.flatMap((arg, i, all) =>
      arg === '--project'
        ? [all[i + 1] ?? '']
        : arg.startsWith('--project=')
          ? [arg.slice(10)]
          : [],
    ),
    ...(process.env.CONCH_E2E_ONLY?.split(',').map((name) => name.trim()) ?? []),
  ].filter(Boolean);
  return names.length && !names.includes('browser') ? new Set(names) : undefined;
}
const only = picked();
const chosen = Object.entries(scenarios).filter(([name]) => !only || only.has(name));

export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  // Every journey has its own gateway and Chrome; more than a few at once starves the
  // timing-sensitive ones (streaming, sign-in, the terminal) — and ends sooner, not later.
  // CI's runner has four cores.
  workers: process.env.CI ? 2 : 3,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    channel: 'chrome',
    // The specs read dates and times as en-US; don't inherit the machine's locale.
    locale: 'en-US',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: chosen.map(([name, s]) => ({
    name,
    testMatch: `${name}.spec.ts`,
    use: { baseURL: `http://localhost:${s.port}` },
    // The browser journeys drive a real Chrome, which is heavy enough to make the
    // timing-sensitive specs (password hashing, streaming) flake if they run
    // alongside it. They go last.
    dependencies:
      name === 'browser'
        ? chosen.map(([other]) => other).filter((other) => other !== 'browser')
        : [],
  })),
  webServer: chosen.map(([, s]) => ({
    // Node itself (not pnpm or tsx's CLI) so Playwright's shutdown signal reaches the
    // server; Windows runs this through cmd.exe, which can't start `./node_modules/.bin/tsx`.
    command:
      'command' in s ? s.command : `node --import tsx src/${'entry' in s ? s.entry : 'main'}.ts`,
    cwd: join(root, 'apps/server'),
    url: `http://localhost:${s.port}/api/health`,
    reuseExistingServer: false,
    env: {
      CONCH_ENGINE: 'mock',
      ...s.env,
      CONCH_MOCK_SPEED: '0.25',
      CONCH_PORT: String(s.port),
      CONCH_HOME:
        (s.env as Record<string, string>).CONCH_HOME ?? mkdtempSync(join(tmpdir(), 'conch-e2e-')),
      CONCH_WEB_DIST: join(root, 'apps/web/dist'),
      CONCH_LOG_LEVEL: 'warn',
    },
  })),
});
