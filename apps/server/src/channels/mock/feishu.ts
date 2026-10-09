import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';

import { CONTROL, DATA, type FeishuFrame, decodeFrame, encodeFrame, header } from '../feishu-frame';
import { guardMockServer } from './guard';

interface Socket {
  send(data: Uint8Array): void;
  close(code?: number): void;
  readyState: number;
  on(event: 'message', listener: (raw: Buffer) => void): void;
  on(event: 'close', listener: () => void): void;
}

export interface MockFeishuSent {
  id: string;
  to: string;
  /** `open_id` (a private chat) or `chat_id` (a group). */
  as: string;
  type: string;
  /** The words: a post's `md`, a card's markdown. */
  text: string;
  /** A card's buttons, with what pressing each sends back. */
  buttons?: { label: string; value: string }[];
  /** Changed after it was sent (a card answered in place). */
  edited?: string;
  image?: { name: string; size: number };
  file?: { name: string; type: string; size: number };
}

/** What a card's JSON says, as a person would read it. */
function readCard(content: string): { text: string; buttons: { label: string; value: string }[] } {
  const card = JSON.parse(content) as {
    body?: {
      elements?: {
        tag?: string;
        content?: string;
        columns?: {
          elements?: {
            text?: { content?: string };
            behaviors?: { value?: { conch?: string } }[];
          }[];
        }[];
      }[];
    };
  };
  let text = '';
  const buttons: { label: string; value: string }[] = [];
  for (const element of card.body?.elements ?? []) {
    if (element.tag === 'markdown') text += element.content ?? '';
    for (const column of element.columns ?? [])
      for (const button of column.elements ?? [])
        buttons.push({
          label: button.text?.content ?? '',
          value: button.behaviors?.[0]?.value?.conch ?? '',
        });
  }
  return { text, buttons };
}

const postText = (content: string) => {
  const post = JSON.parse(content) as { zh_cn?: { content?: { text?: string }[][] } };
  return (post.zh_cn?.content ?? [])
    .flat()
    .map((e) => e.text ?? '')
    .join('');
};

/**
 * A pretend Feishu (and Lark: it's the same API) for tests, e2e and
 * `pnpm dev:mock`: the tenant token, the bot's info, the long connection's
 * endpoint and its WebSocket of protobuf frames (pings, events in parts,
 * card callbacks that wait for their answer), and the messages API.
 *
 * `say()`, `press()`, `enter()` and friends speak for the person;
 * `drop()` cuts the connection; `secret` changes when the person resets it.
 */
export class MockFeishu {
  static readonly APP_ID = 'cli_' + 'a1b2c3d4e5f60718';
  static readonly APP_SECRET = 'MockFeishuAppSecret0123456789abc';
  static readonly BOT_OPEN_ID = 'ou_bot0000000000000000000000000';
  static readonly OWNER = 'ou_ada00000000000000000000000000';
  static readonly STRANGER = 'ou_grace000000000000000000000000';
  static readonly MEMBER = 'ou_bob000000000000000000000000000';
  static readonly GROUP = 'oc_family00000000000000000000000';
  static readonly NAMES: Record<string, string> = {
    [MockFeishu.OWNER]: 'Ada Lovelace',
    [MockFeishu.STRANGER]: 'Grace Hopper',
    [MockFeishu.MEMBER]: 'Bob',
  };

  #app?: FastifyInstance;
  #sockets = new Set<Socket>();
  #seq = 1n;
  #uploads = new Map<string, { name: string; size: number; type: string }>();
  #pending = new Map<string, (answer: Record<string, unknown>) => void>();
  #devices = new Map<string, 'pending' | 'approved' | 'denied'>();
  base = '';
  readonly sent: MockFeishuSent[] = [];
  readonly reactions: { message: string; emoji: string; removed?: boolean }[] = [];
  /** Each data frame Conch answered, with what it said. */
  readonly acks: { messageId: string; code: number }[] = [];
  connections = 0;
  pings = 0;
  secret = MockFeishu.APP_SECRET;
  /** Send events in two parts (`sum` 2), as Feishu does with long ones. */
  split = false;

