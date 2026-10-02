/**
 * The gateway for the `canvas` journey (ADR 0039), with a pretend data site
 * beside it on a port the system picks: the weather a live page reads.
 * Nothing here reaches the internet. `POST /__control` changes what it says:
 * `{ "temp": 23 }`, `{ "fail": true }`.
 *
 * Lisbon's weather is a redirect to cloud metadata, the way a hostile site
 * would try to bounce Conch inward: the gateway must refuse it.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

const state = { temp: 21, fail: false, reads: 0 };

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (req.method === 'POST' && url.pathname === '/__control') {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => {
      Object.assign(state, JSON.parse(body || '{}') as Partial<typeof state>);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(state));
    });
    return;
  }
  if (url.pathname === '/__state') {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify(state));
  }
  if (url.pathname === '/weather') {
    state.reads++;
    // Nothing of yours ever arrives with a read.
    if (req.headers.cookie || req.headers.authorization) {
      res.statusCode = 400;
      return res.end('credentials sent');
    }
    if (url.searchParams.get('city') === 'lisbon') {
      res.writeHead(302, { location: 'https://169.254.169.254/latest/meta-data/' });
      return res.end();
    }
    if (state.fail) {
      res.statusCode = 503;
      res.setHeader('content-type', 'application/json');
      return res.end('{"error":"down"}');
    }
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ city: url.searchParams.get('city'), temp: state.temp }));
  }
  res.statusCode = 404;
  res.end();
});

await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
const { port } = server.address() as AddressInfo;
const gateway = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
  stdio: 'inherit',
  env: { ...process.env, CONCH_MOCK_DATA_URL: `http://localhost:${port}` },
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
