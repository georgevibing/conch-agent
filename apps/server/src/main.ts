import { buildApp } from './app';
import { checkup, secureHome, workspaceRules } from './auth/checkup';
import { exposure } from './auth/network';
import { loadConfig, portIsExplicit } from './config';
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
import { Services } from './services';

const config = loadConfig();
const addressOf = (port: number) =>
  `http://${config.CONCH_HOST === '127.0.0.1' ? 'localhost' : config.CONCH_HOST}:${port}`;

// Before anything starts: is the port free, already a Conch, or another program's?
const choice = await choosePort({
  port: config.CONCH_PORT,
  explicit: portIsExplicit(),
  recorded: (await runningGateway(config.CONCH_HOME))?.port,
  probe: (port) => probePort(config.CONCH_HOST, port),
});
if (choice.kind === 'running') {
  const running = addressOf(choice.port);
  console.warn(
    `\n  🐚  Conch is already running at ${running}${config.CONCH_OPEN ? ' — opening it.' : '.'}\n`,
  );
  if (config.CONCH_OPEN) await openInBrowser(running);
  process.exit(0);
}
if (choice.kind === 'taken') {
  const message = takenMessage(choice, await whoHolds(choice.port));
  console.error(`\n  ${message.replaceAll('\n', '\n  ')}\n`);
  process.exit(1);
}
// Everything below (the browser's guard, pairing links, the checkup) uses the port it's really on.
config.CONCH_PORT = choice.port;

const services = new Services(config);
services.homeProblems = await secureHome(config.CONCH_HOME);
const app = await buildApp(services);
await services.gate.hosts.discover();

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
await recordGateway(config.CONCH_HOME, {
  pid: process.pid,
  host: config.CONCH_HOST,
  port: config.CONCH_PORT,
  startedAt: Date.now(),
});
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
}).filter((item) => item.level === 'danger' || item.level === 'warn');
for (const item of findings) {
  console.warn(`  ${item.level === 'danger' ? '⛔' : '⚠️ '}  ${item.title}\n      ${item.detail}`);
  if (item.command) console.warn(`      → ${item.command}`);
}
if (findings.length) console.warn('\n  Settings → Security in Conch has the details.\n');
if (config.CONCH_OPEN) void openInBrowser(url);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    // Open WebSockets can hold close() up; never hang on the way out.
    services.routines.stop();
    setTimeout(() => process.exit(0), 1500).unref();
    void app.close().then(() => process.exit(0));
  });
}
