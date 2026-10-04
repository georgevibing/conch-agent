import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import Fastify, { type FastifyInstance } from 'fastify';

import { lineSignature } from '../line';

export interface MockLineSent {
  to: string;
  via: 'reply' | 'push';
  text: string;
  quickReplies: { label: string; data: string }[];
}

/**
 * A pretend LINE for tests, E2E and `pnpm dev:mock`: the Messaging API calls
 * Conch makes, and webhooks signed with the channel secret exactly as LINE
 * signs its own, delivered to the endpoint Conch sets itself.
 */
export class MockLine {
  // Written in two parts, so secret scanners never take them for real ones.
  static readonly SECRET = '0123456789abcdef' + 'fedcba9876543210';
  static readonly TOKEN = 'mockLineChannelAccessToken' + '/abcdefghijklmnopqrstuvwxyz0123456789=';
  static readonly BOT = {
    userId: 'U' + 'b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0',
    basicId: '@123conch',
    displayName: 'Conch',
  };
  static readonly OWNER = {
    userId: 'U' + 'ada0ada0ada0ada0ada0ada0ada0ada0',
    displayName: 'Ada Lovelace',
  };
  static readonly MEMBER = { userId: 'U' + 'b0bb0bb0bb0bb0bb0bb0bb0bb0bb0bb0', displayName: 'Bob' };
  static readonly GROUP = {
    groupId: 'C' + 'f00df00df00df00df00df00df00df00d',
    groupName: 'Family',
  };

  #app?: FastifyInstance;
  base = '';
  readonly sent: MockLineSent[] = [];
  readonly deliveries: number[] = [];
  readonly tokens = new Set<string>([MockLine.TOKEN]);
  /** The webhook URL the channel delivers to (Conch sets it). */
  endpoint = '';
  /** Every push from now on is refused: the plan's messages for the month are used up. */
  monthlyLimit = false;
  #replyTokens = new Set<string>();
  /** Turn the public address into one this computer can reach (the door's own). */
  resolve: (url: string) => string = (url) => url;

