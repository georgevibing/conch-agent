import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';

import { guardMockServer } from './guard';

interface Socket {
  send(data: string): void;
  close(code?: number): void;
  readyState: number;
  on(event: 'message', listener: (raw: Buffer) => void): void;
  on(event: 'close', listener: () => void): void;
}

export interface MockDingTalkSent {
  id: string;
  /** A person's staff id, or a group's conversation. */
  to: string;
  via: 'oto' | 'group' | 'webhook';
  msgKey: string;
  text: string;
  title?: string;
  media?: { name: string; type: string; size: number };
}

/**
 * A pretend DingTalk for tests, e2e and `pnpm dev:mock`: the access token,
 * the Stream gateway (a ticket, then a WebSocket of JSON frames with pings,
 * `disconnect` and robot callbacks that must be acknowledged), the robot's
 * sending APIs, media upload and file downloads.
 *
 * `say()` speaks for the person; `quotaGone` is the free plan's month used up.
 */
export class MockDingTalk {
  static readonly CLIENT_ID = 'ding' + 'mockrobot0001xyz';
  static readonly CLIENT_SECRET = 'MockDingTalkClientSecret' + '0123456789abcdefghijklmnopqrstuv';
  static readonly OWNER = 'manager4242';
  static readonly STRANGER = 'staff0077';
  static readonly MEMBER = 'staff0099';
  static readonly GROUP = 'cidFamily0000000000000==';

  #app?: FastifyInstance;
  #sockets = new Set<Socket>();
  #tickets = new Set<string>();
  #uploads = new Map<string, { name: string; type: string; size: number }>();
  base = '';
  readonly sent: MockDingTalkSent[] = [];
  /** Callback frames Conch acknowledged, by messageId. */
  readonly acks: string[] = [];
  readonly pongs: string[] = [];
  connections = 0;
  secret = MockDingTalk.CLIENT_SECRET;
  /** Staff ids aren't sent before the robot is published: replies go to the session webhook. */
  published = true;

