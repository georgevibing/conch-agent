import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';

import { guardMockServer } from './guard';

interface Socket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  readyState: number;
  on(event: 'message', listener: (raw: Buffer) => void): void;
  on(event: 'close', listener: () => void): void;
}

export interface MockQqSent {
  id: string;
  /** A person's openid, or `g:` and a group's. */
  to: string;
  msgType: number;
  text: string;
  /** Replying to a message (`msg_id`) or an event (`event_id`), with its `msg_seq`. */
  reply?: { field: string; id: string; seq: number };
  buttons?: { label: string; data: string }[];
  media?: { type: number; size: number; name?: string };
}

/**
 * A pretend QQ bot platform for tests, e2e and `pnpm dev:mock`: the access
 * token, the WebSocket gateway (Hello, Identify, heartbeats, Resume, op 7 and
 * op 9, close codes), the v2 message and file APIs, and interactions.
 *
 * `say()`, `press()` and `befriend()` speak for the person; `buttons = false`
 * is a bot QQ hasn't opened custom buttons to.
 */
export class MockQq {
  static readonly APP_ID = '102' + '345678';
  static readonly APP_SECRET = 'MockQqAppSecret0123456789abcdef';
  static readonly OWNER = 'A1B2C3D4E5F60718293A4B5C6D7E8F90';
  static readonly STRANGER = 'FFEEDDCCBBAA99887766554433221100';
  static readonly MEMBER = '0011223344556677889900AABBCCDDEE';
  static readonly GROUP = 'GROUP00112233445566778899AABBCCDD';

  #app?: FastifyInstance;
  #sockets = new Set<Socket>();
  #seq = 0;
  #sessions = new Map<string, number>();
  #files = new Map<string, { type: number; size: number; name?: string }>();
  base = '';
  readonly sent: MockQqSent[] = [];
  readonly acked: string[] = [];
  readonly identifies: number[] = [];
  readonly resumes: string[] = [];
  heartbeats = 0;
  connections = 0;
  secret = MockQq.APP_SECRET;
  /** Custom buttons are opened to bots by invitation; this one has them. */
  buttons = true;

