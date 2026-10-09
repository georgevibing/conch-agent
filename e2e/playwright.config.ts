import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defineConfig, devices } from '@playwright/test';

import { hereCookieName, ThisComputer } from '../apps/server/src/auth/here';
import { hermesHome, openClawHome, openClawTeamHome } from '../apps/server/src/import/fixtures';
import { selectProjects } from '../scripts/e2e-projects.mjs';

// Match the file guard's canonical roots, including macOS's /var → /private/var.
const tempRoot = realpathSync(tmpdir());

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
  join(tempRoot, 'conch-e2e-devices-'),
));

/**
 * The `import` journey brings things over from a pretend OpenClaw: a home
 * folder with `~/.openclaw` in it (apps/server/src/import/fixtures.ts).
 */
const importHome = (process.env.CONCH_E2E_IMPORT_HOME ??= (() => {
  const home = mkdtempSync(join(tempRoot, 'conch-e2e-import-'));
  openClawHome(home);
  return home;
})());

/**
 * The `import-more` journey (ADR 0042): OpenClaw with another agent and a
 * Slack bot with one key, and Hermes with its model and the same.
 */
const importMoreHome = (process.env.CONCH_E2E_IMPORT_MORE_HOME ??= (() => {
  const home = mkdtempSync(join(tempRoot, 'conch-e2e-import-more-'));
  openClawTeamHome(home);
  hermesHome(home);
  return home;
})());

/**
 * This computer's key (ADR 0063), the same for every gateway in the run and in every worker (they
 * read the config again, and inherit the environment). It never goes over the network: the
 * journeys' browsers start with the cookie a launcher would have given them, made with it
 * (`openedFromConch`). `this-computer.spec.ts` starts without it and goes the real way.
 */
const hereKey = (process.env.CONCH_E2E_HERE_KEY ??= randomBytes(32).toString('base64url'));

/** A gateway's home with this computer's key already in it, as Conch would have made it. */
function withHereKey(home: string): string {
  mkdirSync(join(home, 'here'), { recursive: true, mode: 0o700 });
  writeFileSync(join(home, 'here', 'key'), `${hereKey}\n`, { mode: 0o600 });
  return home;
}

/** The cookie a browser gets once Conch has opened it, made with the same key, for a gateway's port. */
const thisComputer = new ThisComputer(withHereKey(mkdtempSync(join(tempRoot, 'conch-e2e-here-'))));
const openedFromConch = (port: number) => ({
  cookies: [
    {
      name: hereCookieName(port),
      value: thisComputer.cookie(),
      domain: 'localhost',
      path: '/',
      expires: -1,
      httpOnly: true,
      secure: false,
      sameSite: 'Strict' as const,
    },
  ],
  origins: [],
});

/** The `this-computer` journey asks for links through this gateway's own folder, as a launcher does. */
const thisComputerHome = (process.env.CONCH_E2E_THIS_COMPUTER_HOME ??= mkdtempSync(
  join(tempRoot, 'conch-e2e-this-computer-'),
));

/**
 * The `passkeys` journey (ADR 0064, 0065) makes a hello link in its gateway's home, as
 * `conch hello` does, and starts again from scratch with `conch reset`'s own store call.
 */
const passkeysHome = (process.env.CONCH_E2E_PASSKEYS_HOME ??= mkdtempSync(
  join(tempRoot, 'conch-e2e-passkeys-'),
));

/** The `trust` journey puts a signed skill where its gateway looks, and changes it. */
const trustHome = (process.env.CONCH_E2E_TRUST_HOME ??= mkdtempSync(
  join(tempRoot, 'conch-e2e-trust-'),
));

/** The `skill-scope` journey puts a skill where its gateway looks, and signs one from the terminal. */
const skillScopeHome = (process.env.CONCH_E2E_SKILL_SCOPE_HOME ??= mkdtempSync(
  join(tempRoot, 'conch-e2e-skill-scope-'),
));

/** The `releases` journey's pretend upstream: a bare origin with signed release tags (ADR 0051). */
const releasesWorld = (process.env.CONCH_E2E_RELEASES_WORLD ??= mkdtempSync(
  join(tempRoot, 'conch-e2e-releases-'),
));

