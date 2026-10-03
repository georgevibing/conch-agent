import { buildApp } from './app';
import { checkup, secureHome, workspaceRules } from './auth/checkup';
import { applyPendingRestore } from './backup/restore';
import { exposure } from './auth/network';
import { loadConfig, portIsExplicit } from './config';
import { runningAs, waitForTurn } from './background/service';
import { askUrl } from './background/tray';
import { theApp } from './desktop/app';
import { setRestartHandler, setStopHandler, stopSoon } from './lib/lifecycle';
import { openInBrowser } from './lib/open';
import {
  choosePort,
  forgetGateway,
  probePort,
  recordGateway,
  runningGateway,
  takenMessage,
  whoHolds,
} from './port';
import { SERVER_VERSION, Services } from './services';
import { RESTART_CODE } from './supervisor';
import { prove, readState } from './updates/layout';
import { sandboxSupport } from './conversations/sandbox';

const config = loadConfig();
const addressOf = (port: number) =>
  `http://${config.CONCH_HOST === '127.0.0.1' ? 'localhost' : config.CONCH_HOST}:${port}`;

const background = runningAs() === 'background';
// The desktop app that started this gateway, if one did (ADR 0054): told where Conch is.
const desktop = theApp();
// The app went away (it quit, crashed or was killed): don't outlive it. Before
// Conch is listening there's nothing to close, so it just stops.
desktop?.onGone(() => {
  if (!stopSoon()) process.exit(0);
});
// Before anything starts: is the port free, already a Conch, or another program's?
const choose = async () =>
  choosePort({
    port: config.CONCH_PORT,
    explicit: portIsExplicit(),
    recorded: (await runningGateway(config.CONCH_HOME))?.port,
    probe: (port) => probePort(config.CONCH_HOST, port),
  });
let choice = await choose();
// Started at login with a Conch already open in a Terminal window: wait for its
// place (it hands over, or you close it), then take over. Another background
// Conch already there means this one isn't needed.
if (
  choice.kind === 'running' &&
  background &&
  !desktop &&
  !(await runningGateway(config.CONCH_HOME))?.background
) {
  console.warn('  🐚  Conch is open in a window; this one takes over when it closes.');
  await waitForTurn(config.CONCH_HOME, async () => (await choose()).kind !== 'running');
  choice = await choose();
}
if (choice.kind === 'running') {
  // The app shows that one instead of starting a second.
  if (desktop) {
    await desktop.send({ type: 'elsewhere', url: askUrl(config.CONCH_HOST, choice.port) });
    process.exit(0);
  }
  const running = addressOf(choice.port);
  console.warn(
    `\n  🐚  Conch is already running at ${running}${config.CONCH_OPEN ? ' — opening it.' : '.'}\n`,
  );
  if (config.CONCH_OPEN) await openInBrowser(running);
  process.exit(0);
}
if (choice.kind === 'taken') {
  const message = takenMessage(choice, await whoHolds(choice.port));
  await desktop?.send({ type: 'failed', message });
  console.error(`\n  ${message.replaceAll('\n', '\n  ')}\n`);
  process.exit(1);
}
// Everything below (the browser's guard, pairing links, the checkup) uses the port it's really on.
config.CONCH_PORT = choice.port;

// A restore waiting for this start goes into place before any store reads a file (ADR 0020).
const restored = await applyPendingRestore(config.CONCH_HOME, { conchVersion: SERVER_VERSION });
if (restored.kind === 'applied') console.warn('\n  🐚  Your backup is restored.');
if (restored.kind === 'failed')
  console.error(`\n  Conch couldn’t finish restoring your backup: ${restored.error}`);

const services = new Services(config);
services.homeProblems = await secureHome(config.CONCH_HOME);
const app = await buildApp(services);
await services.gate.hosts.discover();
// Whether `tailscale serve` reaches Conch: phones are only offered an address that works.
void services.tailscale.status().catch(() => undefined);

