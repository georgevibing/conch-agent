import { createServer, request as httpRequest, type Server } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect as tlsConnect } from 'node:tls';

import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AddressListeners } from './listeners';
import { AddressProblemError } from './problems';
import { leafFor } from './testing';

const NAME = 'conch.example.com';

interface Answer {
  status: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

function get(
  kind: 'http' | 'https',
  port: number,
  path: string,
  host = NAME,
  method = 'GET',
  body?: string,
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = (kind === 'https' ? httpsRequest : httpRequest)(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: { host },
        ...(kind === 'https' && { rejectUnauthorized: false, servername: NAME }),
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (text += chunk));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: text, headers: res.headers }),
        );
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

describe('AddressListeners', () => {
  let app: FastifyInstance;
  let listeners: AddressListeners;
  let door: Server | undefined;
  const challenges = new Map<string, string>();
  const checks = new Map<string, string>();

  beforeEach(async () => {
    app = Fastify();
    await app.register(websocket);
    app.get('/api/who', (request) => ({
      protocol: request.protocol,
      remote: request.socket.remoteAddress,
      host: request.headers.host,
    }));
    app.get('/ws', { websocket: true }, (socket) => socket.send('hello'));
    await app.listen({ host: '127.0.0.1', port: 0 });
    challenges.clear();
    checks.clear();
    listeners = new AddressListeners(app.server, {
      name: () => NAME,
      httpsPort: 0,
      httpPort: 0,
      host: '127.0.0.1',
      challenges,
      checks,
      door: () => {
        const address = door?.address();
        return address && typeof address === 'object' ? address.port : undefined;
      },
      holder: async () => 'nginx (process 42)',
    });
  });

  afterEach(async () => {
    await listeners.stop();
    await app.close();
    await new Promise<void>((resolve) => (door ? door.close(() => resolve()) : resolve()));
    door = undefined;
  });

  it('hands HTTPS requests to the gateway, as HTTPS from the client', async () => {
    await listeners.startHttps(await leafFor(NAME));
    const answer = await get('https', listeners.ports().https ?? 0, '/api/who');
    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.body)).toEqual({ protocol: 'https', remote: '127.0.0.1', host: NAME });
  });

  it('refuses any other name before the gateway sees it', async () => {
    await listeners.startHttps(await leafFor(NAME));
    const answer = await get('https', listeners.ports().https ?? 0, '/api/who', 'evil.example.net');
    expect(answer.status).toBe(421);
  });

  it('hands WebSocket upgrades to the gateway', async () => {
    await listeners.startHttps(await leafFor(NAME));
    const port = listeners.ports().https ?? 0;
    const head = await new Promise<string>((resolve, reject) => {
      const socket = tlsConnect(
        { host: '127.0.0.1', port, servername: NAME, rejectUnauthorized: false },
        () =>
          socket.write(
            [
              'GET /ws HTTP/1.1',
              `Host: ${NAME}`,
              'Upgrade: websocket',
              'Connection: Upgrade',
              'Sec-WebSocket-Version: 13',
              'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
              '',
              '',
            ].join('\r\n'),
          ),
      );
      socket.once('data', (data) => {
        resolve(data.toString());
        socket.destroy();
      });
      socket.on('error', reject);
    });
    expect(head).toMatch(/^HTTP\/1\.1 101/);
  });

  it('stops promptly with a WebSocket still open, and ends it', async () => {
    await listeners.startHttps(await leafFor(NAME));
    const port = listeners.ports().https ?? 0;
    const socket = tlsConnect({
      host: '127.0.0.1',
      port,
      servername: NAME,
      rejectUnauthorized: false,
    });
    await new Promise<void>((resolve) => socket.once('secureConnect', () => resolve()));
    socket.write(
      [
        'GET /ws HTTP/1.1',
        `Host: ${NAME}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Sec-WebSocket-Version: 13',
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
        '',
        '',
      ].join('\r\n'),
    );
    await new Promise((resolve) => socket.once('data', resolve));
    const closed = new Promise((resolve) => socket.once('close', resolve));
    const stopped = await Promise.race([
      listeners.stop().then(() => 'stopped'),
      new Promise((resolve) => setTimeout(() => resolve('hung'), 3000)),
    ]);
    expect(stopped).toBe('stopped');
    await closed;
  });

  it('swaps a renewed certificate in without a restart', async () => {
    await listeners.startHttps(await leafFor(NAME));
    const port = listeners.ports().https ?? 0;
    const fingerprint = () =>
      new Promise<string>((resolve, reject) => {
        const socket = tlsConnect(
          { host: '127.0.0.1', port, servername: NAME, rejectUnauthorized: false },
          () => {
            resolve(socket.getPeerCertificate().fingerprint256);
            socket.destroy();
          },
        );
        socket.on('error', reject);
      });
    const before = await fingerprint();
    listeners.updateCertificate(await leafFor(NAME));
    expect(await fingerprint()).not.toBe(before);
    expect(listeners.ports().https).toBe(port);
  });

  it('sends the door’s path to the door, never to the gateway', async () => {
    await listeners.startHttps(await leafFor(NAME));
    const port = listeners.ports().https ?? 0;
    expect((await get('https', port, '/conch/hooks/abc')).status).toBe(404);
    door = createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(`${req.method} ${req.url} ${req.headers['x-forwarded-proto']} ${body}`);
      });
    });
    await new Promise<void>((resolve) => door?.listen(0, '127.0.0.1', resolve));
    const answer = await get('https', port, '/conch/hooks/abc?x=1', NAME, 'POST', 'hi');
    expect(answer.body).toBe('POST /conch/hooks/abc?x=1 https hi');
    // Only the door's own path: a look-alike goes to the gateway.
    expect((await get('https', port, '/conchy')).status).toBe(404);
  });

  it('answers Let’s Encrypt’s challenge and Conch’s own check on port 80', async () => {
    await listeners.startHttp();
    const port = listeners.ports().http ?? 0;
    challenges.set('tok_1', 'tok_1.thumb');
    checks.set('nonce1', 'secret-answer');
    expect(await get('http', port, '/.well-known/acme-challenge/tok_1')).toMatchObject({
      status: 200,
      body: 'tok_1.thumb',
    });
    expect((await get('http', port, '/.well-known/acme-challenge/other')).status).toBe(404);
    expect((await get('http', port, '/.well-known/conch-check/nonce1')).body).toBe('secret-answer');
  });

  it('sends everything else on port 80 to HTTPS, for its own name only', async () => {
    await listeners.startHttp();
    const port = listeners.ports().http ?? 0;
    const moved = await get('http', port, '/chats?id=1');
    expect(moved.status).toBe(301);
    // The test's HTTPS port is 0 (any), so it's written out.
    expect(moved.headers.location).toBe(`https://${NAME}:0/chats?id=1`);
    expect((await get('http', port, '/', 'evil.example.net')).status).toBe(421);
    // Nothing of the app or its API answers on plain HTTP.
    expect((await get('http', port, '/api/who')).status).toBe(301);
  });

  it('says who holds a port that’s taken', async () => {
    const taken = createServer();
    await new Promise<void>((resolve) => taken.listen(0, '127.0.0.1', resolve));
    const address = taken.address();
    const port = address && typeof address === 'object' ? address.port : 0;
    const other = new AddressListeners(app.server, {
      name: () => NAME,
      httpsPort: 0,
      httpPort: port,
      host: '127.0.0.1',
      challenges,
      checks,
      holder: async () => 'nginx (process 42)',
    });
    const error = await other.startHttp().catch((e: unknown) => e);
    taken.close();
    expect(error).toBeInstanceOf(AddressProblemError);
    expect((error as AddressProblemError).problem).toMatchObject({
      kind: 'ports-taken',
      message: expect.stringMatching(/^Nginx \(process 42\) is already answering on port/),
    });
  });
});
