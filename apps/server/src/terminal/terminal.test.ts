import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix, win32 } from 'node:path';

import { TerminalInfo, TerminalStatus, TerminalTicket } from '@conch/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app';
import { hereInit, onThisComputer } from '../test/here';
import { loadConfig } from '../config';
import { Services } from '../services';
import { findShells, pickShell } from './shells';

// Password hashing is deliberately slow, and shells take a moment to start.
vi.setConfig({ testTimeout: 30_000 });

const PASSWORD = 'purple otters juggle at dawn';
const REMOTE = { remoteAddress: '192.168.1.20', host: 'conch.example' };
const windows = process.platform === 'win32';
/** A shell every test machine has, and how to print with it. */
const SHELL = windows ? 'powershell' : 'sh';
const say = (expr: string) => (windows ? `Write-Output "${expr}"\r` : `echo "${expr}"\r`);
const envVar = (name: string) => (windows ? `$env:${name}` : `$${name}`);

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await cleanup?.();
  cleanup = undefined;
});

async function setup() {
  const home = await mkdtemp(join(tmpdir(), 'conch-terminal-'));
  const services = new Services(
    loadConfig({
      CONCH_HOME: home,
      CONCH_ENGINE: 'mock',
      CONCH_LOG_LEVEL: 'silent',
      CONCH_WEB_DIST: '/nonexistent',
      CONCH_ALLOWED_HOSTS: 'conch.example',
    }),
  );
  const app = onThisComputer(await buildApp(services), services);
  cleanup = async () => {
    await app.close();
    services.search.close();
    await rm(home, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
  };
  return { app, services, home };
}

type App = Awaited<ReturnType<typeof setup>>['app'];

const cookieOf = (res: { headers: Record<string, unknown> }) => {
  const raw = res.headers['set-cookie'];
  return (Array.isArray(raw) ? String(raw[0]) : String(raw)).split(';')[0] ?? '';
};

const remote = (
  app: App,
  url: string,
  init: { method?: string; cookie?: string; payload?: object } = {},
) =>
  app.inject({
    method: (init.method ?? 'GET') as 'GET',
    url,
    remoteAddress: REMOTE.remoteAddress,
    headers: { host: REMOTE.host, ...(init.cookie && { cookie: init.cookie }) },
    ...(init.payload && { payload: init.payload }),
  });

/** Turn a password on, then sign in from another device. Returns both devices' cookies. */
async function phone(app: App, local?: string) {
  if (!local) {
    const set = await app.inject({
      method: 'PUT',
      url: '/api/access/password',
      payload: { username: 'ada', password: PASSWORD },
    });
    local = cookieOf(set);
  }
  const res = await remote(app, '/api/auth/sign-in', {
    method: 'POST',
    payload: { with: 'password', username: 'ada', password: PASSWORD },
  });
  expect(res.statusCode).toBe(200);
  return { cookie: cookieOf(res), local };
}

/** A request from this computer, signed in. */
const here = (app: App, local: string, url: string, method = 'GET', payload?: object) =>
  app.inject({
    method: method as 'GET',
    url,
    headers: { cookie: local },
    ...(payload && { payload }),
  });

/** Attach over a real WebSocket and collect what the shell prints. */
async function attach(app: App, id: string) {
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('not listening');
  const { ticket } = TerminalTicket.parse(
    (await app.inject({ method: 'POST', url: `/api/terminal/${id}/ticket` })).json(),
  );
  const ws = new WebSocket(
    `ws://localhost:${address.port}/api/terminal/live?ticket=${ticket}`,
    hereInit(app),
  );
  ws.binaryType = 'arraybuffer';
  let output = '';
  const events: { type: string }[] = [];
  ws.addEventListener('message', (m) => {
    if (typeof m.data === 'string') events.push(JSON.parse(m.data) as { type: string });
    else output += new TextDecoder().decode(m.data as ArrayBuffer);
  });
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  return {
    ws,
    ticket,
    output: () => output,
    events,
    type: (text: string) => ws.send(JSON.stringify({ type: 'input', data: text })),
    closed: () =>
      new Promise<number>((resolve) => ws.addEventListener('close', (e) => resolve(e.code))),
  };
}

describe('shells', () => {
  it('finds PowerShell 7 first on Windows, then Windows PowerShell and cmd', () => {
    const pwsh = win32.join('C:\\Program Files', 'PowerShell', '7', 'pwsh.exe');
    const ps = win32.join('C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const cmd = win32.join('C:\\Windows', 'System32', 'cmd.exe');
    const shells = findShells({
      platform: 'win32',
      env: { ProgramFiles: 'C:\\Program Files', SystemRoot: 'C:\\Windows', PATH: '' },
      exists: (p) => [pwsh, ps, cmd].includes(p),
    });
    expect(shells.map((s) => s.id)).toEqual(['pwsh', 'powershell', 'cmd']);
    expect(shells[0]?.safeArgs).toContain('-NoProfile');
  });

  it('puts your login shell first on macOS and Linux', () => {
    const exists = (p: string) => ['/bin/zsh', '/bin/bash', '/bin/sh'].includes(p);
    const shells = findShells({
      platform: 'darwin',
      env: { SHELL: '/bin/bash', PATH: '/bin' },
      exists,
    });
    expect(shells.map((s) => s.id)).toEqual(['bash', 'zsh', 'sh']);
    expect(shells.find((s) => s.id === 'zsh')?.safeArgs).toEqual(['-f']);
    expect(pickShell(shells, 'zsh')?.path).toBe(posix.join('/bin', 'zsh'));
    expect(pickShell(shells, 'fish')?.id).toBe('bash');
  });
});

describe('the terminal', () => {
  it('opens a real shell here, streams it, and replays it to the next viewer', async () => {
    const { app } = await setup();
    await app.listen({ host: '127.0.0.1', port: 0 });
    const created = await app.inject({
      method: 'POST',
      url: '/api/terminal',
      payload: { shell: SHELL },
    });
    expect(created.statusCode).toBe(201);
    const info = TerminalInfo.parse(created.json());
    expect(info).toMatchObject({ status: 'running', openedFrom: 'this-computer' });

    const first = await attach(app, info.id);
    await expect.poll(() => first.events[0]).toMatchObject({ type: 'ready' });
    first.type(say('hello-from-conch'));
    await expect.poll(first.output, { timeout: 15_000 }).toContain('hello-from-conch');
    first.ws.send(JSON.stringify({ type: 'resize', cols: 120, rows: 40 }));
    first.ws.close();

    // Someone else (a reload, another tab) sees what happened, then carries on.
    const second = await attach(app, info.id);
    await expect.poll(second.output, { timeout: 10_000 }).toContain('hello-from-conch');
    second.type(windows ? 'exit\r' : 'exit\r');
    await expect
      .poll(() => second.events.some((e) => e.type === 'exit'), { timeout: 15_000 })
      .toBe(true);
    second.ws.close();
  });

  it('never hands Conch’s own configuration to the shell', async () => {
    process.env.CONCH_PROBE_SECRET = 'do-not-leak';
    const { app } = await setup();
    try {
      await app.listen({ host: '127.0.0.1', port: 0 });
      const info = TerminalInfo.parse(
        (
          await app.inject({ method: 'POST', url: '/api/terminal', payload: { shell: SHELL } })
        ).json(),
      );
      const term = await attach(app, info.id);
      term.type(say(`probe[${envVar('CONCH_PROBE_SECRET')}] program[${envVar('TERM_PROGRAM')}]`));
      await expect.poll(term.output, { timeout: 15_000 }).toMatch(/probe\[\] program\[conch\]/);
      expect(term.output()).not.toContain('do-not-leak');
      term.ws.close();
    } finally {
      delete process.env.CONCH_PROBE_SECRET;
    }
  });

  it('needs a fresh ticket from a POST to attach; each works once, for its owner only', async () => {
    const { app } = await setup();
    await app.listen({ host: '127.0.0.1', port: 0 });
    const info = TerminalInfo.parse(
      (
        await app.inject({ method: 'POST', url: '/api/terminal', payload: { shell: SHELL } })
      ).json(),
    );
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('not listening');
    const open = (query: string) => {
      const ws = new WebSocket(
        `ws://localhost:${address.port}/api/terminal/live${query}`,
        hereInit(app),
      );
      return new Promise<number>((resolve) => ws.addEventListener('close', (e) => resolve(e.code)));
    };
    expect(await open('')).toBe(1008);
    expect(await open('?ticket=guess')).toBe(1008);
    const term = await attach(app, info.id);
    term.ws.close();
    // The same ticket again: spent.
    expect(await open(`?ticket=${term.ticket}`)).toBe(1008);
  });

  it('refuses a socket from another site', async () => {
    const { app } = await setup();
    const res = await app.inject({
      url: '/api/terminal/live?ticket=x',
      headers: {
        host: 'localhost:4317',
        origin: 'http://localhost:3000',
        upgrade: 'websocket',
        connection: 'upgrade',
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('keeps other devices out until you allow it, and asks them to confirm every time', async () => {
    const { app } = await setup();
    const { cookie, local } = await phone(app);
    const status = TerminalStatus.parse((await remote(app, '/api/terminal', { cookie })).json());
    expect(status).toMatchObject({ available: false, remote: true });
    const refused = await remote(app, '/api/terminal', { method: 'POST', cookie, payload: {} });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toBe('terminal-remote-off');

    // Turning it on from there needs a recent password: ten minutes on, it isn't.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60_000);
    const later = await remote(app, '/api/terminal/settings', {
      method: 'PATCH',
      cookie,
      payload: { allowRemote: true },
    });
    expect(later.json().error).toBe('verify-required');
    vi.restoreAllMocks();

    // Turned on (here), a fresh sign-in there may open one…
    expect(
      (await here(app, local, '/api/terminal/settings', 'PATCH', { allowRemote: true })).statusCode,
    ).toBe(200);
    const opened = await remote(app, '/api/terminal', {
      method: 'POST',
      cookie,
      payload: { shell: SHELL },
    });
    expect(opened.statusCode).toBe(201);
    const info = TerminalInfo.parse(opened.json());
    expect(info.openedFrom).toBe('another-device');
    // …but not once that sign-in is stale: every attach asks again.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60_000);
    const stale = await remote(app, `/api/terminal/${info.id}/ticket`, { method: 'POST', cookie });
    expect(stale.json().error).toBe('verify-required');
  });

  it('ends a device’s terminals when it’s signed out, and all remote ones when that’s turned off', async () => {
    const { app } = await setup();
    const { cookie, local } = await phone(app);
    await here(app, local, '/api/terminal/settings', 'PATCH', { allowRemote: true });
    const open = async (res: Promise<{ json(): unknown }>) =>
      TerminalInfo.parse((await res).json());
    const theirs = await open(
      remote(app, '/api/terminal', { method: 'POST', cookie, payload: { shell: SHELL } }),
    );
    const mine = await open(here(app, local, '/api/terminal', 'POST', { shell: SHELL }));
    const list = async () =>
      TerminalStatus.parse((await here(app, local, '/api/terminal')).json()).terminals.map(
        (t) => t.id,
      );
    expect(await list()).toEqual(expect.arrayContaining([theirs.id, mine.id]));

    // Sign the other device out from here.
    const access = (await here(app, local, '/api/access')).json() as {
      sessions: { id: string; current: boolean }[];
    };
    const other = access.sessions.find((s) => !s.current);
    expect(other).toBeDefined();
    await here(app, local, `/api/access/sessions/${other?.id}`, 'DELETE');
    expect(await list()).toEqual([mine.id]);

    // And turning remote access off ends every other device's terminals at once.
    const again = await phone(app, local);
    const second = await open(
      remote(app, '/api/terminal', {
        method: 'POST',
        cookie: again.cookie,
        payload: { shell: SHELL },
      }),
    );
    expect(await list()).toContain(second.id);
    await here(app, local, '/api/terminal/settings', 'PATCH', { allowRemote: false });
    expect(await list()).toEqual([mine.id]);
  });
});
