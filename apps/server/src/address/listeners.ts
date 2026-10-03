/**
 * The two listeners of an address of your own (ADR 0064), beside the
 * gateway's own loopback one:
 *
 * - **HTTPS** (`CONCH_HTTPS_PORT`, 443): TLS 1.2 or newer with the address's
 *   certificate. Every request and WebSocket upgrade is handed to the
 *   gateway's own server, so every guard in `registerSecurity` applies
 *   unchanged, and the socket it sees is the client's (never loopback). The
 *   public door's path (ADR 0045) is the one exception: it goes to the door's
 *   own listener and never reaches the gateway.
 * - **HTTP** (`CONCH_HTTP_PORT`, 80): Let's Encrypt's `http-01` answers,
 *   Conch's own reachability check, and a permanent redirect to `https://`.
 *   No app, no API, no WebSocket.
 */
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';
import type { Duplex } from 'node:stream';

import { DOOR_PATH } from '../channels/door';
import { whoHolds } from '../port';
import { AddressProblemError } from './problems';
import type { StoredCertificate } from './store';

export interface ListenerOptions {
  /** The address being served now (it can change while running). */
  name: () => string | undefined;
  httpsPort: number;
  httpPort: number;
  /** Where to listen: every address (the default) or one (tests). */
  host?: string;
  /** `http-01` answers by token, filled by the ACME client while a challenge is out. */
  challenges: Map<string, string>;
  /** Conch's own reachability check: nonce → what to answer. */
  checks: Map<string, string>;
  /** The public door's port on loopback, when it's listening (ADR 0045). */
  door?: () => number | undefined;
  /** Who holds a port that's taken, in words (tests leave it out). */
  holder?: (port: number) => Promise<string | undefined>;
}

const TLS = { minVersion: 'TLSv1.2' as const, handshakeTimeout: 10_000 };

