import { execFile } from 'node:child_process';

import { buildApp } from './app';
import { loadConfig } from './config';
import { Services } from './services';

const config = loadConfig();
const services = new Services(config);
const app = await buildApp(services);

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

const url = `http://${config.CONCH_HOST === '127.0.0.1' ? 'localhost' : config.CONCH_HOST}:${config.CONCH_PORT}`;
console.warn(`\n  🐚  Conch is listening at ${url}\n`);
if (config.CONCH_OPEN && process.platform === 'darwin') execFile('open', [url]);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
