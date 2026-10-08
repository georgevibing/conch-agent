import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import Fastify, { type FastifyInstance } from 'fastify';
import { type JWK, SignJWT, exportJWK, generateKeyPair } from 'jose';

import { deliverMockHook, guardMockServer } from './guard';

export interface MockTeamsSent {
  conversation: string;
  id: string;
  type: string;
  text: string;
  buttons: { title: string; data: string }[];
  updated?: boolean;
  /** Pictures sent inside the message (data: addresses), as Teams shows them. */
  pictures?: { name?: string; type: string; size: number }[];
}

type Key = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

/**
 * A pretend Microsoft Teams for tests, E2E and `pnpm dev:mock`: Microsoft's
 * sign-in (client credentials), Bot Framework's OpenID metadata and signing
 * keys, and the Bot Connector a bot answers through.
 *
 * The person writes with `say()`: the activity is signed with the pretend
 * Bot Framework key, exactly as Teams signs its own, and delivered to the
 * messaging endpoint set with `endpoint()` (what the person pastes in the
 * Azure portal). `forge()` sends the same activity with a token that's wrong
 * in one way, for the security tests.
 */
export class MockTeams {
  #app?: FastifyInstance;
  #key?: { private: Key; public: JWK };
  #other?: Key;
  #endpoint?: string;
  base = '';
  readonly sent: MockTeamsSent[] = [];
  readonly deliveries: { status: number }[] = [];
  readonly secrets = new Set<string>();
  /** Single-tenant: sign-in only works in this tenant. */
  singleTenant = false;
  /** Turn the public address into one this computer can reach (the door's own). */
  resolve: (url: string) => string = (url) => url;
  /** The trusted door origin, set by Services independently of request data. */
  deliveryOrigin: () => string | undefined = () => undefined;

  static readonly APP_ID = '00000000-0000-4000-8000-00000000c0c4';
  static readonly SECRET = 'mock~Teams.Secret_value-0123456789abcdefgh';
  static readonly TENANT = '11111111-2222-4333-8444-555555555555';
  static readonly OWNER = {
    id: '29:1AdaLovelaceMock',
    name: 'Ada Lovelace',
    aadObjectId: '6a6a6a6a-0000-4000-8000-0000000000ad',
  };
  static readonly STRANGER = {
    id: '29:1GraceHopperMock',
    name: 'Grace Hopper',
    aadObjectId: '6a6a6a6a-0000-4000-8000-00000000000a',
  };

  constructor() {
    this.secrets.add(MockTeams.SECRET);
  }