  async start(port = 0): Promise<string> {
    const app = Fastify({ logger: false, requestTimeout: 20_000, bodyLimit: 30 * 1024 * 1024 });
    this.#app = app;
    guardMockServer(app);
    await app.register(fastifyWebsocket);
    app.addContentTypeParser('multipart/form-data', { parseAs: 'buffer' }, (_request, body, done) =>
      done(null, body),
    );
    const token = `mock-dt-${randomBytes(4).toString('hex')}`;
    const authorised = (header: unknown, reply: FastifyReply) => {
      if (header === token) return true;
      void reply.code(401).send({ code: 'InvalidAuthentication', message: '不合法的access_token' });
      return false;
    };
    app.post('/v1.0/oauth2/accessToken', (request, reply) => {
      const body = (request.body ?? {}) as { appKey?: string; appSecret?: string };
      if (body.appKey !== MockDingTalk.CLIENT_ID || body.appSecret !== this.secret)
        return reply
          .code(400)
          .send({ code: 'invalidClientIdOrSecret', message: '无效的clientId或者clientSecret' });
      return { accessToken: token, expireIn: 7200 };
    });
    app.post('/v1.0/gateway/connections/open', (request, reply) => {
      const body = (request.body ?? {}) as { clientId?: string; clientSecret?: string };
      if (body.clientId !== MockDingTalk.CLIENT_ID || body.clientSecret !== this.secret)
        return reply.code(401).send({ code: 'authFailed', message: '鉴权失败' });
      const ticket = randomBytes(8).toString('hex');
      this.#tickets.add(ticket);
      return { endpoint: `${this.base.replace('http', 'ws')}/connect`, ticket };
    });
    app.get('/connect', { websocket: true }, (socket, request) => {
      const ticket = (request.query as { ticket?: string }).ticket ?? '';
      if (!this.#tickets.delete(ticket)) return (socket as unknown as Socket).close(4001);
      this.#socket(socket as unknown as Socket);
    });
    const record = (sent: Omit<MockDingTalkSent, 'id'>) => {
      const id = randomBytes(8).toString('hex');
      this.sent.push({ id, ...sent });
      return id;
    };
    const read = (msgKey: string, msgParam: string) => {
      const param = JSON.parse(msgParam) as Record<string, string>;
      const media = this.#uploads.get(param.mediaId ?? param.photoURL ?? '');
      return {
        msgKey,
        text: param.text ?? param.content ?? '',
        ...(param.title && { title: param.title }),
        ...(media && { media }),
      };
    };
    app.post('/v1.0/robot/oToMessages/batchSend', (request, reply) => {
      if (!authorised(request.headers['x-acs-dingtalk-access-token'], reply)) return reply;
      const body = request.body as {
        robotCode: string;
        userIds: string[];
        msgKey: string;
        msgParam: string;
      };
      if (body.robotCode !== MockDingTalk.CLIENT_ID)
        return reply.code(400).send({ code: 'resource.not.found', message: 'robot not exist' });
      if (!this.published || !body.userIds.every((u) => /^(manager|staff)\d+$/.test(u)))
        return reply
          .code(400)
          .send({ code: 'invalidParameter.userIds', message: 'staffId invalid' });
      const processQueryKey = record({
        to: body.userIds[0] ?? '',
        via: 'oto',
        ...read(body.msgKey, body.msgParam),
      });
      return { processQueryKey, invalidStaffIdList: [], flowControlledStaffIdList: [] };
    });
    app.post('/v1.0/robot/groupMessages/send', (request, reply) => {
      if (!authorised(request.headers['x-acs-dingtalk-access-token'], reply)) return reply;
      const body = request.body as { openConversationId: string; msgKey: string; msgParam: string };
      if (Buffer.byteLength(body.msgParam) >= 15_000)
        return reply
          .code(400)
          .send({ code: 'invalidParameter.msgParam.tooLong', message: 'too long' });
      return {
        processQueryKey: record({
          to: body.openConversationId,
          via: 'group',
          ...read(body.msgKey, body.msgParam),
        }),
      };
    });
    app.post('/robot/sendBySession', (request) => {
      const session = (request.query as { session?: string }).session ?? '';
      const body = request.body as { markdown?: { text?: string; title?: string } };
      record({ to: session, via: 'webhook', msgKey: 'markdown', text: body.markdown?.text ?? '' });
      return { errcode: 0, errmsg: 'ok' };
    });
    app.post('/media/upload', async (request) => {
      const query = request.query as { access_token?: string; type?: string };
      if (query.access_token !== token) return { errcode: 40014, errmsg: '不合法的access_token' };
      const form = await new Response(new Uint8Array(request.body as Buffer), {
        headers: { 'content-type': String(request.headers['content-type']) },
      }).formData();
      const media = form.get('media');
      if (!media || typeof media === 'string') return { errcode: 40004, errmsg: 'media missing' };
      const id = `@lAD${randomBytes(6).toString('hex')}`;
      this.#uploads.set(id, { name: media.name, type: query.type ?? '', size: media.size });
      return { errcode: 0, errmsg: 'ok', media_id: id, type: query.type, created_at: Date.now() };
    });
    app.post('/v1.0/robot/messageFiles/download', (request, reply) => {
      if (!authorised(request.headers['x-acs-dingtalk-access-token'], reply)) return reply;
      const body = request.body as { downloadCode?: string; robotCode?: string };
      return { downloadUrl: `${this.base}/files/${encodeURIComponent(body.downloadCode ?? '')}` };
    });
    app.get('/files/:code', (request, reply) => {
      const code = (request.params as { code: string }).code;
      if (code.startsWith('voice'))
        return reply.type('audio/amr').send(Buffer.from('#!AMR\n mock'));
      return reply.type('image/png').send(Buffer.from('89504e470d0a1a0a', 'hex'));
    });
    app.post<{ Params: { action: string } }>('/__control/:action', async (request) => {
      const body = (request.body ?? {}) as Record<string, string | boolean | undefined>;
      switch (request.params.action) {
        case 'say':
          return {
            msgId: this.say(String(body.text ?? ''), {
              from: body.stranger === true ? MockDingTalk.STRANGER : MockDingTalk.OWNER,
              group: body.group === true,
            }),
          };
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
      const reply = JSON.parse(raw.toString()) as {
        code?: number;
        headers?: { messageId?: string };
        data?: string;
      };
      const id = reply.headers?.messageId ?? '';
      if (id.startsWith('ping_')) this.pongs.push(reply.data ?? '');
      else if (reply.code === 200) this.acks.push(id);
    });
  }

  #push(frame: Record<string, unknown>) {
    const text = JSON.stringify(frame);
    for (const socket of this.#sockets) if (socket.readyState === 1) socket.send(text);
  }

  /** DingTalk checking the connection is alive. */
  ping() {
    this.#push({
      specVersion: '1.0',
      type: 'SYSTEM',
      headers: {
        topic: 'ping',
        messageId: `ping_${randomBytes(4).toString('hex')}`,
        contentType: 'application/json',
        time: String(Date.now()),
      },
      data: JSON.stringify({ opaque: randomBytes(4).toString('hex') }),
    });
  }

