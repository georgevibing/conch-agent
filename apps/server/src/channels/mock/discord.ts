import type { AddressInfo } from 'node:net';

import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';

interface MockUser {
  id: string;
  username: string;
  global_name?: string;
}

export interface MockDiscordMessage {
  channel_id: string;
  id: string;
  content: string;
  buttons: { label: string; custom_id: string; style: number }[];
  edited?: boolean;
}

interface Socket {
  send(data: string): void;
  close(code?: number): void;
  readyState: number;
}

/**
 * A pretend Discord for tests, E2E and `pnpm dev:mock`: the REST calls Conch
 * makes and a Gateway (WebSocket) that says Hello, takes Identify and Resume,
 * answers heartbeats and dispatches messages and button presses.
 *
 * Tests speak for the person with `say()` / `press()`, add the bot to a
 * server with `join()`, and break things: `revoke()`, `drop()` (the
 * connection closes and should resume), `silence()` (heartbeats stop being
 * answered: a zombie connection), `endpoint` (an Interactions URL left set).
 */
export class MockDiscord {
  #app?: FastifyInstance;
  #sockets = new Set<Socket>();
  #seq = 0;
  #nextId = 5000;
  #silent = false;
  base = '';
  static readonly TOKEN = 'MTEwMDAwMDAwMDAwMDAwMDAw.' + 'GmockA.mockmockmockmockmockmockmockmockmock12';
  static readonly OWNER: MockUser = { id: '424242', username: 'ada', global_name: 'Ada Lovelace' };
  readonly tokens = new Set([MockDiscord.TOKEN]);
  readonly bot: MockUser = {
    id: '1100000000000000000',
    username: 'conch_bot',
    global_name: 'Conch',
  };
  readonly sent: MockDiscordMessage[] = [];
  readonly calls: { method: string; path: string; body: unknown }[] = [];
  identifies = 0;
  resumes = 0;
  guilds = 0;
  /** An Interactions Endpoint URL left in the app's settings. */
  endpoint = '';
  /** How often the gateway asks for heartbeats (ms). */
  heartbeatMs = 1000;

  async start(port = 0): Promise<string> {
    const app = Fastify({ logger: false, routerOptions: { ignoreTrailingSlash: true } });
    this.#app = app;
    await app.register(fastifyWebsocket);
    app.addHook('onRequest', async (request, reply) => {
      if (request.url.startsWith('/gateway') || request.url.startsWith('/__control')) return;
      const token = request.headers.authorization?.replace(/^Bot /, '');
      if (!token || !this.tokens.has(token))
        return reply.code(401).send({ message: '401: Unauthorized', code: 0 });
    });
    app.addHook('preHandler', async (request) => {
      if (!request.url.startsWith('/api/')) return;
      this.calls.push({
        method: request.method,
        path: request.url.replace('/api/v10', ''),
        body: request.body,
      });
    });

    app.get('/api/v10/users/@me', () => ({ ...this.bot, avatar: null, bot: true }));
    app.get('/api/v10/applications/@me', () => ({
      id: this.bot.id,
      name: 'Conch',
      approximate_guild_count: this.guilds,
      interactions_endpoint_url: this.endpoint || null,
    }));
    app.patch('/api/v10/applications/@me', (request) => {
      const body = request.body as { interactions_endpoint_url?: string };
      if (body.interactions_endpoint_url === '') this.endpoint = '';
      return {};
    });
    app.get('/api/v10/gateway/bot', () => ({ url: `${this.base.replace('http', 'ws')}/gateway` }));
    app.post('/api/v10/users/@me/channels', (request) => ({
      id: `dm${(request.body as { recipient_id: string }).recipient_id}`,
      type: 1,
    }));
    app.post<{ Params: { id: string } }>('/api/v10/channels/:id/messages', (request) => {
      const body = request.body as {
        content: string;
        components?: { components: MockDiscordMessage['buttons'] }[];
      };
      const message: MockDiscordMessage = {
        channel_id: request.params.id,
        id: String(this.#nextId++),
        content: body.content,
        buttons: body.components?.flatMap((row) => row.components) ?? [],
      };
      this.sent.push(message);
      return message;
    });
    app.patch<{ Params: { id: string; mid: string } }>(
      '/api/v10/channels/:id/messages/:mid',
      (request) => {
        const body = request.body as {
          content: string;
          components?: { components: MockDiscordMessage['buttons'] }[];
        };
        const message: MockDiscordMessage = {
          channel_id: request.params.id,
          id: request.params.mid,
          content: body.content,
          buttons: body.components?.flatMap((row) => row.components) ?? [],
          edited: true,
        };
        this.sent.push(message);
        return message;
      },
    );
    app.post('/api/v10/channels/:id/typing', (_request, reply) => reply.code(204).send());
    app.post('/api/v10/interactions/:id/:token/callback', (_request, reply) =>
      reply.code(204).send(),
    );

    app.get('/gateway', { websocket: true }, (socket) =>
      this.#gateway(socket as unknown as WebSocketLike),
    );

    app.post('/__control/:action', (request) => {
      const body = (request.body ?? {}) as { text?: string; data?: string; messageId?: string };
      const action = (request.params as { action: string }).action;
      if (action === 'say') this.say(body.text ?? '');
      else if (action === 'press') this.press(body.data ?? '', body.messageId ?? '');
      else if (action === 'join') this.join();
      else if (action === 'drop') this.drop();
      else if (action === 'revoke') this.revoke();
      else if (action === 'sent') return this.sent;
      return { ok: true };
    });

    await app.listen({ port, host: '127.0.0.1' });
    this.base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    return this.base;
  }

  async stop() {
    for (const socket of this.#sockets) socket.close(1001);
    await this.#app?.close();
  }

  get api() {
    return `${this.base}/api/v10`;
  }

  // ── The person's side ──────────────────────────────────────────────────

  say(text: string, from: MockUser = MockDiscord.OWNER, extra: Record<string, unknown> = {}) {
    this.#dispatch('MESSAGE_CREATE', {
      id: String(this.#nextId++),
      channel_id: `dm${from.id}`,
      author: from,
      content: text,
      attachments: [],
      ...extra,
    });
  }

  press(customId: string, messageId: string, from: MockUser = MockDiscord.OWNER) {
    this.#dispatch('INTERACTION_CREATE', {
      id: String(this.#nextId++),
      token: 'itoken',
      type: 3,
      channel_id: `dm${from.id}`,
      user: from,
      message: { id: messageId },
      data: { custom_id: customId, component_type: 2 },
    });
  }

