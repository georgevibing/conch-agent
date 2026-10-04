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

export interface MockMattermostPost {
  id: string;
  channel_id: string;
  message: string;
  edited?: boolean;
}

const id = () => randomBytes(13).toString('hex').slice(0, 26);

/**
 * A pretend Mattermost server for tests, E2E and `pnpm dev:mock`: the REST
 * calls Conch makes, and the WebSocket that takes the token in its
 * `authentication_challenge`, says `hello` and sends `posted` events, as
 * Mattermost 10 does.
 *
 * Tests speak for people with `say()` (a direct message) and `sayIn()` (a
 * channel, optionally mentioning the bot), and break things with
 * `revoke()` and `drop()`.
 */
export class MockMattermost {
  #app?: FastifyInstance;
  #sockets = new Set<Socket>();
  base = '';
  readonly sent: MockMattermostPost[] = [];
  readonly reactions: string[] = [];

  // Written in two parts, so secret scanners never take it for a real one.
  static readonly TOKEN = 'mockmattermost' + 'botoken0001';
  static readonly BOT = { id: 'b0tb0tb0tb0tb0tb0tb0tb0tb0', username: 'conch', is_bot: true };
  static readonly OWNER = {
    id: 'ada0ada0ada0ada0ada0ada0ad',
    username: 'ada',
    first_name: 'Ada',
    last_name: 'Lovelace',
  };
  static readonly MEMBER = { id: 'b0bb0bb0bb0bb0bb0bb0bb0bb0', username: 'bob', first_name: 'Bob' };
  static readonly TOWN = { id: 'town0town0town0town0town0t', display_name: 'Town Square' };
  readonly tokens = new Set<string>([MockMattermost.TOKEN]);

  dmOf(userId: string) {
    return `dm__${userId}`.slice(0, 26).padEnd(26, '0');
  }