  /** DingTalk moving the connection elsewhere: Conch should open a new one. */
  disconnect() {
    this.#push({
      specVersion: '1.0',
      type: 'SYSTEM',
      headers: { topic: 'disconnect', messageId: randomBytes(4).toString('hex') },
      data: JSON.stringify({ reason: 'server restart' }),
    });
  }

  drop() {
    for (const socket of this.#sockets) socket.close(4000);
  }

  /** A message from the person, privately or @mentioning the robot in a group. */
  say(
    text: string,
    options: {
      from?: string;
      group?: boolean;
      msgtype?: string;
      content?: Record<string, unknown>;
      msgId?: string;
      errorCode?: string;
    } = {},
  ): string {
    const from = options.from ?? MockDingTalk.OWNER;
    const msgId = options.msgId ?? `msg${randomBytes(6).toString('hex')}`;
    const names: Record<string, string> = {
      [MockDingTalk.OWNER]: 'Ada Lovelace',
      [MockDingTalk.STRANGER]: 'Grace Hopper',
      [MockDingTalk.MEMBER]: 'Bob',
    };
    const data = options.errorCode
      ? {
          msgId,
          conversationId: 'cidx',
          conversationType: '1',
          senderId: `$:LWCP_v1:$${from}`,
          errorCode: options.errorCode,
        }
      : {
          conversationId: options.group ? MockDingTalk.GROUP : `cidp2p${from}`,
          conversationType: options.group ? '2' : '1',
          ...(options.group && { conversationTitle: 'Family' }),
          chatbotCorpId: 'dingcorp',
          chatbotUserId: '$:LWCP_v1:$bot',
          msgId,
          senderNick: names[from] ?? 'Someone',
          isAdmin: from === MockDingTalk.OWNER,
          ...(this.published && { senderStaffId: from }),
          senderId: `$:LWCP_v1:$${from}`,
          sessionWebhookExpiredTime: Date.now() + 90 * 60_000,
          sessionWebhook: `${this.base}/robot/sendBySession?session=${from}`,
          createAt: Date.now(),
          senderCorpId: 'dingcorp',
          isInAtList: Boolean(options.group),
          robotCode: MockDingTalk.CLIENT_ID,
          msgtype: options.msgtype ?? 'text',
          ...(options.content ? { content: options.content } : { text: { content: text } }),
        };
    this.#push({
      specVersion: '1.0',
      type: 'CALLBACK',
      headers: {
        appId: 'mockapp',
        connectionId: 'c1',
        contentType: 'application/json',
        messageId: randomBytes(8).toString('hex'),
        time: String(Date.now()),
        topic: '/v1.0/im/bot/messages/get',
      },
      data: JSON.stringify(data),
    });
    return msgId;
  }
}
