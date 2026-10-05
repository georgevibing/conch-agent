import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';

interface Socket {
  send(data: string): void;
  close(code?: number): void;
  on(event: 'message', listener: (raw: Buffer) => void): void;
  on(event: 'close', listener: () => void): void;
  readyState: number;
}

export interface MockRocketMessage {
  id: string;
  rid: string;
  text: string;
  edited?: boolean;
}

const id17 = () => randomBytes(12).toString('base64url').replace(/[-_]/g, 'x').slice(0, 17);

/**
 * A pretend Rocket.Chat for tests, E2E and `pnpm dev:mock`: the REST calls
 * Conch makes, and the realtime API (DDP on `/websocket`): `connect`,
 * `login` with a resume token, `stream-room-messages` `__my_messages__`, and
 * pings, as Rocket.Chat 7 does.
 */
export class MockRocketChat {
  // Written in two parts, so secret scanners never take it for a real one.
  static readonly TOKEN = 'mockRocketChatPersonalAccess' + 'Token0123456789abc';
  static readonly BOT = { _id: 'B0tB0tB0tB0tB0tB0', username: 'conch', name: 'Conch' };
  static readonly OWNER = { _id: 'AdaAdaAdaAdaAdaAd', username: 'ada', name: 'Ada Lovelace' };
  static readonly MEMBER = { _id: 'BobBobBobBobBobBo', username: 'bob', name: 'Bob' };
  static readonly GENERAL = { _id: 'GENERAL', t: 'c', name: 'general', fname: 'general' };

  #app?: FastifyInstance;
  #sockets = new Set<Socket>();
  #subscriptions = new Map<Socket, () => void>();
  holdSubscriptions = false;

  get waitingSubscriptions() {
    return this.#subscriptions.size;
  }