const scenarios = {
  ready: { port: 4391, env: { CONCH_MOCK_STATE: 'ready' } },
  // Settings → This computer: live readings of the real machine, only while it's open.
  computer: { port: 4337, env: { CONCH_MOCK_STATE: 'ready' } },
  models: { port: 4394, env: { CONCH_MOCK_STATE: 'ready' } },
  search: { port: 4396, env: { CONCH_MOCK_STATE: 'ready' } },
  routines: { port: 4395, env: { CONCH_MOCK_STATE: 'ready' } },
  integrations: { port: 4398, env: { CONCH_MOCK_STATE: 'ready' } },
  // Gmail, Calendar and Drive as apps (ADR 0048): Gmail by app password against the pretend mail service.
  'google-apps': { port: 4367, env: { CONCH_MOCK_STATE: 'ready' } },
  // One app, one card (ADR 0052): Slack and Gmail, each half offering the other.
  apps: { port: 4369, env: { CONCH_MOCK_STATE: 'ready' } },
  browser: { port: 4399, env: { CONCH_MOCK_STATE: 'ready' } },
  terminal: { port: 4390, env: { CONCH_MOCK_STATE: 'ready' } },
  recovery: { port: 4388, env: { CONCH_MOCK_STATE: 'ready' } },
  offline: { port: 4385, env: { CONCH_MOCK_STATE: 'ready' } },
  attachments: { port: 4389, env: { CONCH_MOCK_STATE: 'ready' } },
  passwords: { port: 4386, env: { CONCH_MOCK_STATE: 'ready' } },
  suggest: { port: 4383, env: { CONCH_MOCK_STATE: 'ready' } },
  // Replies to send next (ADR 0060): the assistant's under a table, Conch's own, none after reading.
  replies: { port: 4352, env: { CONCH_MOCK_STATE: 'ready' } },
  // The chat knows Conch (ADR 0060): the assistant offers an app or a skill, and the chat carries on.
  offers: { port: 4354, env: { CONCH_MOCK_STATE: 'ready' } },
  // The plan, ticking itself off (ADR 0060): a plan that ticks and folds, and plan mode's Start.
  plans: { port: 4347, env: { CONCH_MOCK_STATE: 'ready' } },
  // Conch's own chat commands (ADR 0098): `/clear` with its Undo, and `/goal`.
  commands: { port: 4345, env: { CONCH_MOCK_STATE: 'ready' } },
  // Agents (ADR 0101): make one, talk to it, hand a chat over, rename it, delete it with Undo.
  agents: { port: 4351, env: { CONCH_MOCK_STATE: 'ready' } },
  // A model that can only chat (ADR 0050): a message that needs an app offers one that can.
  'chat-only': { port: 4358, env: { CONCH_MOCK_STATE: 'ready' } },
  // Questions answered with a tap (ADR 0060): tapped, typed, skipped, and a reload while one waits.
  questions: { port: 4377, env: { CONCH_MOCK_STATE: 'ready' } },
  // Every app with every model (ADR 0049): Slack as Conch's own, and what a provider set up
  // coming in by itself (the mock provider has Sentry in its account).
  'any-provider': {
    port: 4368,
    env: { CONCH_MOCK_STATE: 'ready', CONCH_MOCK_EXTERNAL: 'portable' },
  },
  // Runs under the supervisor (`pnpm start`), so a restore can start Conch again.
  backups: { port: 4382, env: { CONCH_MOCK_STATE: 'ready', CONCH_SUPERVISE: '1' }, entry: 'start' },
  channels: { port: 4387, env: { CONCH_MOCK_STATE: 'ready' } },
  // WhatsApp and Signal linked by (pretend) QR codes (ADR 0043).
  'channels-linked': { port: 4364, env: { CONCH_MOCK_STATE: 'ready' } },
  // iMessage and email (ADR 0044): a pretend Messages (a real chat.db) and a pretend IMAP/SMTP.
  'channels-mail': { port: 4365, env: { CONCH_MOCK_STATE: 'ready' } },
  // Routines that start when something happens (ADR 0056): Gmail with the pretend mail service.
  'when-routines': { port: 4341, env: { CONCH_MOCK_STATE: 'ready' } },
  // Teams, Matrix and WeChat, and the public door (ADR 0045), against their pretend apps.
  'channels-work': { port: 4366, env: { CONCH_MOCK_STATE: 'ready' } },
  // Feishu / Lark, DingTalk and QQ (ADR 0120), against their pretend apps: outward connections only.
  'channels-china': { port: 4343, env: { CONCH_MOCK_STATE: 'ready' } },
  // Safe hands: checking after reading, the timeline, skills read before they're used.
  safety: { port: 4378, env: { CONCH_MOCK_STATE: 'ready' } },
  // Undo (ADR 0030): the mock really writes note.md in the work folder, then it's put back.
  undo: { port: 4375, env: { CONCH_MOCK_STATE: 'ready' } },
  // A script that calls tools (ADR 0119): thirty writes and a question as one story, then one Undo.
  scripts: { port: 4339, env: { CONCH_MOCK_STATE: 'ready' } },
  // Come home (ADR 0035), from a pretend OpenClaw.
  import: { port: 4370, env: { CONCH_MOCK_STATE: 'ready', CONCH_IMPORT_HOME: importHome } },
  // Come home, more of it (ADR 0042): the model, other agents, a Slack bot with one key.
  'import-more': {
    port: 4363,
    env: { CONCH_MOCK_STATE: 'ready', CONCH_IMPORT_HOME: importMoreHome },
  },
  // Apps you make, share and add (ADR 0061): made by the mock the real way, used, saved, added back.
  // GitHub's program sees no sign-in here, so nothing can ever be published from a test.
  'conch-apps': {
    port: 4344,
    env: {
      CONCH_MOCK_STATE: 'ready',
      GH_CONFIG_DIR: mkdtempSync(join(tempRoot, 'conch-e2e-gh-')),
      GH_TOKEN: '',
      GITHUB_TOKEN: '',
    },
  },
  // The chat list, organised (ADR 0089): pins, folders, drag, Select, kept across a reload.
  'chat-list': { port: 4349, env: { CONCH_MOCK_STATE: 'ready' } },
  // Show me: things made beside the chat, sealed pages, pinned apps (ADR 0034).
  'show-me': { port: 4371, env: { CONCH_MOCK_STATE: 'ready' } },
  // The chat tells what it's doing (ADR 0103): stories of steps, the provider's words, Why?, the raw call.
  stories: { port: 4338, env: { CONCH_MOCK_STATE: 'ready' } },
  // What a tool found, drawn as it is (ADR 0060): the mock's pretend calendar, mail, files and Slack.
  views: { port: 4353, env: { CONCH_MOCK_STATE: 'ready' } },
  // A card in the chat, done something with (ADR 0105): the forecast saved as a real
  // picture this browser drew, and sent to the pretend Telegram as a photo.
  cards: { port: 4335, env: { CONCH_MOCK_STATE: 'ready' } },
  // Edit by hand and live data (ADR 0046), against a pretend data site on a port the system picks.
  canvas: {
    port: 4360,
    env: { CONCH_MOCK_STATE: 'ready' },
    command: 'node --import tsx ../../e2e/canvas-gateway.ts',
  },
  // It learns you: what Conch knows, the tidy-up with Undo, memories that wait, skill suggestions.
  memory: { port: 4373, env: { CONCH_MOCK_STATE: 'ready' } },
  // Quiet learning (ADR 0088): a correction learned once the chat goes quiet, Why?, Undo, never again.
  learning: { port: 4336, env: { CONCH_MOCK_STATE: 'ready' } },
  // Search by meaning (ADR 0041): the pretend model's download, then meaning in search and skill suggestions.
  meaning: { port: 4362, env: { CONCH_MOCK_STATE: 'ready' } },
  // Hand it off: background tasks, helpers side by side, approvals from a task.
  tasks: { port: 4372, env: { CONCH_MOCK_STATE: 'ready' } },
  // Skill trust (ADR 0031): a signed skill, trusting its publisher, held to what it says it needs.
  trust: { port: 4374, env: { CONCH_MOCK_STATE: 'ready', CONCH_HOME: trustHome } },
  // Skill scope (ADR 0047): a chat stays held to a skill's list until you stop it; the signing key is locked.
  'skill-scope': { port: 4361, env: { CONCH_MOCK_STATE: 'ready', CONCH_HOME: skillScopeHome } },
  // Discover (ADR 0074): skills people share, from the mock engine's pretend registry.
  discover: { port: 4342, env: { CONCH_MOCK_STATE: 'ready' } },
  // Conch in your pocket: the app, the offline screen, the phone's address (a pretend Tailscale).
  pocket: { port: 4379, env: { CONCH_MOCK_STATE: 'ready' } },
  // Under the supervisor, like `pnpm start`: Conch runs "in a Terminal window", and can quit.
  'always-on': {
    port: 4380,
    env: { CONCH_MOCK_STATE: 'ready', CONCH_SUPERVISE: '1' },
    entry: 'start',
  },
  // Releases (ADR 0051): signed tags from a pretend upstream, a staged swap, and the restart.
  releases: {
    port: 4359,
    env: { CONCH_MOCK_STATE: 'ready', CONCH_E2E_RELEASES_WORLD: releasesWorld },
    command: 'node --import tsx ../../e2e/releases-gateway.ts',
  },
  // The menu bar and a little computer (ADR 0029): a pretend helper, lingering and keep-awake.
  'little-computer': {
    port: 4376,
    env: { CONCH_MOCK_STATE: 'ready', CONCH_SUPERVISE: '1' },
    entry: 'start',
  },
  // Approving new devices: "other devices" arrive through a pretend proxy (X-Forwarded-For).
  devices: { port: 4381, env: { CONCH_MOCK_STATE: 'ready', CONCH_HOME: devicesHome } },
  // The hello link and passkeys (ADR 0064, 0065), with Chrome's virtual authenticator.
  passkeys: { port: 4346, env: { CONCH_MOCK_STATE: 'ready', CONCH_HOME: passkeysHome } },
  // "This computer", proven (ADR 0063): a browser Conch didn't open, and one it did (the real way).
  'this-computer': {
    port: 4348,
    env: { CONCH_MOCK_STATE: 'ready', CONCH_HOME: thisComputerHome },
  },
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
  // A server of your own (ADR 0053), against a pretend llama.cpp (e2e/fake-openai.ts). Not
  // pinned to the mock, so the Providers gallery is the real one; port 4357 tells the spec
  // where the pretend server is.
  servers: {
    port: 4356,
    env: {},
    command: 'node --import tsx ../../e2e/servers-gateway.ts',
  },
} as const satisfies Record<
  string,
  { port: number; env: Record<string, string>; command?: string; entry?: 'main' | 'start' }