  /** The bot is added to a server. */
  join() {
    this.guilds++;
    this.#dispatch('GUILD_CREATE', { id: `guild${this.guilds}`, name: 'My server' });
  }

  last(channelId = `dm${MockDiscord.OWNER.id}`) {
    return this.sent.filter((m) => m.channel_id === channelId).at(-1);
  }

  // ── Breaking it on purpose ─────────────────────────────────────────────

  revoke() {
    this.tokens.clear();
    for (const socket of this.#sockets) socket.close(4004);
  }

  /** The connection drops; Conch should resume it. */
  drop() {
    for (const socket of this.#sockets) socket.close(4000);
  }

  /** Stop answering heartbeats: the connection looks alive but isn't. */
  silence(isSilent = true) {
    this.#silent = isSilent;
  }

  // ── The Gateway ────────────────────────────────────────────────────────

  #dispatch(t: string, d: unknown) {
    const frame = JSON.stringify({ op: 0, t, s: ++this.#seq, d });
    for (const socket of this.#sockets) if (socket.readyState === 1) socket.send(frame);
  }

  #gateway(socket: WebSocketLike) {
    this.#sockets.add(socket);
    socket.on('close', () => this.#sockets.delete(socket));
    socket.send(JSON.stringify({ op: 10, d: { heartbeat_interval: this.heartbeatMs } }));
    socket.on('message', (raw: Buffer) => {
      const frame = JSON.parse(raw.toString()) as { op: number; d: Record<string, unknown> };
      if (frame.op === 1) {
        if (!this.#silent) socket.send(JSON.stringify({ op: 11 }));
      } else if (frame.op === 2) {
        if (!this.tokens.has(String(frame.d.token))) return socket.close(4004);
        this.identifies++;
        socket.send(
          JSON.stringify({
            op: 0,
            t: 'READY',
            s: ++this.#seq,
            d: {
              v: 10,
              session_id: `session${this.identifies}`,
              resume_gateway_url: `${this.base.replace('http', 'ws')}/gateway`,
              user: this.bot,
              guilds: Array.from({ length: this.guilds }, (_, i) => ({
                id: `guild${i + 1}`,
                unavailable: true,
              })),
              application: { id: this.bot.id, flags: 0 },
            },
          }),
        );
      } else if (frame.op === 6) {
        this.resumes++;
        socket.send(JSON.stringify({ op: 0, t: 'RESUMED', s: ++this.#seq, d: {} }));
      }
    });
  }
}

interface WebSocketLike extends Socket {
  on(event: 'message', listener: (raw: Buffer) => void): void;
  on(event: 'close', listener: () => void): void;
}