  async start(port = 0): Promise<string> {
    const app = Fastify({ logger: false, requestTimeout: 20_000, bodyLimit: 30 * 1024 * 1024 });
    this.#app = app;
    guardMockServer(app);
    await app.register(fastifyWebsocket);
    let token = `mock-qq-${randomBytes(4).toString('hex')}`;
    const authorised = (header: unknown, reply: FastifyReply) => {
      if (header === `QQBot ${token}`) return true;
      void reply.code(401).send({ code: 11244, message: 'token invalid' });
      return false;
    };
    app.post('/app/getAppAccessToken', (request) => {
      const body = (request.body ?? {}) as { appId?: string; clientSecret?: string };
      if (body.appId !== MockQq.APP_ID) return { code: 10004, message: '机器人不存在' };
      if (body.clientSecret !== this.secret)
        return { code: 100016, message: 'invalid appid or secret' };
      return { access_token: token, expires_in: '7200' };
    });
    app.get('/users/@me', (request, reply) => {
      if (!authorised(request.headers.authorization, reply)) return reply;
      return { id: '144115218676895000', username: 'Conch', avatar: '' };
    });
    app.get('/gateway/bot', (request, reply) => {
      if (!authorised(request.headers.authorization, reply)) return reply;
      return {
        url: `${this.base.replace('http', 'ws')}/websocket`,
        shards: 1,
        session_start_limit: {
          total: 1000,
          remaining: 999,
          reset_after: 86_400_000,
          max_concurrency: 1,
        },
      };
    });
    app.get('/websocket', { websocket: true }, (socket) =>
      this.#socket(socket as unknown as Socket, () => token),
    );
    const send =
      (to: string) =>
      (request: { body: unknown; headers: { authorization?: string } }, reply: FastifyReply) => {
        if (!authorised(request.headers.authorization, reply)) return reply;
        const body = request.body as {
          msg_type: number;
          content?: string;
          markdown?: { content?: string };
          keyboard?: {
            content?: {
              rows?: {
                buttons?: { render_data?: { label?: string }; action?: { data?: string } }[];
              }[];
            };
          };
          media?: { file_info?: string };
          msg_id?: string;
          event_id?: string;
          msg_seq?: number;
        };
        if (body.keyboard && !this.buttons)
          return reply.code(400).send({ code: 304003, message: 'keyboard not allowed' });
        const id = `ROBOT1.0_${randomBytes(8).toString('hex')}`;
        const field = body.msg_id ? 'msg_id' : body.event_id ? 'event_id' : undefined;
        this.sent.push({
          id,
          to,
          msgType: body.msg_type,
          text: body.markdown?.content ?? body.content ?? '',
          ...(field && {
            reply: { field, id: String(body.msg_id ?? body.event_id), seq: body.msg_seq ?? 0 },
          }),
          ...(body.keyboard && {
            buttons: (body.keyboard.content?.rows ?? []).flatMap((r) =>
              (r.buttons ?? []).map((b) => ({
                label: b.render_data?.label ?? '',
                data: b.action?.data ?? '',
              })),
            ),
          }),
          ...(body.media?.file_info && {
            media: this.#files.get(body.media.file_info) ?? { type: 0, size: 0 },
          }),
        });
        return { id, timestamp: new Date().toISOString() };
      };
    app.post('/v2/users/:openid/messages', (request, reply) =>
      send((request.params as { openid: string }).openid)(request, reply),
    );
    app.post('/v2/groups/:gid/messages', (request, reply) =>
      send(`g:${(request.params as { gid: string }).gid}`)(request, reply),
    );
    const upload = (
      request: { body: unknown; headers: { authorization?: string } },
      reply: FastifyReply,
    ) => {
      if (!authorised(request.headers.authorization, reply)) return reply;
      const body = request.body as { file_type: number; file_data?: string; file_name?: string };
      const info = `fi_${randomBytes(6).toString('hex')}`;
      this.#files.set(info, {
        type: body.file_type,
        size: Buffer.from(body.file_data ?? '', 'base64').length,
        ...(body.file_name && { name: body.file_name }),
      });
      return { file_uuid: info, file_info: info, ttl: 3600 };
    };
    app.post('/v2/users/:openid/files', upload);
    app.post('/v2/groups/:gid/files', upload);
    app.put('/interactions/:id', (request, reply) => {
      if (!authorised(request.headers.authorization, reply)) return reply;
      this.acked.push((request.params as { id: string }).id);
      return {};
    });
    app.get('/media/:name', (request, reply) => {
      const name = (request.params as { name: string }).name;
      if (name.endsWith('.wav'))
        return reply.type('audio/wav').send(Buffer.from('RIFF....WAVEmock'));
      return reply.type('image/jpeg').send(Buffer.from('ffd8ffe000104a464946', 'hex'));
    });
    app.post<{ Params: { action: string } }>('/__control/:action', async (request) => {
      const body = (request.body ?? {}) as Record<string, string | boolean | undefined>;
      switch (request.params.action) {
        case 'say':
          return {
            id: this.say(String(body.text ?? ''), {
              from: body.stranger === true ? MockQq.STRANGER : MockQq.OWNER,
              group: body.group === true,
            }),
          };
        case 'befriend':
          this.befriend(body.stranger === true ? MockQq.STRANGER : MockQq.OWNER);
          return { ok: true };
        case 'press':
          return { id: this.press(String(body.data ?? ''), String(body.message_id ?? '')) };
        case 'sent':
          return this.sent;
        default:
          return { ok: false };
      }
    });
    /** The token changes (QQ issues a new one): the gateway refuses the old with 4004. */
    this.rotate = () => {
      token = `mock-qq-${randomBytes(4).toString('hex')}`;
    };
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

  rotate: () => void = () => undefined;

  async stop() {
    for (const socket of this.#sockets) socket.close(1001);
    await this.#app?.close();
  }

  #socket(socket: Socket, token: () => string) {
    this.connections++;
    socket.on('close', () => this.#sockets.delete(socket));
    const send = (payload: object) =>
      socket.readyState === 1 && socket.send(JSON.stringify(payload));
    send({ op: 10, d: { heartbeat_interval: 30_000 } });
    socket.on('message', (raw) => {
      const payload = JSON.parse(raw.toString()) as {
        op: number;
        d?: Record<string, unknown> | number | null;
      };
      const d = (payload.d ?? {}) as Record<string, unknown>;
      if (payload.op === 1) {
        this.heartbeats++;
        send({ op: 11 });
        return;
      }
      if (payload.op === 2) {
        if (d.token !== `QQBot ${token()}`) return socket.close(4004, 'invalid token');
        this.identifies.push(Number(d.intents));
        const session = randomBytes(8).toString('hex');
        this.#sessions.set(session, this.#seq);
        this.#sockets.add(socket);
        send({
          op: 0,
          s: ++this.#seq,
          t: 'READY',
          d: {
            version: 1,
            session_id: session,
            user: { id: '1', username: 'Conch', bot: true },
            shard: [0, 0],
          },
        });
        return;
      }
      if (payload.op === 6) {
        if (d.token !== `QQBot ${token()}`) return socket.close(4004, 'invalid token');
        const session = String(d.session_id ?? '');
        if (!this.#sessions.has(session)) {
          send({ op: 9, d: false });
          return;
        }
        this.resumes.push(session);
        this.#sockets.add(socket);
        send({ op: 0, s: ++this.#seq, t: 'RESUMED', d: '' });
      }
    });
  }

  #dispatch(t: string, d: object, id = `${t}:${randomBytes(6).toString('hex')}`) {
    const text = JSON.stringify({ op: 0, s: ++this.#seq, t, id, d });
    for (const socket of this.#sockets) if (socket.readyState === 1) socket.send(text);
    return id;
  }

  /** A message from the person: privately, or @mentioning the bot in a group. */
  say(
    text: string,
    options: { from?: string; group?: boolean; attachments?: object[]; id?: string } = {},
  ): string {
    const from = options.from ?? MockQq.OWNER;
    const id = options.id ?? `ROBOT1.0_${randomBytes(8).toString('hex')}`;
    this.#dispatch(options.group ? 'GROUP_AT_MESSAGE_CREATE' : 'C2C_MESSAGE_CREATE', {
      id,
      author: options.group
        ? { id: from, member_openid: from, union_openid: `U${from}` }
        : { id: from, user_openid: from, union_openid: `U${from}` },
      content: options.group ? ` ${text}` : text,
      timestamp: new Date().toISOString(),
      ...(options.group && { group_id: MockQq.GROUP, group_openid: MockQq.GROUP }),
      message_scene: { source: 'default', ext: [`msg_idx=REFIDX_${this.#seq}`] },
      ...(options.attachments && { attachments: options.attachments }),
    });
    return id;
  }

  /** The person adds the bot as a friend. */
  befriend(from = MockQq.OWNER) {
    return this.#dispatch('FRIEND_ADD', { openid: from, timestamp: Math.floor(Date.now() / 1000) });
  }

  /** Pressing a button under one of the bot's messages. */
  press(data: string, messageId: string, from = MockQq.OWNER, group = false): string {
    const id = randomBytes(8).toString('hex');
    this.#dispatch('INTERACTION_CREATE', {
      id,
      type: 11,
      scene: group ? 'group' : 'c2c',
      chat_type: group ? 1 : 2,
      ...(group
        ? { group_openid: MockQq.GROUP, group_member_openid: from }
        : { user_openid: from }),
      data: { type: 11, resolved: { button_data: data, button_id: '1', message_id: messageId } },
      application_id: MockQq.APP_ID,
      version: 1,
    });
    return id;
  }

  /** QQ asks the bot to reconnect (op 7), or ends the session (op 9). */
  reconnect() {
    for (const socket of this.#sockets) socket.send(JSON.stringify({ op: 7 }));
  }

  forgetSessions() {
    this.#sessions.clear();
  }

  drop(code = 4000) {
    for (const socket of this.#sockets) socket.close(code);
  }
}
