/**
 * The gateway for the `local` journey, with a pretend Ollama beside it on a
 * port the system picks. Conch finds it through `OLLAMA_HOST`, as it would a
 * real one moved off the default port.
 */
import { spawn } from 'node:child_process';

import { startFakeOllama } from './fake-ollama';

const { port, server } = await startFakeOllama();
const gateway = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
  stdio: 'inherit',
  env: { ...process.env, OLLAMA_HOST: `127.0.0.1:${port}` },
});
const stop = () => {
  gateway.kill();
  server.close();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
gateway.on('exit', (code) => {
  server.close();
  process.exit(code ?? 0);
});