  async start(port = 0): Promise<string> {
    const app = Fastify({ logger: false });
    this.#app = app;
    await app.register(fastifyWebsocket);
    app.addHook('onRequest', async (request, reply) => {
      if (request.url.startsWith('/api/v4/websocket') || request.url.startsWith('/__control'))
        return;
      const token = request.headers.authorization?.replace(/^Bearer /, '');
      if (!token || !this.tokens.has(token))
        return reply.code(401).send({
          id: 'api.context.session_expired.app_error',
          message: 'Invalid or expired session, please login again.',
        });
    });
    const users = [MockMattermost.BOT, MockMattermost.OWNER, MockMattermost.MEMBER];
    app.get('/api/v4/users/me', () => ({ ...MockMattermost.BOT, first_name: '', last_name: '' }));
    app.get<{ Params: { id: string } }>('/api/v4/users/:id', (request, reply) => {
      const user = users.find((u) => u.id === request.params.id);
      return user ?? reply.code(404).send({});
    });
    app.get<{ Params: { id: string } }>('/api/v4/channels/:id', (request) =>
      request.params.id === MockMattermost.TOWN.id
        ? { ...MockMattermost.TOWN, name: 'town-square', type: 'O' }
        : { id: request.params.id, display_name: '', type: 'D' },
    );
    app.put('/api/v4/bots/:id', () => ({}));
    app.post('/api/v4/channels/direct', (request) => {
      const [, other] = request.body as [string, string];
      return { id: this.dmOf(other), type: 'D' };
    });
    app.post('/api/v4/posts', (request) => {
      const body = request.body as { channel_id: string; message: string };
      const post = { id: id(), channel_id: body.channel_id, message: body.message };
      this.sent.push(post);
      return { ...post, user_id: MockMattermost.BOT.id };
    });
    app.put<{ Params: { id: string } }>('/api/v4/posts/:id/patch', (request) => {
      const body = request.body as { message: string };
      const old = this.sent.find((p) => p.id === request.params.id);
      this.sent.push({
        id: request.params.id,
        channel_id: old?.channel_id ?? '',
        message: body.message,
        edited: true,
      });
      return {};
    });
    app.post('/api/v4/reactions', (request) => {
      this.reactions.push(`+${(request.body as { emoji_name: string }).emoji_name}`);
      return {};
    });
    app.delete('/api/v4/users/:u/posts/:p/reactions/:e', (request) => {
      this.reactions.push(`-${(request.params as { e: string }).e}`);
      return {};
    });
    app.get('/api/v4/websocket', { websocket: true }, (socket) =>
      this.#socket(socket as unknown as Socket),
    );
    app.post<{ Params: { action: string } }>('/__control/:action', (request) => {
      const body = (request.body ?? {}) as { text?: string; mention?: boolean };
      if (request.params.action === 'say') this.say(body.text ?? '');
      else if (request.params.action === 'say-in')
        this.sayIn(body.text ?? '', MockMattermost.OWNER, body.mention !== false);
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
    for (const socket of this.#sockets) socket.close(1001);
    await this.#app?.close();
  }

  #socket(socket: Socket) {
    let authed = false;
    socket.on('message', (raw) => {
      const frame = JSON.parse(raw.toString()) as {
        seq?: number;
        action?: string;
        data?: { token?: string };
      };
      if (frame.action === 'authentication_challenge') {
        if (!this.tokens.has(frame.data?.token ?? '')) {
          socket.send(
            JSON.stringify({
              status: 'FAIL',
              seq_reply: frame.seq,
              error: { id: 'api.web_socket_router.not_authenticated.app_error' },
            }),
          );
          return;
        }
        authed = true;
        this.#sockets.add(socket);
        socket.send(JSON.stringify({ status: 'OK', seq_reply: frame.seq }));
        socket.send(
          JSON.stringify({ event: 'hello', data: { server_version: '10.11.0' }, seq: 0 }),
        );
        return;
      }
      if (authed && frame.action === 'ping')
        socket.send(JSON.stringify({ status: 'OK', seq_reply: frame.seq, data: { text: 'pong' } }));
    });
    socket.on('close', () => this.#sockets.delete(socket));
  }

  #posted(post: Record<string, unknown>, data: Record<string, unknown>) {
    const frame = JSON.stringify({
      event: 'posted',
      data: { post: JSON.stringify(post), ...data },
      broadcast: { channel_id: post.channel_id },
      seq: Date.now(),
    });
    for (const socket of this.#sockets) if (socket.readyState === 1) socket.send(frame);
  }

  // ── The person's side ──────────────────────────────────────────────────

  /** A direct message to the bot. */
  say(text: string, from: { id: string; username: string } = MockMattermost.OWNER) {
    this.#posted(
      { id: id(), channel_id: this.dmOf(from.id), user_id: from.id, message: text, type: '' },
      {
        channel_type: 'D',
        channel_display_name: `@${from.username}`,
        sender_name: `@${from.username}`,
      },
    );
  }

  /** A message in Town Square, mentioning the bot (as Mattermost writes it) or not. */
  sayIn(
    text: string,
    from: { id: string; username: string } = MockMattermost.OWNER,
    mention = true,
  ) {
    this.#posted(
      {
        id: id(),
        channel_id: MockMattermost.TOWN.id,
        user_id: from.id,
        message: mention ? `@conch ${text}` : text,
        type: '',
      },
      {
        channel_type: 'O',
        channel_display_name: MockMattermost.TOWN.display_name,
        sender_name: `@${from.username}`,
        ...(mention && { mentions: JSON.stringify([MockMattermost.BOT.id]) }),
      },
    );
  }

  last(channelId = this.dmOf(MockMattermost.OWNER.id)) {
    return this.sent.filter((p) => p.channel_id === channelId).at(-1);
  }

  // ── Breaking it on purpose ─────────────────────────────────────────────

  revoke() {
    this.tokens.clear();
    for (const socket of this.#sockets) socket.close(1000);
  }

  drop() {
    for (const socket of this.#sockets) socket.close(4000);
  }
}
