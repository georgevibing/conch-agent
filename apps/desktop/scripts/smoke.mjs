// Does the packaged app start? (ADR 0054) Opens the app that dist.mjs left
// in out/ with a fresh CONCH_HOME and the mock engine, waits until its own
// gateway answers and, asked as this computer (ADR 0063), says the app
// started it, then stops the app and checks the gateway went with it. The release workflow runs it on every platform.
//
//   node scripts/smoke.mjs
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { here } from './app-code.mjs';

const out = join(here, 'out');
const unpacked = readdirSync(out).find((name) => /-unpacked$|^mac(-arm64|-universal)?$/.test(name));
if (!unpacked) throw new Error(`No unpacked app in ${out}: run node scripts/dist.mjs first.`);
const exe = {
  darwin: join(out, unpacked, 'Conch.app', 'Contents', 'MacOS', 'Conch'),
  win32: join(out, unpacked, 'Conch.exe'),
  linux: join(out, unpacked, 'conch'),
}[process.platform];
if (!exe || !existsSync(exe)) throw new Error(`The app isn't where it should be: ${exe}`);

const home = mkdtempSync(join(tmpdir(), 'conch-smoke-'));
const port = 4890;
const address = `http://127.0.0.1:${port}`;
const say = (text) => console.warn(`  🐚  ${text}`);
let cookie = '';
const get = async (path) => {
  try {
    const response = await fetch(`${address}${path}`, {
      headers: cookie ? { cookie } : {},
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok ? await response.json() : undefined;
  } catch {
    return undefined;
  }
};
const wait = async (what, check, seconds) => {
  for (let i = 0; i < seconds * 2; i++) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Gave up waiting for ${what}.`);
};

/**
 * This computer, proven (ADR 0063), the way the app's window is: a one-time
 * link asked for through `<home>/here/asks`, its code handed in for the cookie.
 */
const proveHere = async () => {
  const asks = join(home, 'here', 'asks');
  await wait('the gateway to take one-time link requests', () => existsSync(asks), 30);
  const ask = join(asks, randomBytes(12).toString('hex'));
  writeFileSync(`${ask}.tmp`, '/\n', { mode: 0o600 });
  renameSync(`${ask}.tmp`, `${ask}.ask`);
  await wait('a one-time link', () => existsSync(`${ask}.open`), 30);
  const code = /#here=([A-Za-z0-9_-]{43})$/.exec(readFileSync(`${ask}.link`, 'utf8').trim())?.[1];
  if (!code) throw new Error('The one-time link has no code.');
  const response = await fetch(`${address}/api/here`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
    signal: AbortSignal.timeout(5_000),
  });
  const set = response.headers.get('set-cookie');
  if (!response.ok || !set)
    throw new Error(`The gateway didn't take the code (${response.status}).`);
  cookie = set.split(';')[0];
};

say(`Opening ${exe}`);
const started = Date.now();
const app = spawn(exe, [], {
  env: { ...process.env, CONCH_HOME: home, CONCH_PORT: String(port), CONCH_ENGINE: 'mock' },
  stdio: 'inherit',
});
let exited = false;
app.on('exit', () => (exited = true));
try {
  const health = await wait('its gateway to answer', () => get('/api/health'), 120);
  say(`Conch ${health.serverVersion} answered in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
  await proveHere();
  const background = await get('/api/background');
  if (background?.running !== 'app')
    throw new Error(`The gateway doesn't know the app started it: ${JSON.stringify(background)}`);
  const page = await fetch(address).then((r) => r.text());
  if (!page.includes('<div id="root">')) throw new Error('The gateway doesn’t serve the web app.');
  say('It knows it runs in the app, and serves the web app.');
} finally {
  app.kill();
  await wait('the app to stop', () => exited, 30).catch(() => undefined);
}
await wait('its gateway to stop with it', async () => !(await get('/api/health')), 30);
say('The app stopped, and its gateway with it.');
rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
