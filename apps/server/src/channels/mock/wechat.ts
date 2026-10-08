import { createCipheriv, randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';

import { deliverMockHook, guardMockServer } from './guard';
import { buildXml, decrypt, encrypt, parseXml, signature } from '../wechat-crypto';

interface Socket {
  send(data: string): void;
  close(code?: number): void;
  readyState: number;
  on(event: 'message', listener: (raw: Buffer) => void): void;
  on(event: 'close', listener: () => void): void;
}

export interface MockWeChatSent {
  to: string;
  text: string;
  /** How it went: in the reply to a delivery (passive), or as a customer-service message. */
  via: 'reply' | 'custom' | 'wecom';
  card?: { task_id: string; buttons: { text: string; key: string }[] };
  /** A picture sent as a customer-service image: the upload it named. */
  image?: { name: string; type: string; size: number };
}

/**
 * A pretend WeChat for tests, E2E and `pnpm dev:mock`, both ways Conch
 * reaches it:
 *
 * - **An Official Account** (`/cgi-bin/…`): the stable token, customer-
 *   service messages, typing and media. The person's side is WeChat's own
 *   servers: `configure()` is pressing Submit in the server settings (it
 *   checks the address with an echo, as WeChat does), and `say()` delivers
 *   a message, signed and, in safe mode, encrypted, then reads the reply.
 *   `verified = false` is an individual's account, which may not send
 *   customer-service messages (48001).
 * - **A WeCom AI bot** (`/wecom`): the long connection, with its subscribe,
 *   heartbeats, callbacks and `aibot_send_msg`. `wecomSay()` and
 *   `wecomPress()` speak for the person; `takeOver()` is another program
 *   connecting with the same keys.
 */
export class MockWeChat {
  #app?: FastifyInstance;
  #sockets = new Set<Socket>();
  #config?: { url: string; token: string; aesKey?: string };
  #msgId = 6_000_000;
  #uploads = new Map<string, { name: string; type: string; size: number }>();
  base = '';
  readonly sent: MockWeChatSent[] = [];
  readonly typing: string[] = [];
  readonly frames: { cmd?: string; body?: unknown }[] = [];
  verified = true;
  /** Hold every delivery's reply until it comes back (seconds WeChat waits before retrying). */
  resolve: (url: string) => string = (url) => url;
  /** The trusted door origin, set by Services independently of request data. */
  deliveryOrigin: () => string | undefined = () => undefined;
  connections = 0;

  static readonly APP_ID = 'wx' + '0123456789abcdef';
  static readonly APP_SECRET = '0123456789abcdef0123456789abcdef';
  static readonly OWNER = 'oAdaLovelace0000000000000000';
  static readonly STRANGER = 'oGraceHopper0000000000000000';
  static readonly ACCOUNT = 'gh_0123456789ab';
  static readonly BOT_ID = 'aibMockBot0001';
  static readonly BOT_SECRET = 'mockBotSecret0123456789abcdefABCDEF';
  static readonly USER = 'AdaLovelace';

  async start(port = 0): Promise<string> {
    const app = Fastify({ logger: false, requestTimeout: 20_000, bodyLimit: 12 * 1024 * 1024 });
    this.#app = app;
    guardMockServer(app);
    await app.register(fastifyWebsocket);
    app.post('/cgi-bin/stable_token', (request) => {
      const body = (request.body ?? {}) as { appid?: string; secret?: string };
      if (body.appid !== MockWeChat.APP_ID) return { errcode: 40013, errmsg: 'invalid appid' };
      if (body.secret !== MockWeChat.APP_SECRET)
        return { errcode: 40125, errmsg: 'invalid appsecret' };
      return { access_token: 'MOCK_ACCESS_TOKEN', expires_in: 7200 };
    });
    const authorised = (query: unknown) =>
      (query as { access_token?: string }).access_token === 'MOCK_ACCESS_TOKEN';
    app.post('/cgi-bin/message/custom/send', (request) => {
      if (!authorised(request.query)) return { errcode: 40001, errmsg: 'invalid credential' };
      if (!this.verified) return { errcode: 48001, errmsg: 'api unauthorized' };
      const body = request.body as {
        touser: string;
        msgtype?: string;
        text?: { content: string };
        image?: { media_id: string };
      };
      if (body.msgtype === 'image') {
        const media = this.#uploads.get(body.image?.media_id ?? '');
        if (!media) return { errcode: 40007, errmsg: 'invalid media_id' };
        this.sent.push({ to: body.touser, text: '', via: 'custom', image: media });
        return { errcode: 0, errmsg: 'ok' };
      }
      this.sent.push({ to: body.touser, text: body.text?.content ?? '', via: 'custom' });
      return { errcode: 0, errmsg: 'ok' };
    });
    // Temporary media (a picture the account sends): kept by id, as WeChat does for three days.
    app.addContentTypeParser('multipart/form-data', { parseAs: 'buffer' }, (_request, body, done) =>
      done(null, body),
    );
    app.post('/cgi-bin/media/upload', async (request) => {
      const query = request.query as { access_token?: string; type?: string };
      if (!authorised(query)) return { errcode: 40001, errmsg: 'invalid credential' };
      const form = await new Response(new Uint8Array(request.body as Buffer), {
        headers: { 'content-type': String(request.headers['content-type']) },
      }).formData();
      const media = form.get('media');
      if (!media || typeof media === 'string')
        return { errcode: 41005, errmsg: 'media data missing' };
      if (query.type === 'image' && media.size > 10 * 1024 * 1024)
        return { errcode: 40009, errmsg: 'invalid image size' };
      const id = `media_${this.#uploads.size + 1}`;
      this.#uploads.set(id, { name: media.name, type: media.type, size: media.size });
      return { type: query.type, media_id: id, created_at: Math.floor(Date.now() / 1000) };
    });
    app.post('/cgi-bin/message/custom/typing', (request) => {
      if (!this.verified) return { errcode: 48001, errmsg: 'api unauthorized' };
      this.typing.push((request.body as { touser: string }).touser);
      return { errcode: 0, errmsg: 'ok' };
    });
    app.get('/cgi-bin/media/get', (request, reply) => {
      if (!authorised(request.query))
        return reply.send({ errcode: 40001, errmsg: 'invalid credential' });
      return reply.type('image/jpeg').send(Buffer.from('ffd8ffe000104a464946', 'hex'));
    });
    app.get('/wecom', { websocket: true }, (socket) => this.#socket(socket as unknown as Socket));
    app.get('/media/encrypted', (_request, reply) =>
      reply.type('application/octet-stream').send(this.encryptedFile),
    );
    app.post<{ Params: { action: string } }>('/__control/:action', async (request) => {
      const body = (request.body ?? {}) as Record<string, string | boolean | undefined>;
      const text = String(body.text ?? '');
      switch (request.params.action) {
        case 'configure':
          return {
            status: await this.configure(
              String(body.url ?? ''),
              String(body.token ?? ''),
              body.aesKey ? String(body.aesKey) : undefined,
            ),
          };
        case 'say':
          return this.say(text, { stranger: body.stranger === true });
        case 'wecom-say':
          this.wecomSay(text, body.stranger === true ? 'GraceHopper' : MockWeChat.USER);
          return { ok: true };
        case 'wecom-press':
          this.wecomPress(String(body.key ?? ''), String(body.task_id ?? ''));
          return { ok: true };
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

  get socket() {
    return `${this.base.replace('http', 'ws')}/wecom`;
  }

  // ── Official Account: WeChat's servers ─────────────────────────────────

  /** Pressing Submit in 设置与开发 → 基本配置: WeChat checks the address answers its echo. */
  async configure(url: string, token: string, aesKey?: string): Promise<number> {
    this.#config = { url, token, ...(aesKey && { aesKey }) };
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = String(1000 + Math.floor(Math.random() * 9000));
    const echostr = randomBytes(8).toString('hex');
    const query = new URLSearchParams({
      signature: signature(token, timestamp, nonce),
      timestamp,
      nonce,
      echostr,
    });
    const response = await deliverMockHook(this.deliveryOrigin(), this.resolve(url), {}, query);
    const said = response.body;
    return response.ok && said === echostr ? 200 : 400;
  }

  /** A message from the person, as WeChat delivers it; the reply (if any) is read back. */
  async say(
    text: string,
    options: {
      stranger?: boolean;
      nonce?: string;
      timestamp?: string;
      tamper?: boolean;
      msgId?: number;
    } = {},
  ) {
    const config = this.#config;
    if (!config) throw new Error('Configure the server address first.');
    const from = options.stranger ? MockWeChat.STRANGER : MockWeChat.OWNER;
    const msgId = options.msgId ?? this.#msgId++;
    const xml = buildXml({
      ToUserName: MockWeChat.ACCOUNT,
      FromUserName: from,
      CreateTime: Math.floor(Date.now() / 1000),
      MsgType: 'text',
      Content: text,
      MsgId: msgId,
    });
    const timestamp = options.timestamp ?? String(Math.floor(Date.now() / 1000));
    const nonce = options.nonce ?? String(Math.floor(Math.random() * 1e9));
    const query = new URLSearchParams({
      signature: signature(config.token, timestamp, nonce),
      timestamp,
      nonce,
      openid: from,
    });
    let body = xml;
    if (config.aesKey) {
      const encrypted = encrypt(xml, config.aesKey, MockWeChat.APP_ID);
      query.set('encrypt_type', 'aes');
      query.set(
        'msg_signature',
        signature(config.token, timestamp, nonce, options.tamper ? `${encrypted}x` : encrypted),
      );
      body = buildXml({ ToUserName: MockWeChat.ACCOUNT, Encrypt: encrypted });
    }
    const response = await deliverMockHook(
      this.deliveryOrigin(),
      this.resolve(config.url),
      { method: 'POST', body, headers: { 'content-type': 'text/xml' } },
      query,
    );
    const reply = response.body;
    const status = response.status;
    if (status !== 200 || !reply || reply === 'success') return { status, msgId };
    let answer = parseXml(reply);
    if (config.aesKey && answer.Encrypt) {
      if (
        answer.MsgSignature !==
        signature(config.token, answer.TimeStamp ?? '', answer.Nonce ?? '', answer.Encrypt)
      )
        throw new Error('The reply’s signature is wrong.');
      answer = parseXml(decrypt(answer.Encrypt, config.aesKey, MockWeChat.APP_ID));
    }
    if (answer.Content)
      this.sent.push({ to: answer.ToUserName ?? '', text: answer.Content, via: 'reply' });
    return { status, msgId, reply: answer.Content };
  }

  // ── WeCom AI bot: the long connection ──────────────────────────────────

  #socket(socket: Socket) {
    this.connections++;
    let subscribed = false;
    socket.on('close', () => this.#sockets.delete(socket));
    socket.on('message', (raw) => {
      const frame = JSON.parse(raw.toString()) as {
        cmd?: string;
        headers?: { req_id?: string };
        body?: Record<string, unknown>;
      };
      this.frames.push({ cmd: frame.cmd, body: frame.body });
      const ack = (errcode = 0, errmsg = 'ok') =>
        socket.send(JSON.stringify({ headers: frame.headers, errcode, errmsg }));
      if (frame.cmd === 'aibot_subscribe') {
        const ok =
          frame.body?.bot_id === MockWeChat.BOT_ID && frame.body.secret === MockWeChat.BOT_SECRET;
        ack(ok ? 0 : 40058, ok ? 'ok' : 'invalid secret');
        if (!ok) return;
        // One connection per bot: the one before is told and closed.
        for (const old of this.#sockets) this.#takeOver(old);
        this.#sockets.add(socket);
        subscribed = true;
        return;
      }
      if (!subscribed) return;
      if (frame.cmd === 'ping') return ack();
      if (frame.cmd === 'aibot_send_msg') {
        const body = frame.body as {
          chatid: string;
          msgtype: string;
          markdown?: { content: string };
          template_card?: { task_id: string; button_list: { text: string; key: string }[] };
        };
        this.sent.push({
          to: body.chatid,
          text: body.markdown?.content ?? '',
          via: 'wecom',
          ...(body.template_card && {
            card: { task_id: body.template_card.task_id, buttons: body.template_card.button_list },
          }),
        });
        return ack();
      }
      ack();
    });
  }

  #takeOver(socket: Socket) {
    socket.send(
      JSON.stringify({
        cmd: 'aibot_event_callback',
        headers: { req_id: `evt_${Date.now()}` },
        body: { msgid: randomBytes(4).toString('hex'), event: { eventtype: 'disconnected_event' } },
      }),
    );
    socket.close(1000);
    this.#sockets.delete(socket);
  }

  /** Another program connects with the bot's keys. */
  takeOver() {
    for (const socket of this.#sockets) this.#takeOver(socket);
  }

  #push(cmd: string, body: Record<string, unknown>) {
    const frame = JSON.stringify({
      cmd,
      headers: { req_id: `${cmd}_${randomBytes(4).toString('hex')}` },
      body,
    });
    for (const socket of this.#sockets) if (socket.readyState === 1) socket.send(frame);
  }

  wecomSay(text: string, from = MockWeChat.USER, extra: Record<string, unknown> = {}) {
    this.#push('aibot_msg_callback', {
      msgid: randomBytes(6).toString('hex'),
      aibotid: MockWeChat.BOT_ID,
      chattype: 'single',
      from: { userid: from },
      msgtype: 'text',
      text: { content: text },
      ...extra,
    });
  }

  /** A picture, encrypted with its own key as WeCom sends them. */
  wecomPicture() {
    this.#push('aibot_msg_callback', {
      msgid: randomBytes(6).toString('hex'),
      aibotid: MockWeChat.BOT_ID,
      chattype: 'single',
      from: { userid: MockWeChat.USER },
      msgtype: 'image',
      image: { url: `${this.base}/media/encrypted`, aeskey: this.fileKey },
    });
  }

  wecomPress(key: string, taskId: string, from = MockWeChat.USER) {
    this.#push('aibot_event_callback', {
      msgid: randomBytes(6).toString('hex'),
      aibotid: MockWeChat.BOT_ID,
      chattype: 'single',
      from: { userid: from },
      msgtype: 'event',
      event: { eventtype: 'template_card_event', event_key: key, task_id: taskId },
    });
  }

  /** A file's key and its encrypted bytes (AES-256-CBC, PKCS#7 to 32 bytes), for `wecomPicture`. */
  readonly fileKey = randomBytes(32).toString('base64');
  readonly plainFile = Buffer.from('a picture from WeCom');
  get encryptedFile(): Buffer {
    const key = Buffer.from(this.fileKey, 'base64');
    const pad = 32 - (this.plainFile.length % 32);
    const cipher = createCipheriv('aes-256-cbc', key, key.subarray(0, 16));
    cipher.setAutoPadding(false);
    return Buffer.concat([
      cipher.update(Buffer.concat([this.plainFile, Buffer.alloc(pad, pad)])),
      cipher.final(),
    ]);
  }
}