  async start(port = 0): Promise<string> {
    const app = Fastify({ logger: false });
    this.#app = app;
    app.addHook('onRequest', async (request, reply) => {
      if (request.url.startsWith('/__control')) return;
      const token = request.headers.authorization?.replace(/^Bearer /, '');
      if (!token || !this.tokens.has(token))
        return reply
          .code(401)
          .send({ message: 'Authentication failed due to the expired access token' });
    });
    app.get('/v2/bot/info', () => ({ ...MockLine.BOT, chatMode: 'bot', markAsReadMode: 'auto' }));
    app.put('/v2/bot/channel/webhook/endpoint', (request) => {
      this.endpoint = (request.body as { endpoint: string }).endpoint;
      return {};
    });
    const people = [MockLine.OWNER, MockLine.MEMBER];
    const profile = (id: string) => people.find((p) => p.userId === id);
    app.get<{ Params: { id: string } }>(
      '/v2/bot/profile/:id',
      (request, reply) =>
        profile(request.params.id) ?? reply.code(404).send({ message: 'Not found' }),
    );
    app.get<{ Params: { id: string } }>(
      '/v2/bot/group/:g/member/:id',
      (request, reply) =>
        profile(request.params.id) ?? reply.code(404).send({ message: 'Not found' }),
    );
    app.get('/v2/bot/group/:g/summary', () => MockLine.GROUP);
    app.post('/v2/bot/chat/loading/start', (_request, reply) => reply.code(202).send({}));
    const record = (to: string, via: 'reply' | 'push', messages: unknown[]) => {
      for (const raw of messages as {
        text: string;
        quickReply?: { items: { action: { label: string; data: string } }[] };
      }[])
        this.sent.push({
          to,
          via,
          text: raw.text,
          quickReplies:
            raw.quickReply?.items.map((i) => ({ label: i.action.label, data: i.action.data })) ??
            [],
        });
    };
    app.post('/v2/bot/message/reply', (request, reply) => {
      const body = request.body as { replyToken: string; messages: unknown[] };
      const to = [...this.#replyTokens].find((t) => t.startsWith(`${body.replyToken}|`));
      if (!to) return reply.code(400).send({ message: 'Invalid reply token' });
      this.#replyTokens.delete(to);
      record(to.split('|')[1] ?? '', 'reply', body.messages);
      return {};
    });
    app.post('/v2/bot/message/push', (request, reply) => {
      if (this.monthlyLimit)
        return reply.code(429).send({ message: 'You have reached your monthly limit.' });
      const body = request.body as { to: string; messages: unknown[] };
      record(body.to, 'push', body.messages);
      return { sentMessages: [{ id: String(Date.now()), quoteToken: 'q' }] };
    });
    app.get('/v2/bot/message/:id/content', (_request, reply) =>
      reply.header('content-type', 'image/jpeg').send(Buffer.from([0xff, 0xd8, 0xff, 0xd9])),
    );
    app.post<{ Params: { action: string } }>('/__control/:action', async (request) => {
      const body = (request.body ?? {}) as { text?: string };
      if (request.params.action === 'say') return { status: await this.say(body.text ?? '') };
      if (request.params.action === 'sent') return this.sent;
      return { ok: false };
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
    await this.#app?.close();
  }

  // ── The person's side ──────────────────────────────────────────────────

  #event(from: { userId: string }, extra: Record<string, unknown>, group = false) {
    const replyToken = randomBytes(16).toString('hex');
    const to = group ? MockLine.GROUP.groupId : from.userId;
    this.#replyTokens.add(`${replyToken}|${to}`);
    return {
      webhookEventId: `01${randomBytes(12).toString('hex').toUpperCase()}`,
      timestamp: Date.now(),
      mode: 'active',
      replyToken,
      deliveryContext: { isRedelivery: false },
      source: group
        ? { type: 'group', groupId: MockLine.GROUP.groupId, userId: from.userId }
        : { type: 'user', userId: from.userId },
      ...extra,
    };
  }

  /** A text message to the bot; `group` sends it in the group, `mention` mentions the bot there. */
  say(
    text: string,
    from: { userId: string } = MockLine.OWNER,
    options: { group?: boolean; mention?: boolean } = {},
  ): Promise<number> {
    const said = options.mention ? `@Conch ${text}` : text;
    return this.deliver([
      this.#event(
        from,
        {
          type: 'message',
          message: {
            id: String(Date.now()),
            type: 'text',
            quoteToken: 'q',
            text: said,
            ...(options.mention && {
              mention: {
                mentionees: [
                  { index: 0, length: 6, type: 'user', userId: MockLine.BOT.userId, isSelf: true },
                ],
              },
            }),
          },
        },
        options.group,
      ),
    ]);
  }

  /** A quick-reply button pressed. */
  press(data: string, from: { userId: string } = MockLine.OWNER): Promise<number> {
    return this.deliver([this.#event(from, { type: 'postback', postback: { data } })]);
  }

  /** Deliver events, signed (or with a wrong signature, or none, for the security tests). */
  async deliver(
    events: unknown[],
    sign: 'right' | 'wrong' | 'none' | 'tampered' = 'right',
  ): Promise<number> {
    const body = JSON.stringify({ destination: MockLine.BOT.userId, events });
    const signature =
      sign === 'right' || sign === 'tampered'
        ? lineSignature(MockLine.SECRET, body)
        : sign === 'wrong'
          ? lineSignature('ffffffffffffffff' + 'ffffffffffffffff', body)
          : undefined;
    try {
      const response = await fetch(this.resolve(this.endpoint), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'LineBotWebhook/2.0',
          ...(signature && { 'x-line-signature': signature }),
        },
        body: sign === 'tampered' ? body.replace('"text"', '"text" ') : body,
      });
      this.deliveries.push(response.status);
      return response.status;
    } catch {
      this.deliveries.push(0);
      return 0;
    }
  }

  /** An event as LINE would send it, for tests that deliver it themselves. */
  event(text: string, from: { userId: string } = MockLine.OWNER) {
    return this.#event(from, {
      type: 'message',
      message: { id: String(Date.now()), type: 'text', text },
    });
  }

  to(userId: string = MockLine.OWNER.userId) {
    return this.sent.filter((m) => m.to === userId);
  }
}
