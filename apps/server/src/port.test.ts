import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer, type Server } from 'node:http';
import { createServer as createTcpServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { portIsExplicit } from './config';
import {
  choosePort,
  forgetGateway,
  holderFromLsof,
  nameFromTasklist,
  pidFromNetstat,
  probePort,
  recordGateway,
  runningGateway,
  takenMessage,
  type PortProbe,
} from './port';

/** A fake machine: which ports are held, and by what. */
const machine =
  (held: Record<number, 'conch' | 'other'>) =>
  async (port: number): Promise<PortProbe> =>
    held[port] ?? 'free';

describe('choosePort', () => {
  it('starts on the port when it’s free', async () => {
    expect(await choosePort({ port: 4317, explicit: false, probe: machine({}) })).toEqual({
      kind: 'use',
      port: 4317,
    });
  });

  it('opens the Conch that’s already there instead of starting another', async () => {
    const probe = machine({ 4317: 'conch' });
    expect(await choosePort({ port: 4317, explicit: false, probe })).toEqual({
      kind: 'running',
      port: 4317,
    });
    // Even when the port was chosen on purpose: it's the same Conch.
    expect(await choosePort({ port: 4317, explicit: true, probe })).toEqual({
      kind: 'running',
      port: 4317,
    });
  });

  it('finds this folder’s Conch where it moved to, rather than starting a second one', async () => {
    const probe = machine({ 4317: 'other', 4318: 'conch' });
    expect(await choosePort({ port: 4317, explicit: false, recorded: 4318, probe })).toEqual({
      kind: 'running',
      port: 4318,
    });
    // A record left by a Conch that's gone is ignored.
    expect(
      await choosePort({ port: 4317, explicit: false, recorded: 4318, probe: machine({}) }),
    ).toEqual({ kind: 'use', port: 4317 });
  });

  it('moves past another program to the next free port, skipping other Conches', async () => {
    const probe = machine({ 4317: 'other', 4318: 'conch', 4319: 'other' });
    expect(await choosePort({ port: 4317, explicit: false, probe })).toEqual({
      kind: 'use',
      port: 4320,
      busy: 4317,
    });
  });

  it('never moves a port chosen on purpose, and suggests a free one', async () => {
    const probe = machine({ 5000: 'other' });
    expect(await choosePort({ port: 5000, explicit: true, probe })).toEqual({
      kind: 'taken',
      port: 5000,
      next: 5001,
      explicit: true,
    });
  });

  it('gives up plainly when every port nearby is taken', async () => {
    const held = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [4317 + i, 'other' as const]),
    );
    expect(await choosePort({ port: 4317, explicit: false, probe: machine(held) })).toEqual({
      kind: 'taken',
      port: 4317,
      next: undefined,
      explicit: false,
    });
  });
});

describe('takenMessage', () => {
  it('says what holds the port and the one thing to do', () => {
    expect(
      takenMessage(
        { kind: 'taken', port: 5000, next: 5001, explicit: true },
        'python.exe (process 42)',
      ),
    ).toBe(
      'Port 5000 is in use by python.exe (process 42), and CONCH_PORT asks for exactly that port.\n' +
        'Close that program, or set CONCH_PORT=5001 (that one is free).',
    );
    expect(takenMessage({ kind: 'taken', port: 4317, explicit: false })).toMatch(
      /^Ports 4317–4337 are all in use \(4317 by another program\)\./,
    );
  });
});

describe('portIsExplicit', () => {
  it('is only on purpose when CONCH_PORT is set', () => {
    expect(portIsExplicit({})).toBe(false);
    expect(portIsExplicit({ CONCH_PORT: ' ' })).toBe(false);
    expect(portIsExplicit({ CONCH_PORT: '4317' })).toBe(true);
  });
});

describe('probePort', () => {
  const servers: { close(): unknown }[] = [];
  afterEach(() => {
    for (const server of servers.splice(0)) server.close();
  });

  const listening = async (server: Server | ReturnType<typeof createTcpServer>) => {
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return (server.address() as AddressInfo).port;
  };

  const http = (body: unknown, status = 200) =>
    createHttpServer((_req, res) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    });

  it('tells a free port, a Conch and another program apart', async () => {
    const conch = await listening(http({ ok: true, serverVersion: '0.2.0', protocolVersion: 6 }));
    const lookalike = await listening(http({ ok: true, version: '1.0' }));
    const refusing = await listening(http({ error: 'no' }, 404));
    const silent = await listening(createTcpServer((socket) => socket.end()));
    expect(await probePort('127.0.0.1', conch)).toBe('conch');
    expect(await probePort('127.0.0.1', lookalike)).toBe('other');
    expect(await probePort('127.0.0.1', refusing)).toBe('other');
    expect(await probePort('127.0.0.1', silent, 500)).toBe('other');

    const free = await listening(createTcpServer());
    servers.pop()?.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await probePort('127.0.0.1', free)).toBe('free');
  });
});

describe('what holds a port', () => {
  it('reads netstat and tasklist on Windows', () => {
    const netstat = [
      'Active Connections',
      '',
      '  Proto  Local Address          Foreign Address        State           PID',
      '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1188',
      '  TCP    127.0.0.1:43170        0.0.0.0:0              LISTENING       77',
      '  TCP    127.0.0.1:4317         127.0.0.1:50000        ESTABLISHED     99',
      '  TCP    127.0.0.1:4317         0.0.0.0:0              LISTENING       4242',
    ].join('\r\n');
    expect(pidFromNetstat(netstat, 4317)).toBe(4242);
    expect(pidFromNetstat(netstat, 5000)).toBeUndefined();
    expect(nameFromTasklist('"node.exe","4242","Console","1","80,532 K"\r\n')).toBe('node.exe');
    expect(nameFromTasklist('INFO: No tasks are running which match the specified criteria.')).toBe(
      undefined,
    );
  });

  it('reads lsof elsewhere', () => {
    expect(holderFromLsof('p4242\ncnode\nf23\n')).toEqual({ pid: 4242, name: 'node' });
    expect(holderFromLsof('')).toBeUndefined();
  });
});

describe('the gateway record', () => {
  it('says where this folder’s Conch runs, only while it’s alive', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-port-'));
    expect(await runningGateway(home)).toBeUndefined();
    const record = { pid: process.pid, host: '127.0.0.1', port: 4318, startedAt: 1 };
    await recordGateway(home, record);
    expect(await runningGateway(home)).toEqual(record);

    // Someone else's record is left alone; ours is removed on the way out.
    forgetGateway(home, process.pid + 1);
    expect(await runningGateway(home)).toEqual(record);
    forgetGateway(home);
    expect(await runningGateway(home)).toBeUndefined();

    // A process that's gone, or a damaged file, is no Conch.
    await recordGateway(home, { ...record, pid: 2 ** 31 - 2 });
    expect(await runningGateway(home)).toBeUndefined();
    await writeFile(join(home, 'gateway.json'), '{ nope');
    expect(await runningGateway(home)).toBeUndefined();
    expect(await readFile(join(home, 'gateway.json'), 'utf8')).toBe('{ nope');
  });
});