  releaseSubscriptions() {
    this.holdSubscriptions = false;
    for (const ready of this.#subscriptions.values()) ready();
    this.#subscriptions.clear();
  }
  base = '';
  readonly sent: MockRocketMessage[] = [];
  readonly tokens = new Set<string>([MockRocketChat.TOKEN]);

  dmOf(userId: string) {
    return `${MockRocketChat.BOT._id}${userId}`;
  }

  async start(port = 0): Promise<string> {
    const app = Fastify({ logger: false });
    this.#app = app;
    await app.register(fastifyWebsocket);
    const users = [MockRocketChat.BOT, MockRocketChat.OWNER, MockRocketChat.MEMBER];
    app.addHook('onRequest', async (request, reply) => {
      if (request.url.startsWith('/websocket') || request.url.startsWith('/__control')) return;
      if (
        request.headers['x-user-id'] !== MockRocketChat.BOT._id ||
        !this.tokens.has(String(request.headers['x-auth-token'] ?? ''))
      )
        return reply
          .code(401)
          .send({ status: 'error', message: 'You must be logged in to do this.' });
    });
    app.get('/api/v1/me', () => ({ ...MockRocketChat.BOT, roles: ['bot'], success: true }));
    app.get<{ Querystring: { roomId: string } }>('/api/v1/rooms.info', (request) => ({
      room:
        request.query.roomId === MockRocketChat.GENERAL._id
          ? MockRocketChat.GENERAL
          : { _id: request.query.roomId, t: 'd' },
      success: true,
    }));
    app.get<{ Querystring: { userId: string } }>('/api/v1/users.info', (request) => ({
      user: users.find((u) => u._id === request.query.userId),
      success: true,
    }));
    app.post('/api/v1/im.create', (request) => {
      const user = users.find(
        (u) => u.username === (request.body as { username: string }).username,
      );
      return { room: { rid: this.dmOf(user?._id ?? 'nobody'), t: 'd' }, success: true };
    });
    app.post('/api/v1/chat.postMessage', (request) => {
      const body = request.body as { roomId: string; text: string };
      const message = { id: id17(), rid: body.roomId, text: body.text };
      this.sent.push(message);
      return { message: { _id: message.id, rid: body.roomId, msg: body.text }, success: true };
    });
    app.post('/api/v1/chat.update', (request) => {
      const body = request.body as { roomId: string; msgId: string; text: string };
      this.sent.push({ id: body.msgId, rid: body.roomId, text: body.text, edited: true });
      return { success: true };
    });
    app.post('/api/v1/chat.react', () => ({ success: true }));
    app.get('/websocket', { websocket: true }, (socket) =>
      this.#socket(socket as unknown as Socket),
    );
    app.post<{ Params: { action: string } }>('/__control/:action', (request) => {
      const body = (request.body ?? {}) as { text?: string };
      if (request.params.action === 'say') this.say(body.text ?? '');
      else if (request.params.action === 'say-in') this.sayIn(body.text ?? '');
      else if (request.params.action === 'sent') return this.sent;
      return { ok: true };
    });
    try {
      await app.listen({ port, host: '127.0.0.1' });
    } catch (error) {
      await app.close().catch(() => undefined);
      if (port === 0) throw error;
      return this.start(0);
    }
    this.base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    return this.base;
  }

  async stop() {
    for (const socket of this.#subscriptions.keys()) socket.close(1001);
    this.#subscriptions.clear();
    for (const socket of this.#sockets) socket.close(1001);
    await this.#app?.close();
  }

  #socket(socket: Socket) {
    socket.on('message', (raw) => {
      const frame = JSON.parse(raw.toString()) as {
        msg?: string;
        id?: string;
        method?: string;
        name?: string;
        params?: unknown[];
      };
      if (frame.msg === 'connect') socket.send(JSON.stringify({ msg: 'connected', session: 's1' }));
      else if (frame.msg === 'method' && frame.method === 'login') {
        const resume = (frame.params?.[0] as { resume?: string } | undefined)?.resume ?? '';
        if (!this.tokens.has(resume)) {
          socket.send(
            JSON.stringify({
              msg: 'result',
              id: frame.id,
              error: {
                error: 403,
                reason: 'You’ve been logged out by the server. Please log in again.',
              },
            }),
          );
          return;
        }
        socket.send(
          JSON.stringify({ msg: 'result', id: frame.id, result: { id: MockRocketChat.BOT._id } }),
        );
      } else if (frame.msg === 'sub' && frame.name === 'stream-room-messages') {
        const ready = () => {
          if (socket.readyState !== 1) return;
          this.#sockets.add(socket);
          socket.send(JSON.stringify({ msg: 'ready', subs: [frame.id] }));
        };
        if (this.holdSubscriptions) this.#subscriptions.set(socket, ready);
        else ready();
      } else if (frame.msg === 'method')
        socket.send(JSON.stringify({ msg: 'result', id: frame.id, result: null }));
    });
    socket.on('close', () => {
      this.#sockets.delete(socket);
      this.#subscriptions.delete(socket);
    });
  }

  #stream(message: Record<string, unknown>) {
    const frame = JSON.stringify({
      msg: 'changed',
      collection: 'stream-room-messages',
      id: 'id',
      fields: { eventName: '__my_messages__', args: [message, {}] },
    });
    for (const socket of this.#sockets) if (socket.readyState === 1) socket.send(frame);
  }

  // ── The person's side ──────────────────────────────────────────────────

  /** A direct message to the bot. */
  say(text: string, from = MockRocketChat.OWNER) {
    this.#stream({
      _id: id17(),
      rid: this.dmOf(from._id),
      msg: text,
      u: from,
      mentions: [],
      ts: { $date: Date.now() },
    });
  }

  /** A message in #general, mentioning the bot as Rocket.Chat writes it, or not. */
  sayIn(text: string, from = MockRocketChat.OWNER, mention = true) {
    this.#stream({
      _id: id17(),
      rid: MockRocketChat.GENERAL._id,
      msg: mention ? `@conch ${text}` : text,
      u: from,
      mentions: mention ? [{ _id: MockRocketChat.BOT._id, username: 'conch' }] : [],
      ts: { $date: Date.now() },
    });
  }

  last(rid = this.dmOf(MockRocketChat.OWNER._id)) {
    return this.sent.filter((m) => m.rid === rid).at(-1);
  }

  revoke() {
    this.tokens.clear();
    for (const socket of this.#sockets) socket.close(1000);
  }

  drop() {
    for (const socket of this.#sockets) socket.close(4000);
  }
}
