/**
 * The gateway for the `servers` journey: not pinned to one provider (a server
 * of your own joins the others), with a pretend llama.cpp beside it on a port
 * the system picks. The spec reads its address from `/__fake`.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';

import { startFakeOpenAi } from './fake-openai';

const { port, server } = await startFakeOpenAi();
// Tells the spec where the pretend server is, on the port after the gateway's.
const info = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ address: `127.0.0.1:${port}` }));
});
info.listen(Number(process.env.CONCH_PORT) + 1, '127.0.0.1');

const env = { ...process.env };
// Every provider, as a person has them; the mock would pin itself as the only one.
delete env.CONCH_ENGINE;
const gateway = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
  stdio: 'inherit',
  env,
});
const stop = () => {
  gateway.kill();
  server.close();
  info.close();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
gateway.on('exit', (code) => {
  server.close();
  info.close();
  process.exit(code ?? 0);
});