>;

const root = join(import.meta.dirname, '..');

/**
 * Which journeys run, so only their gateways start (other sessions may be using
 * the other ports): `--project x`, or `CONCH_E2E_ONLY=local,ready`.
 * CI partitions projects before creating gateways, rather than starting all 54
 * on every shard. A selected browser project waits only for its shard's journeys.
 */
const only = selectProjects(Object.keys(scenarios), {
  argv: process.argv.slice(2),
  only: process.env.CONCH_E2E_ONLY,
  shard: process.env.CONCH_E2E_SHARD,
});
const chosen = Object.entries(scenarios).filter(([name]) => only.has(name));

export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  // Every journey has its own gateway and Chrome; more than a few at once starves the
  // timing-sensitive ones (streaming, sign-in, the terminal) — and ends sooner, not later.
  // CI's runner has four cores.
  workers: process.env.CI ? 2 : 3,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['list'], ['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    ...devices['Desktop Chrome'],
    ...(process.env.CONCH_TEST_BROWSER
      ? { launchOptions: { executablePath: process.env.CONCH_TEST_BROWSER } }
      : process.env.CI
        ? { channel: 'chromium' }
        : { channel: 'chrome' }),
    // The specs read dates and times as en-US; don't inherit the machine's locale.
    locale: 'en-US',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: chosen.map(([name, s]) => ({
    name,
    // Google setup uses the existing integrations gateway, not another server.
    testMatch:
      name === 'integrations'
        ? ['integrations.spec.ts', 'google-setup.spec.ts']
        : `${name}.spec.ts`,
    use: { baseURL: `http://localhost:${s.port}`, storageState: openedFromConch(s.port) },
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
      'command' in s
        ? s.command
        : `node --import tsx --import ../../e2e/resources.ts src/${'entry' in s ? s.entry : 'main'}.ts`,
    cwd: join(root, 'apps/server'),
    url: `http://localhost:${s.port}/api/health`,
    reuseExistingServer: false,
    env: {
      CONCH_ENGINE: 'mock',
      ...s.env,
      CONCH_MOCK_SPEED: '0.25',
      CONCH_PORT: String(s.port),
      CONCH_HOME: withHereKey(
        (s.env as Record<string, string>).CONCH_HOME ?? mkdtempSync(join(tempRoot, 'conch-e2e-')),
      ),
      // No journey sees the OpenClaw or Hermes of whoever runs it: only `import` has one.
      CONCH_IMPORT_HOME:
        (s.env as Record<string, string>).CONCH_IMPORT_HOME ??
        mkdtempSync(join(tempRoot, 'conch-e2e-nohome-')),
      CONCH_WEB_DIST: join(root, 'apps/web/dist'),
      CONCH_LOG_LEVEL: 'warn',
      // No journey can reach GitHub as whoever runs it: no gh sign-in, no token.
      GH_CONFIG_DIR: mkdtempSync(join(tempRoot, 'conch-e2e-gh-')),
      GH_TOKEN: '',
      GITHUB_TOKEN: '',
    },
  })),
});