try {
  await app.listen({ host: config.CONCH_HOST, port: config.CONCH_PORT });
} catch (error) {
  const code = (error as NodeJS.ErrnoException).code;
  console.error(
    code === 'EADDRINUSE'
      ? `\n  Port ${config.CONCH_PORT} was taken just as Conch started. Start Conch again.\n`
      : error,
  );
  process.exit(1);
}
// The app's window opens on it now, by number (`askUrl`: `localhost` tries ::1 first).
void desktop?.send({ type: 'listening', url: askUrl(config.CONCH_HOST, config.CONCH_PORT) });
await recordGateway(config.CONCH_HOME, {
  pid: process.pid,
  host: config.CONCH_HOST,
  port: config.CONCH_PORT,
  startedAt: Date.now(),
  ...(background && { background }),
});
// A release just swapped in proves itself by answering (ADR 0051); until it
// does, the supervisor is ready to go back to the version before.
const releaseRoot = process.env.CONCH_RELEASE_ROOT;
if (releaseRoot && readState(config.CONCH_HOME).pending) {
  const host = /^(0\.0\.0\.0|::)$/.test(config.CONCH_HOST) ? '127.0.0.1' : config.CONCH_HOST;
  const answered = await fetch(
    `http://${host.includes(':') ? `[${host}]` : host}:${config.CONCH_PORT}/api/health`,
    {
      signal: AbortSignal.timeout(10_000),
    },
  )
    .then((res) => res.ok)
    .catch(() => false);
  if (answered && prove(config.CONCH_HOME, releaseRoot))
    console.warn(`\n  🐚  Conch ${services.updates.version} is running.`);
}
// Always on: the file that starts Conch at login still fits where Conch is now.
void services.background.heal().catch(() => undefined);
// The menu bar helper and keeping a Mac awake (ADR 0029): with Conch itself, never a dev server.
if (desktop) {
  // The app's own icon is the menu bar: shown when it's wanted.
  void services.tray.ensure();
  void services.background.applyKeepAwake().catch(() => undefined);
} else if (runningAs() !== 'dev' || config.CONCH_ENGINE === 'mock') {
  // The gate learns the helper's token even while it's hidden: `pnpm conch tray on` can show it any time.
  const showTray = () =>
    void services.tray
      .token()
      .then(() => services.tray.ensure())
      .catch(() => undefined);
  showTray();
  // Started again if it stopped (a crash, a logout and back): looked at now and then.
  setInterval(showTray, 5 * 60_000).unref();
  void services.background.applyKeepAwake().catch(() => undefined);
}
process.on('exit', () => forgetGateway(config.CONCH_HOME));

// Routines only run while Conch is running; start the clock once we're listening.
await services.routines.start();

const url = addressOf(config.CONCH_PORT);
if (choice.busy !== undefined) {
  const holder = (await whoHolds(choice.busy)) ?? 'another program';
  console.warn(
    `\n  Port ${choice.busy} is in use by ${holder}, so Conch started on ${choice.port} instead.`,
  );
  void services.healed.note(
    'gateway',
    `Port ${choice.busy} was busy, so Conch started on ${choice.port}.`,
  );
}
console.warn(`\n  🐚  Conch is listening at ${url}\n`);

// Say out loud anything that makes this setup unsafe.
const findings = checkup({
  config,
  access: await services.access.get(),
  accessLocked: await services.access.locked(),
  permissionMode: (await services.settings.get()).preferences.permissionMode,
  secure: exposure(config) === 'local',
  homeProblems: services.homeProblems,
  tailscale: services.gate.hosts.tailscale,
  workspaceRules: await workspaceRules(await services.settings.workspace()),
  trustedIntegrations: await services.integrations.store.trusted(),
  browserLocal: (await services.browser.store.settings()).allowLocal,
  terminalRemote: (await services.terminal.settings()).allowRemote,
  provider: services.providers.activeCopy(),
  channels: await services.channels.checkupCopy(),
  safety: {
    checkAfterReading: (await services.settings.get()).preferences.checkAfterReading,
    sealedCommands: (await services.settings.get()).preferences.sealedCommands,
    sandboxAvailable: sandboxSupport().available,
  },
}).filter((item) => item.level === 'danger' || item.level === 'warn');
for (const item of findings) {
  console.warn(`  ${item.level === 'danger' ? '⛔' : '⚠️ '}  ${item.title}\n      ${item.detail}`);
  if (item.command) console.warn(`      → ${item.command}`);
}
if (findings.length) console.warn('\n  Settings → Security in Conch has the details.\n');
// Started again by the supervisor after a crash: say so, quietly.
if (process.env.CONCH_STARTED_BECAUSE === 'crash')
  void services.healed.note('gateway', 'Conch stopped unexpectedly, so it started itself again.');
// A restart (after an update or a restore) doesn't open another browser tab.
if (config.CONCH_OPEN && !process.env.CONCH_STARTED_BECAUSE?.match(/restart|crash/))
  void openInBrowser(url);

// An update or a restore can ask to start again; the supervisor does it.
setRestartHandler(async () => {
  services.routines.stop();
  setTimeout(() => process.exit(RESTART_CODE), 1500).unref();
  await app.close().catch(() => undefined);
  process.exit(RESTART_CODE);
});

// Quit Conch, or hand over to the Conch the computer started (Always on).
setStopHandler(async (farewell) => {
  services.routines.stop();
  setTimeout(() => process.exit(0), 1500).unref();
  await app.close().catch(() => undefined);
  if (farewell) console.warn(`\n  ${farewell.replaceAll('\n', '\n  ')}\n`);
  process.exit(0);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    // Open WebSockets can hold close() up; never hang on the way out.
    services.routines.stop();
    setTimeout(() => process.exit(0), 1500).unref();
    void app.close().then(() => process.exit(0));
  });
}