  async start(port = 0): Promise<string> {
    const pair = await generateKeyPair('RS256', { extractable: true });
    this.#key = { private: pair.privateKey, public: await exportJWK(pair.publicKey) };
    this.#other = (await generateKeyPair('RS256')).privateKey;
    const app = Fastify({ logger: false, requestTimeout: 20_000, bodyLimit: 4 * 1024 * 1024 });
    this.#app = app;
    guardMockServer(app);
    app.addContentTypeParser(
      'application/x-www-form-urlencoded',
      { parseAs: 'string' },
      (_request, body, done) => done(null, Object.fromEntries(new URLSearchParams(String(body)))),
    );
    app.get('/openid', () => ({
      issuer: 'https://api.botframework.com',
      jwks_uri: `${this.base}/keys`,
    }));
    app.get('/keys', () => ({
      keys: [
        {
          ...this.#key?.public,
          kid: 'mock-key',
          use: 'sig',
          alg: 'RS256',
          endorsements: ['msteams'],
        },
        { ...this.#key?.public, kid: 'skype-only', endorsements: ['skype'] },
      ],
    }));
    app.post<{ Params: { tenant: string } }>(
      '/login/:tenant/oauth2/v2.0/token',
      (request, reply) => {
        const body = (request.body ?? {}) as Record<string, string>;
        if (body.client_id !== MockTeams.APP_ID)
          return reply.code(400).send({
            error: 'unauthorized_client',
            error_description: 'AADSTS700016: Application not found in the directory.',
          });
        if (this.singleTenant && request.params.tenant !== MockTeams.TENANT)
          return reply.code(400).send({
            error: 'unauthorized_client',
            error_description:
              "AADSTS700016: Application with identifier was not found in the directory 'Bot Framework'.",
          });
        if (!this.secrets.has(body.client_secret ?? ''))
          return reply.code(401).send({
            error: 'invalid_client',
            error_description: 'AADSTS7000215: Invalid client secret provided.',
          });
        return {
          token_type: 'Bearer',
          expires_in: 3600,
          access_token: `mock-bf-${randomBytes(6).toString('hex')}`,
        };
      },
    );
    const authorised = (header: string | undefined) => /^Bearer mock-bf-/.test(header ?? '');
    app.post<{ Params: { id: string } }>(
      '/connector/v3/conversations/:id/activities',
      (request, reply) => {
        if (!authorised(request.headers.authorization)) return reply.code(401).send({});
        const body = request.body as {
          type: string;
          text?: string;
          attachments?: {
            contentType?: string;
            contentUrl?: string;
            name?: string;
            content?: { actions?: { title: string; data: { conch: string } }[] };
          }[];
        };
        const pictures = (body.attachments ?? []).flatMap((a) => {
          const data = /^data:([\w/+.-]+);base64,(.*)$/.exec(a.contentUrl ?? '');
          return data?.[1] && data[2] !== undefined
            ? [
                {
                  ...(a.name && { name: a.name }),
                  type: data[1],
                  size: Buffer.from(data[2], 'base64').length,
                },
              ]
            : [];
        });
        // As Teams does: a picture inside a message is 1 MB at most.
        if (pictures.some((p) => p.size > 1024 * 1024))
          return reply.code(413).send({ error: { code: 'MessageSizeTooBig' } });
        const id = `1:${randomBytes(4).toString('hex')}`;
        this.sent.push({
          conversation: request.params.id,
          id,
          type: body.type,
          text: body.text ?? '',
          buttons: (body.attachments?.[0]?.content?.actions ?? []).map((a) => ({
            title: a.title,
            data: a.data.conch,
          })),
          ...(pictures.length && { pictures }),
        });
        return { id };
      },
    );
    app.put<{ Params: { id: string; activity: string } }>(
      '/connector/v3/conversations/:id/activities/:activity',
      (request, reply) => {
        if (!authorised(request.headers.authorization)) return reply.code(401).send({});
        const body = request.body as { text?: string };
        this.sent.push({
          conversation: request.params.id,
          id: request.params.activity,
          type: 'message',
          text: body.text ?? '',
          buttons: [],
          updated: true,
        });
        return { id: request.params.activity };
      },
    );
    app.post('/connector/v3/conversations', (request, reply) => {
      if (!authorised(request.headers.authorization)) return reply.code(401).send({});
      const body = request.body as { members?: { id: string }[] };
      return { id: `a:new-${body.members?.[0]?.id ?? 'x'}` };
    });
    app.get('/connector/v3/attachments/picture', (request, reply) => {
      if (!authorised(request.headers.authorization)) return reply.code(401).send({});
      return reply.type('image/png').send(Buffer.from('89504e470d0a1a0a', 'hex'));
    });
    app.post<{ Params: { action: string } }>('/__control/:action', async (request) => {
      const body = (request.body ?? {}) as {
        text?: string;
        url?: string;
        data?: string;
        replyToId?: string;
        stranger?: boolean;
      };
      if (request.params.action === 'endpoint') this.endpoint(body.url ?? '');
      else if (request.params.action === 'say')
        return { status: await this.say(body.text ?? '', { stranger: body.stranger === true }) };
      else if (request.params.action === 'press')
        return { status: await this.press(body.data ?? '', body.replyToId ?? '') };
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
    await this.#app?.close();
  }

  get login() {
    return `${this.base}/login`;
  }

  get openId() {
    return `${this.base}/openid`;
  }

  get serviceUrl() {
    return `${this.base}/connector/`;
  }

  /** What the person pasted as the bot's messaging endpoint. */
  endpoint(url: string) {
    this.#endpoint = url;
  }

  activity(
    text: string,
    options: { stranger?: boolean; value?: unknown; replyToId?: string } = {},
  ) {
    const who = options.stranger ? MockTeams.STRANGER : MockTeams.OWNER;
    return {
      type: 'message',
      id: `1:${randomBytes(4).toString('hex')}`,
      channelId: 'msteams',
      serviceUrl: this.serviceUrl,
      timestamp: new Date().toISOString(),
      from: who,
      recipient: { id: `28:${MockTeams.APP_ID}`, name: 'Conch' },
      conversation: {
        id: `a:dm-${who.aadObjectId}`,
        conversationType: 'personal',
        tenantId: MockTeams.TENANT,
      },
      channelData: { tenant: { id: MockTeams.TENANT } },
      text,
      textFormat: 'plain',
      ...(options.value !== undefined && { value: options.value }),
      ...(options.replyToId && { replyToId: options.replyToId }),
    };
  }

  /** A Bot Framework token, as Microsoft makes them (or wrong in one way, for `forge`). */
  async token(
    activity: { serviceUrl: string },
    wrong?:
      'signature' | 'issuer' | 'audience' | 'expired' | 'service' | 'endorsement' | 'none' | 'hmac',
  ): Promise<string> {
    const key = this.#key;
    if (!key || !this.#other) throw new Error('not started');
    if (wrong === 'none') {
      const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
      return `${enc({ alg: 'none', kid: 'mock-key' })}.${enc({ iss: 'https://api.botframework.com', aud: MockTeams.APP_ID, serviceurl: activity.serviceUrl, exp: Math.floor(Date.now() / 1000) + 600 })}.`;
    }
    if (wrong === 'hmac')
      // Algorithm confusion: the public key's bytes used as an HMAC secret.
      return new SignJWT({ serviceurl: activity.serviceUrl })
        .setProtectedHeader({ alg: 'HS256', kid: 'mock-key' })
        .setIssuer('https://api.botframework.com')
        .setAudience(MockTeams.APP_ID)
        .setExpirationTime('10m')
        .sign(new TextEncoder().encode(JSON.stringify(key.public)));
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({
      serviceurl: wrong === 'service' ? 'https://evil.example/' : activity.serviceUrl,
    })
      .setProtectedHeader({
        alg: 'RS256',
        kid: wrong === 'endorsement' ? 'skype-only' : 'mock-key',
        typ: 'JWT',
      })
      .setIssuer(
        wrong === 'issuer' ? 'https://sts.windows.net/evil/' : 'https://api.botframework.com',
      )
      .setAudience(wrong === 'audience' ? '99999999-0000-4000-8000-000000000000' : MockTeams.APP_ID)
      .setIssuedAt(wrong === 'expired' ? now - 7200 : now)
      .setNotBefore(wrong === 'expired' ? now - 7200 : now - 60)
      .setExpirationTime(wrong === 'expired' ? now - 3600 : now + 600)
      .sign(wrong === 'signature' ? this.#other : key.private);
  }

  async deliver(
    activity: ReturnType<MockTeams['activity']>,
    wrong?: Parameters<MockTeams['token']>[1],
  ): Promise<number> {
    if (!this.#endpoint) throw new Error('No messaging endpoint yet.');
    const response = await deliverMockHook(this.deliveryOrigin(), this.resolve(this.#endpoint), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await this.token(activity, wrong)}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(activity),
    });
    this.deliveries.push({ status: response.status });
    return response.status;
  }

  say(text: string, options: { stranger?: boolean } = {}) {
    return this.deliver(this.activity(text, options));
  }

  /** Ada presses a card's button (Action.Submit posts its data back). */
  press(data: string, replyToId: string) {
    return this.deliver(this.activity('', { value: { conch: data }, replyToId }));
  }

  forge(text: string, wrong: NonNullable<Parameters<MockTeams['token']>[1]>) {
    return this.deliver(this.activity(text), wrong);
  }

  last(conversation = `a:dm-${MockTeams.OWNER.aadObjectId}`) {
    return this.sent.filter((m) => m.conversation === conversation && m.type === 'message').at(-1);
  }
}
