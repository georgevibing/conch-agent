import { execFile } from 'node:child_process';

import { buildApp } from './app';
import { checkup, secureHome, workspaceRules } from './auth/checkup';
import { exposure } from './auth/network';
import { loadConfig } from './config';
import { Services } from './services';

const config = loadConfig();
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
      ? `\n  Port ${config.CONCH_PORT} is already in use — is Conch already running?\n  Set CONCH_PORT to use another port.\n`
      : error,
  );
  process.exit(1);
}

// Routines only run while Conch is running; start the clock once we're listening.
await services.routines.start();

const url = `http://${config.CONCH_HOST === '127.0.0.1' ? 'localhost' : config.CONCH_HOST}:${config.CONCH_PORT}`;
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
}).filter((item) => item.level === 'danger' || item.level === 'warn');
for (const item of findings) {
  console.warn(`  ${item.level === 'danger' ? '⛔' : '⚠️ '}  ${item.title}\n      ${item.detail}`);
  if (item.command) console.warn(`      → ${item.command}`);
}
if (findings.length) console.warn('\n  Settings → Security in Conch has the details.\n');
if (config.CONCH_OPEN && process.platform === 'darwin') execFile('open', [url]);
// `start` is a cmd.exe built-in; this is the same hand-off without a shell.
if (config.CONCH_OPEN && process.platform === 'win32') {
  execFile('rundll32', ['url.dll,FileProtocolHandler', url], { windowsHide: true });
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    // Open WebSockets can hold close() up; never hang on the way out.
    services.routines.stop();
    setTimeout(() => process.exit(0), 1500).unref();
    void app.close().then(() => process.exit(0));
  });
}