  async start(port = 0): Promise<string> {
    const app = Fastify({ logger: false, requestTimeout: 20_000, bodyLimit: 40 * 1024 * 1024 });
    this.#app = app;
    guardMockServer(app);
    await app.register(fastifyWebsocket);
    app.addContentTypeParser('multipart/form-data', { parseAs: 'buffer' }, (_request, body, done) =>
      done(null, body),
    );
    const token = `t-mock-${randomBytes(4).toString('hex')}`;
    const authorised = (auth: unknown, reply: FastifyReply) => {
      if (auth === `Bearer ${token}`) return true;
      void reply.send({ code: 99991663, msg: 'Invalid access token for authorization.' });
      return false;
    };
    app.post('/open-apis/auth/v3/tenant_access_token/internal', (request) => {
      const body = (request.body ?? {}) as { app_id?: string; app_secret?: string };
      if (!/^cli_[0-9a-z]{16}$/.test(body.app_id ?? ''))
        return { code: 10003, msg: 'invalid param' };
      if (body.app_id !== MockFeishu.APP_ID) return { code: 10014, msg: 'app id not exists' };
      if (body.app_secret !== this.secret) return { code: 10015, msg: 'app secret invalid' };
      return { code: 0, msg: 'ok', tenant_access_token: token, expire: 7200 };
    });
    app.get('/open-apis/bot/v3/info', (request, reply) => {
      if (!authorised(request.headers.authorization, reply)) return reply;
      return {
        code: 0,
        msg: 'ok',
        bot: {
          activate_status: 2,
          app_name: 'Conch',
          avatar_url: '',
          open_id: MockFeishu.BOT_OPEN_ID,
        },
      };
    });
    app.post('/callback/ws/endpoint', (request) => {
      const body = (request.body ?? {}) as { AppID?: string; AppSecret?: string };
      if (body.AppID !== MockFeishu.APP_ID || body.AppSecret !== this.secret)
        return { code: 1000040345, msg: 'app_id or app_secret is invalid', data: { URL: '' } };
      return {
        code: 0,
        msg: 'ok',
        data: {
          URL: `${this.base.replace('http', 'ws')}/ws?device_id=mock&service_id=7`,
          ClientConfig: {
            ReconnectCount: -1,
            ReconnectInterval: 120,
            ReconnectNonce: 1,
            PingInterval: 120,
          },
        },
      };
    });
    // Making an app by scanning a code (RFC 8628, as Feishu's registration does it).
    app.addContentTypeParser(
      'application/x-www-form-urlencoded',
      { parseAs: 'string' },
      (_request, body, done) => done(null, Object.fromEntries(new URLSearchParams(String(body)))),
    );
    app.post('/oauth/v1/app/registration', (request, reply) => {
      const form = (request.body ?? {}) as Record<string, string>;
      if (form.action === 'begin') {
        if (form.archetype !== 'PersonalAgent' || form.request_user_info !== 'open_id')
          return reply.code(400).send({ error: 'invalid_request' });
        const device = randomBytes(8).toString('hex');
        this.#devices.set(device, 'pending');
        return {
          device_code: device,
          user_code: 'ABCD-EFGH',
          verification_uri: `${this.base}/page/register`,
          verification_uri_complete: `${this.base}/page/register?user_code=ABCD-EFGH&device=${device}`,
          interval: 1,
          expires_in: 600,
        };
      }
      if (form.action === 'poll') {
        const status = this.#devices.get(form.device_code ?? '');
        if (!status) return reply.code(400).send({ error: 'expired_token' });
        if (status === 'pending') return reply.code(400).send({ error: 'authorization_pending' });
        if (status === 'denied') return reply.code(400).send({ error: 'access_denied' });
        this.#devices.delete(form.device_code ?? '');
        return {
          client_id: MockFeishu.APP_ID,
          client_secret: this.secret,
          user_info: { open_id: MockFeishu.OWNER, tenant_brand: 'feishu' },
        };
      }
      return reply.code(400).send({ error: 'unsupported' });
    });
    app.get('/ws', { websocket: true }, (socket) => this.#socket(socket as unknown as Socket));
    app.post('/open-apis/im/v1/messages', (request, reply) => {
      if (!authorised(request.headers.authorization, reply)) return reply;
      const as = (request.query as { receive_id_type?: string }).receive_id_type ?? '';
      const body = request.body as { receive_id: string; msg_type: string; content: string };
      const id = `om_${randomBytes(8).toString('hex')}`;
      const sent: MockFeishuSent = { id, to: body.receive_id, as, type: body.msg_type, text: '' };
      if (body.msg_type === 'post') sent.text = postText(body.content);
      else if (body.msg_type === 'interactive') Object.assign(sent, readCard(body.content));
      else if (body.msg_type === 'image') {
        const key = (JSON.parse(body.content) as { image_key: string }).image_key;
        const up = this.#uploads.get(key);
        if (!up) return { code: 230001, msg: 'invalid image_key' };
        sent.image = { name: up.name, size: up.size };
      } else if (body.msg_type === 'file') {
        const key = (JSON.parse(body.content) as { file_key: string }).file_key;
        const up = this.#uploads.get(key);
        if (!up) return { code: 230001, msg: 'invalid file_key' };
        sent.file = up;
      }
      this.sent.push(sent);
      return { code: 0, msg: 'ok', data: { message_id: id, chat_id: body.receive_id } };
    });
    const change = (
      request: { params: unknown; body: unknown; headers: { authorization?: string } },
      reply: FastifyReply,
    ) => {
      if (!authorised(request.headers.authorization, reply)) return reply;
      const id = (request.params as { id: string }).id;
      const body = request.body as { msg_type?: string; content: string };
      const message = this.sent.find((m) => m.id === id);
      if (!message) return { code: 230011, msg: 'message not found' };
      if (message.type === 'interactive') {
        const read = readCard(body.content);
        message.edited = read.text;
        message.buttons = read.buttons;
      } else message.edited = postText(body.content);
      return { code: 0, msg: 'ok', data: {} };
    };
    app.patch('/open-apis/im/v1/messages/:id', change);
    app.put('/open-apis/im/v1/messages/:id', change);
    app.get('/open-apis/im/v1/messages/:id', (request, reply) => {
      if (!authorised(request.headers.authorization, reply)) return reply;
      const id = (request.params as { id: string }).id;
      const mine = this.sent.find((m) => m.id === id);
      if (mine)
        return {
          code: 0,
          data: {
            items: [
              {
                sender: { id: MockFeishu.APP_ID, sender_type: 'app' },
                msg_type: 'text',
                body: { content: '{}' },
              },
            ],
          },
        };
      const theirs = this.#heard.get(id);
      if (!theirs) return { code: 230011, msg: 'message not found' };
      return {
        code: 0,
        data: {
          items: [
            {
              sender: { id: theirs.from, id_type: 'open_id', sender_type: 'user' },
              msg_type: 'text',
              body: { content: JSON.stringify({ text: theirs.text }) },
            },
          ],
        },
      };
    });
    app.post('/open-apis/im/v1/messages/:id/reactions', (request, reply) => {
      if (!authorised(request.headers.authorization, reply)) return reply;
      const emoji =
        (request.body as { reaction_type?: { emoji_type?: string } }).reaction_type?.emoji_type ??
        '';
      const message = (request.params as { id: string }).id;
      this.reactions.push({ message, emoji });
      return { code: 0, data: { reaction_id: `r_${this.reactions.length}` } };
    });
    app.delete('/open-apis/im/v1/messages/:id/reactions/:reaction', (request, reply) => {
      if (!authorised(request.headers.authorization, reply)) return reply;
      const n = Number((request.params as { reaction: string }).reaction.slice(2));
      const found = this.reactions[n - 1];
      if (found) found.removed = true;
      return { code: 0, data: {} };
    });
    const upload = async (body: Buffer, contentType: string, field: string) => {
      const form = await new Response(new Uint8Array(body), {
        headers: { 'content-type': contentType },
      }).formData();
      const file = form.get(field);
      if (!file || typeof file === 'string') return undefined;
      return { file, form };
    };
    app.post('/open-apis/im/v1/images', async (request, reply) => {
      if (!authorised(request.headers.authorization, reply)) return reply;
      const got = await upload(
        request.body as Buffer,
        String(request.headers['content-type']),
        'image',
      );
      if (!got || got.form.get('image_type') !== 'message')
        return { code: 234001, msg: 'invalid param' };
      if (got.file.size > 10 * 1024 * 1024) return { code: 234006, msg: 'image too large' };
      const key = `img_v3_${randomBytes(6).toString('hex')}`;
      this.#uploads.set(key, { name: got.file.name, size: got.file.size, type: 'image' });
      return { code: 0, data: { image_key: key } };
    });
    app.post('/open-apis/im/v1/files', async (request, reply) => {
      if (!authorised(request.headers.authorization, reply)) return reply;
      const got = await upload(
        request.body as Buffer,
        String(request.headers['content-type']),
        'file',
      );
      if (!got) return { code: 234001, msg: 'invalid param' };
      const key = `file_v3_${randomBytes(6).toString('hex')}`;
      this.#uploads.set(key, {
        name: String(got.form.get('file_name') ?? got.file.name),
        size: got.file.size,
        type: String(got.form.get('file_type') ?? ''),
      });
      return { code: 0, data: { file_key: key } };
    });
    app.get('/open-apis/im/v1/messages/:id/resources/:key', (request, reply) => {
      if (request.headers.authorization !== `Bearer ${token}`)
        return reply.send({ code: 99991663, msg: 'Invalid access token' });
      const { key } = request.params as { key: string };
      if (key.startsWith('voice'))
        return reply.type('audio/ogg').send(Buffer.from('OggS mock opus voice'));
      return reply
        .type('image/png')
        .header('content-disposition', 'attachment; filename="beach.png"')
        .send(Buffer.from('89504e470d0a1a0a', 'hex'));
    });
    app.get('/open-apis/contact/v3/users/:id', (request, reply) => {
      if (!authorised(request.headers.authorization, reply)) return reply;
      const name = MockFeishu.NAMES[(request.params as { id: string }).id];
      return name
        ? { code: 0, data: { user: { name } } }
        : { code: 41050, msg: 'no user authority' };
    });
    app.get('/open-apis/im/v1/chats/:id', (request, reply) => {
      if (!authorised(request.headers.authorization, reply)) return reply;
      return (request.params as { id: string }).id === MockFeishu.GROUP
        ? { code: 0, data: { name: 'Family' } }
        : { code: 232011, msg: 'chat not found' };
    });
    app.post<{ Params: { action: string } }>('/__control/:action', async (request) => {
      const body = (request.body ?? {}) as Record<string, string | boolean | undefined>;
      switch (request.params.action) {
        case 'say':
          return {
            message_id: this.say(String(body.text ?? ''), {
              from: body.stranger === true ? MockFeishu.STRANGER : MockFeishu.OWNER,
              ...(body.group === true && { group: true, mention: body.mention !== false }),
            }),
          };
        case 'enter':
          this.enter(body.stranger === true ? MockFeishu.STRANGER : MockFeishu.OWNER);
          return { ok: true };
        case 'press':
          return this.press(String(body.message_id ?? ''), String(body.value ?? ''));
        case 'scan':
          return { ok: this.scan(body.url ? String(body.url) : undefined, body.deny === true) };
        case 'sent':
          return this.sent;
        default:
          return { ok: false };
      }
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
    this.connections++;
    this.#sockets.add(socket);
    socket.on('close', () => this.#sockets.delete(socket));
    socket.on('message', (raw) => {
      const frame = decodeFrame(new Uint8Array(raw));
      if (!frame) return;
      if (frame.method === CONTROL && header(frame, 'type') === 'ping') {
        this.pings++;
        socket.send(
          encodeFrame({
            ...frame,
            headers: [['type', 'pong']],
            payload: new TextEncoder().encode(JSON.stringify({ PingInterval: 120 })),
          }),
        );
        return;
      }
      if (frame.method === DATA) {
        const id = header(frame, 'message_id') ?? '';
        const answer = JSON.parse(new TextDecoder().decode(frame.payload ?? new Uint8Array())) as {
          code: number;
          data?: string;
        };
        this.acks.push({ messageId: id, code: answer.code });
        const data = answer.data
          ? (JSON.parse(Buffer.from(answer.data, 'base64').toString('utf8')) as Record<
              string,
              unknown
            >)
          : {};
        this.#pending.get(id)?.(data);
        this.#pending.delete(id);
      }
    });
  }

  /** The connection drops (Feishu restarting, the network). */
  drop() {
    for (const socket of this.#sockets) socket.close(4000);
  }

  /** An event, as a data frame (in two parts when `split`); resolves with Conch's answer. */
  push(event: Record<string, unknown>, type = 'event'): Promise<Record<string, unknown>> {
    const id = randomBytes(8).toString('hex');
    const payload = new TextEncoder().encode(JSON.stringify(event));
    const parts = this.split ? [payload.subarray(0, 10), payload.subarray(10)] : [payload];
    const answered = new Promise<Record<string, unknown>>((resolve) =>
      this.#pending.set(id, resolve),
    );
    for (const [seq, part] of parts.entries()) {
      const frame: FeishuFrame = {
        seqId: this.#seq++,
        logId: 0n,
        service: 7,
        method: DATA,
        headers: [
          ['type', type],
          ['message_id', id],
          ['sum', String(parts.length)],
          ['seq', String(seq)],
          ['trace_id', randomBytes(4).toString('hex')],
        ],
        payload: part,
      };
      for (const socket of this.#sockets)
        if (socket.readyState === 1) socket.send(encodeFrame(frame));
    }
    return answered;
  }

  #heard = new Map<string, { from: string; text: string }>();

  #envelope(type: string, event: Record<string, unknown>) {
    return {
      schema: '2.0',
      header: {
        event_id: randomBytes(8).toString('hex'),
        event_type: type,
        create_time: String(Date.now()),
        token: '',
        app_id: MockFeishu.APP_ID,
        tenant_key: 'mock',
      },
      event,
    };
  }

  /** A message from the person: a private chat, or a group (where only mentions arrive). */
  say(
    text: string,
    options: {
      from?: string;
      group?: boolean;
      mention?: boolean;
      parent?: string;
      type?: string;
      content?: Record<string, unknown>;
      eventId?: string;
    } = {},
  ): string {
    const from = options.from ?? MockFeishu.OWNER;
    const id = `om_${randomBytes(8).toString('hex')}`;
    this.#heard.set(id, { from, text });
    const mention = options.group && options.mention !== false;
    const envelope = this.#envelope('im.message.receive_v1', {
      sender: {
        sender_id: { open_id: from, union_id: `on_${from.slice(3)}` },
        sender_type: 'user',
        tenant_key: 'mock',
      },
      message: {
        message_id: id,
        ...(options.parent && { parent_id: options.parent, root_id: options.parent }),
        chat_id: options.group ? MockFeishu.GROUP : `oc_p2p_${from.slice(3, 10)}`,
        chat_type: options.group ? 'group' : 'p2p',
        message_type: options.type ?? 'text',
        content: JSON.stringify(options.content ?? { text: mention ? `@_user_1 ${text}` : text }),
        create_time: String(Date.now()),
        ...(mention && {
          mentions: [
            {
              key: '@_user_1',
              id: { open_id: MockFeishu.BOT_OPEN_ID },
              name: 'Conch',
              tenant_key: 'mock',
            },
          ],
        }),
      },
    });
    if (options.eventId) envelope.header.event_id = options.eventId;
    void this.push(envelope);
    return id;
  }

  /** Scanning the code with Feishu and confirming (or declining) in the app. */
  scan(url?: string, deny = false): boolean {
    // No address: the newest code shown, as a person scanning the screen would.
    const device = url
      ? (new URL(url).searchParams.get('device') ?? '')
      : ([...this.#devices].filter(([, state]) => state === 'pending').at(-1)?.[0] ?? '');
    if (this.#devices.get(device) !== 'pending') return false;
    this.#devices.set(device, deny ? 'denied' : 'approved');
    return true;
  }

  /** The person opens the chat with the bot for the first time. */
  enter(from = MockFeishu.OWNER) {
    void this.push(
      this.#envelope('im.chat.access_event.bot_p2p_chat_entered_v1', {
        chat_id: `oc_p2p_${from.slice(3, 10)}`,
        operator_id: { open_id: from },
        last_message_create_time: '',
      }),
    );
  }

  /** Pressing a card's button; resolves with the toast Feishu would show. */
  press(messageId: string, value: string, from = MockFeishu.OWNER) {
    const message = this.sent.find((m) => m.id === messageId);
    return this.push(
      this.#envelope('card.action.trigger', {
        operator: { open_id: from, tenant_key: 'mock' },
        token: randomBytes(8).toString('hex'),
        action: { tag: 'button', value: { conch: value } },
        context: {
          open_message_id: messageId,
          open_chat_id: message?.to.startsWith('oc_') ? message.to : `oc_p2p_${from.slice(3, 10)}`,
        },
      }),
    );
  }
}