function hostOf(header: string | undefined): string | undefined {
  if (!header) return undefined;
  try {
    return new URL(`http://${header}`).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function plain(res: ServerResponse, status: number, text: string) {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(text);
}

const isDoorPath = (url: string | undefined) =>
  url !== undefined &&
  (url === DOOR_PATH || url.startsWith(`${DOOR_PATH}/`) || url.startsWith(`${DOOR_PATH}?`));

export class AddressListeners {
  #http?: Server;
  #https?: HttpsServer;
  /**
   * Sockets handed to the gateway as WebSocket upgrades. The server lets go of
   * them, so closing it never ends them: stop() does, or turning the address off
   * would wait for the last page to close.
   */
  readonly #upgraded = new Set<Duplex>();

  constructor(
    /** The gateway's own server (Fastify's `app.server`). */
    private readonly gateway: Server,
    private readonly options: ListenerOptions,
  ) {}

  get listening(): { http: boolean; https: boolean } {
    return { http: Boolean(this.#http?.listening), https: Boolean(this.#https?.listening) };
  }

  /** The ports really bound (a test asks for 0 and gets a free one). */
  ports(): { http?: number; https?: number } {
    const port = (server?: Server | HttpsServer) => {
      const address = server?.address();
      return address && typeof address === 'object' ? address.port : undefined;
    };
    return { http: port(this.#http), https: port(this.#https) };
  }

  /** Port 80: needed before there's a certificate, to get one. */
  async startHttp(): Promise<void> {
    if (this.#http?.listening) return;
    const server = createHttpServer((req, res) => this.#plainHttp(req, res));
    await this.#listen(server, this.options.httpPort);
    this.#http = server;
  }

  /** Port 443, with this certificate; called again with a new one, it's swapped in place. */
  async startHttps(cert: StoredCertificate): Promise<void> {
    if (this.#https?.listening) {
      this.#https.setSecureContext({ ...TLS, cert: cert.certPem, key: cert.keyPem });
      return;
    }
    const server = createHttpsServer({ ...TLS, cert: cert.certPem, key: cert.keyPem });
    server.on('request', (req: IncomingMessage, res: ServerResponse) => this.#secure(req, res));
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (!this.#ours(req) || isDoorPath(req.url)) {
        socket.end('HTTP/1.1 421 Misdirected Request\r\nconnection: close\r\n\r\n');
        return;
      }
      this.#upgraded.add(socket);
      socket.once('close', () => this.#upgraded.delete(socket));
      this.gateway.emit('upgrade', req, socket, head);
    });
    // A client that never finishes its handshake is dropped, not kept.
    server.on('tlsClientError', (_error, socket) => socket.destroy());
    await this.#listen(server, this.options.httpsPort);
    this.#https = server;
  }

  /** A new certificate, without a restart or a dropped connection. */
  updateCertificate(cert: StoredCertificate): void {
    this.#https?.setSecureContext({ ...TLS, cert: cert.certPem, key: cert.keyPem });
  }

  async stop(): Promise<void> {
    const close = (server?: Server | HttpsServer) =>
      new Promise<void>((resolve) => {
        if (!server?.listening) return resolve();
        server.close(() => resolve());
        server.closeAllConnections();
      });
    for (const socket of this.#upgraded) socket.destroy();
    this.#upgraded.clear();
    await Promise.all([close(this.#http), close(this.#https)]);
    this.#http = undefined;
    this.#https = undefined;
  }

  #ours(req: IncomingMessage): boolean {
    const name = this.options.name();
    return name !== undefined && hostOf(req.headers.host) === name;
  }

  #secure(req: IncomingMessage, res: ServerResponse) {
    if (!this.#ours(req)) return plain(res, 421, 'This server doesn’t answer to that name.');
    if (isDoorPath(req.url)) return this.#door(req, res);
    this.gateway.emit('request', req, res);
  }

  /** The public door's path, sent to the door and nowhere else. */
  #door(req: IncomingMessage, res: ServerResponse) {
    const port = this.options.door?.();
    if (!port) return plain(res, 404, 'Not found.');
    const upstream = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method: req.method,
        path: req.url,
        headers: { ...req.headers, 'x-forwarded-proto': 'https' },
      },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(res);
      },
    );
    upstream.on('error', () => {
      if (!res.headersSent) plain(res, 502, 'The door isn’t answering right now.');
      else res.destroy();
    });
    req.pipe(upstream);
  }

  #plainHttp(req: IncomingMessage, res: ServerResponse) {
    const url = req.url ?? '/';
    const acme = /^\/\.well-known\/acme-challenge\/([A-Za-z0-9_-]+)$/.exec(url);
    if (acme) {
      const answer = acme[1] && this.options.challenges.get(acme[1]);
      return answer ? plain(res, 200, answer) : plain(res, 404, 'Not found.');
    }
    const check = /^\/\.well-known\/conch-check\/([A-Za-z0-9_-]+)$/.exec(url);
    if (check) {
      const answer = check[1] && this.options.checks.get(check[1]);
      return answer ? plain(res, 200, answer) : plain(res, 404, 'Not found.');
    }
    const name = this.options.name();
    if (!name || !this.#ours(req))
      return plain(res, 421, 'This server doesn’t answer to that name.');
    const port = this.options.httpsPort === 443 ? '' : `:${this.options.httpsPort}`;
    res.writeHead(301, { location: `https://${name}${port}${url.startsWith('/') ? url : '/'}` });
    res.end();
  }

  async #listen(server: Server | HttpsServer, port: number): Promise<void> {
    const attempt = (host: string) =>
      new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
          server.off('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          server.off('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen({ port, host, ...(host === '::' && { ipv6Only: false }) });
      });
    try {
      if (this.options.host) await attempt(this.options.host);
      else
        await attempt('::').catch(async (error: NodeJS.ErrnoException) => {
          // No IPv6 on this computer: every IPv4 address will do.
          if (error.code !== 'EAFNOSUPPORT' && error.code !== 'EADDRNOTAVAIL') throw error;
          await attempt('0.0.0.0');
        });
    } catch (error) {
      throw await this.#problem(error as NodeJS.ErrnoException, port);
    }
  }

  async #problem(error: NodeJS.ErrnoException, port: number): Promise<Error> {
    if (error.code === 'EACCES')
      return new AddressProblemError({
        kind: 'ports-privilege',
        message: `Conch isn’t allowed to answer on port ${port} yet. On Linux that takes one command, once.`,
      });
    if (error.code === 'EADDRINUSE') {
      const holder = await (this.options.holder ?? whoHolds)(port).catch(() => undefined);
      return new AddressProblemError({
        kind: 'ports-taken',
        message: `${holder ? `${holder[0]?.toUpperCase()}${holder.slice(1)} is` : 'Another program is'} already answering on port ${port}. If it’s a web server you run, put Conch behind it (docs/REVERSE_PROXY.md); otherwise stop it and try again.`,
      });
    }
    return error;
  }
}
