import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import Fastify, { type FastifyInstance } from 'fastify';
import {
  type JWK,
  SignJWT,
  exportJWK,
  exportPKCS8,
  generateKeyPair,
  importJWK,
  importPKCS8,
  jwtVerify,
} from 'jose';

import { CHAT_SA_CERT, CHAT_SA_KEY } from './googlechat-fixture';

export interface MockChatMessage {
  name: string;
  space: string;
  text: string;
  buttons: { text: string; data: string }[];
  updated?: boolean;
}

type Key = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

/**
 * A pretend Google for tests, E2E and `pnpm dev:mock`: the token endpoint a
 * service account's JWT is traded at, Google's signing keys, and the Chat
 * API calls Conch makes. The person writes with `say()`: the event carries a
 * Google ID token signed with the pretend Google key, for the address set
 * with `endpoint()` (what the person pastes in the Chat API's
 * configuration). `forge()` sends one wrong in one way, for the security
 * tests.
 */
export class MockGoogleChat {
  static readonly OWNER = {
    name: 'users/111111111111111111111',
    displayName: 'Ada Lovelace',
    type: 'HUMAN' as const,
  };
  static readonly MEMBER = {
    name: 'users/222222222222222222222',
    displayName: 'Bob',
    type: 'HUMAN' as const,
  };
  static readonly SPACE = {
    name: 'spaces/AAAAfamily',
    type: 'ROOM',
    spaceType: 'SPACE',
    displayName: 'Family',
  };

  #app?: FastifyInstance;
  #google?: { private: Key; public: JWK };
  #other?: Key;
  #account?: { private: Key; publicJwk: JWK; pem: string };
  #endpoint = '';
  #nextId = 1;
  base = '';
  readonly sent: MockChatMessage[] = [];
  /** How often Google's keys and Chat's certificates were asked for. */
  certFetches = 0;
  /** Google's keys can't be fetched. */
  certsDown = false;
  chatCertFetches = 0;
  /** The Chat API is off in this project. */
  apiOff = false;
  /** The service account's key was deleted. */
  keyRevoked = false;
  /** Turn the public address into one this computer can reach (the door's own). */
  resolve: (url: string) => string = (url) => url;

  readonly email = 'conch-bot@conch-chat-123.iam.gserviceaccount.com';

  /** The key file Google Cloud would download. */
  get keyFile(): string {
    return JSON.stringify({
      type: 'service_account',
      project_id: 'conch-chat-123',
      private_key_id: 'abc',
      private_key: this.#account?.pem ?? '',
      client_email: this.email,
      client_id: '1234567890',
      token_uri: 'https://oauth2.googleapis.com/token',
    });
  }

  dmOf(user: string) {
    return `spaces/dm${user.replace(/\D/g, '').slice(0, 8)}`;
  }

  /** Messages as Google Chat itself has them: what `spaces.messages.get` answers. */
  readonly #messages = new Map<string, Record<string, unknown>>();
  /** The last token sent, as someone watching could capture it. */
  lastToken = '';

  async start(port = 0): Promise<string> {
    const google = await generateKeyPair('RS256', { extractable: true });
    this.#google = { private: google.privateKey, public: await exportJWK(google.publicKey) };
    this.#other = (await generateKeyPair('RS256')).privateKey;
    const account = await generateKeyPair('RS256', { extractable: true });
    this.#account = {
      private: account.privateKey,
      publicJwk: await exportJWK(account.publicKey),
      pem: await exportPKCS8(account.privateKey),
    };
    const app = Fastify({ logger: false });
    this.#app = app;
    app.addContentTypeParser(
      'application/x-www-form-urlencoded',
      { parseAs: 'string' },
      (_request, body, done) => done(null, Object.fromEntries(new URLSearchParams(String(body)))),
    );
    app.get('/certs', (_request, reply) => {
      this.certFetches++;
      if (this.certsDown) return reply.code(503).send({});
      return { keys: [{ ...this.#google?.public, kid: 'google-key', alg: 'RS256', use: 'sig' }] };
    });
    app.post('/token', async (request, reply) => {
      const body = (request.body ?? {}) as Record<string, string>;
      if (this.keyRevoked)
        return reply
          .code(400)
          .send({ error: 'invalid_grant', error_description: 'Invalid JWT Signature.' });
      try {
        const key = await importJWK(this.#account?.publicJwk ?? {}, 'RS256');
        const { payload } = await jwtVerify(body.assertion ?? '', key, { issuer: this.email });
        if (payload.scope !== 'https://www.googleapis.com/auth/chat.bot') throw new Error('scope');
      } catch {
        return reply.code(400).send({ error: 'invalid_grant', error_description: 'Invalid JWT.' });
      }
      return {
        access_token: `ya29.mock-${randomBytes(6).toString('hex')}`,
        expires_in: 3599,
        token_type: 'Bearer',
      };
    });
    const authorised = (header?: string) => /^Bearer ya29\.mock-/.test(header ?? '');
    app.addHook('onRequest', async (request, reply) => {
      if (!request.url.startsWith('/v1/')) return;
      if (!authorised(request.headers.authorization))
        return reply
          .code(401)
          .send({ error: { message: 'Request had invalid authentication credentials.' } });
      if (this.apiOff)
        return reply.code(403).send({
          error: {
            message: 'Google Chat API has not been used in project 123 before or it is disabled.',
            status: 'PERMISSION_DENIED',
          },
        });
    });
    app.get('/v1/spaces', () => ({ spaces: [] }));
    app.get<{ Querystring: { name: string } }>('/v1/spaces::findDirectMessage', (request) => ({
      name: this.dmOf(request.query.name),
      spaceType: 'DIRECT_MESSAGE',
    }));
    const record = (
      space: string,
      body: { text?: string; cardsV2?: unknown[] },
      name: string,
      updated = false,
    ) => {
      const buttons = (
        (body.cardsV2 ?? []) as {
          card: {
            sections: {
              widgets: {
                buttonList?: {
                  buttons: {
                    text: string;
                    onClick: { action: { parameters: { key: string; value: string }[] } };
                  }[];
                };
              }[];
            }[];
          };
        }[]
      )
        .flatMap((c) =>
          c.card.sections.flatMap((s) => s.widgets.flatMap((w) => w.buttonList?.buttons ?? [])),
        )
        .map((b) => ({
          text: b.text,
          data: b.onClick.action.parameters.find((p) => p.key === 'data')?.value ?? '',
        }));
      this.sent.push({
        name,
        space,
        text: body.text ?? '',
        buttons,
        ...(updated && { updated: true }),
      });
    };
    app.post<{ Params: { space: string } }>('/v1/spaces/:space/messages', (request) => {
      const space = `spaces/${request.params.space}`;
      const name = `${space}/messages/m${this.#nextId++}`;
      const body = request.body as { text?: string };
      record(space, body, name);
      this.#messages.set(name, {
        name,
        sender: { name: 'users/app', type: 'BOT' },
        text: body.text ?? '',
      });
      return { name };
    });
    app.get<{ Params: { space: string; message: string } }>(
      '/v1/spaces/:space/messages/:message',
      (request, reply) =>
        this.#messages.get(`spaces/${request.params.space}/messages/${request.params.message}`) ??
        reply.code(404).send({ error: { message: 'Message not found.', status: 'NOT_FOUND' } }),
    );
    app.get<{ Params: { space: string } }>('/v1/spaces/:space', (request) =>
      `spaces/${request.params.space}` === MockGoogleChat.SPACE.name
        ? MockGoogleChat.SPACE
        : {
            name: `spaces/${request.params.space}`,
            spaceType: 'DIRECT_MESSAGE',
            singleUserBotDm: true,
          },
    );
    app.get('/chatcerts', () => {
      this.chatCertFetches++;
      return { 'chat-key': CHAT_SA_CERT };
    });
    app.patch<{ Params: { space: string; message: string } }>(
      '/v1/spaces/:space/messages/:message',
      (request) => {
        const space = `spaces/${request.params.space}`;
        record(
          space,
          request.body as { text?: string },
          `${space}/messages/${request.params.message}`,
          true,
        );
        return {};
      },
    );
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

  /** Where the person pasted the channel's address in the Chat API's configuration. */
  endpoint(url: string) {
    this.#endpoint = url;
  }

  async #token(wrong?: 'key' | 'audience' | 'sender' | 'expired' | 'issuer') {
    return new SignJWT({
      email: wrong === 'sender' ? 'someone@example.com' : 'chat@system.gserviceaccount.com',
      email_verified: true,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'google-key', typ: 'JWT' })
      .setIssuer(wrong === 'issuer' ? 'https://evil.example' : 'https://accounts.google.com')
      .setAudience(wrong === 'audience' ? 'https://elsewhere.example/hook' : this.#endpoint)
      .setIssuedAt(wrong === 'expired' ? Math.floor(Date.now() / 1000) - 7200 : undefined)
      .setExpirationTime(wrong === 'expired' ? Math.floor(Date.now() / 1000) - 3600 : '1h')
      .sign((wrong === 'key' ? this.#other : this.#google?.private) as Key);
  }

  event(
    text: string,
    from = MockGoogleChat.OWNER,
    options: { space?: boolean; mention?: boolean } = {},
  ) {
    const space = options.space
      ? MockGoogleChat.SPACE
      : {
          name: this.dmOf(from.name),
          type: 'DM',
          spaceType: 'DIRECT_MESSAGE',
          singleUserBotDm: true,
        };
    const event = {
      type: 'MESSAGE',
      eventTime: new Date().toISOString(),
      space,
      user: from,
      message: {
        name: `${space.name}/messages/u${this.#nextId++}`,
        text: options.mention ? `@Conch ${text}` : text,
        ...(options.mention && {
          argumentText: ` ${text}`,
          annotations: [
            {
              type: 'USER_MENTION',
              startIndex: 0,
              length: 6,
              userMention: {
                user: { name: 'users/app', displayName: 'Conch', type: 'BOT' },
                type: 'MENTION',
              },
            },
          ],
        }),
      },
    };
    // What Google Chat itself keeps: the server's copy Conch reads back.
    this.#messages.set(event.message.name, { ...event.message, sender: from });
    return event;
  }

  /** A genuine Google token, but for another address (another Conch's, say). */
  async tokenFor(audience: string): Promise<string> {
    return new SignJWT({ email: 'chat@system.gserviceaccount.com', email_verified: true })
      .setProtectedHeader({ alg: 'RS256', kid: 'google-key', typ: 'JWT' })
      .setIssuer('https://accounts.google.com')
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(this.#google?.private as Key);
  }

  /** A token signed by a key Google never published, under a key id nobody knows. */
  async unknownKey(): Promise<string> {
    return new SignJWT({ email: 'chat@system.gserviceaccount.com', email_verified: true })
      .setProtectedHeader({
        alg: 'RS256',
        kid: `made-up-${randomBytes(4).toString('hex')}`,
        typ: 'JWT',
      })
      .setIssuer('https://accounts.google.com')
      .setAudience(this.#endpoint)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(this.#other as Key);
  }

  /** Post `body` with a token captured earlier (a replay), as someone who saw one could. */
  async replay(body: unknown, token = this.lastToken): Promise<number> {
    return this.#post(body, token);
  }

  /** An event signed the other way Google Chat can sign: for its project number. */
  async projectNumber(body: unknown): Promise<number> {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'chat-key', typ: 'JWT' })
      .setIssuer('chat@system.gserviceaccount.com')
      .setAudience('123456789012')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(await importPKCS8(CHAT_SA_KEY, 'RS256'));
    return this.#post(body, token);
  }

  async #post(body: unknown, token: string | undefined): Promise<number> {
    try {
      const response = await fetch(this.resolve(this.#endpoint), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token && { authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify(body),
      });
      return response.status;
    } catch {
      return 0;
    }
  }

  /** Send an event to the endpoint, signed as Google does (or wrong in one way). */
  async deliver(
    event: unknown,
    wrong?: 'key' | 'audience' | 'sender' | 'expired' | 'issuer' | 'none',
  ): Promise<number> {
    const token = wrong === 'none' ? undefined : await this.#token(wrong);
    if (token && !wrong) this.lastToken = token;
    return this.#post(event, token);
  }

  say(
    text: string,
    from = MockGoogleChat.OWNER,
    options: { space?: boolean; mention?: boolean } = {},
  ) {
    return this.deliver(this.event(text, from, options));
  }

  press(data: string, messageName: string, from = MockGoogleChat.OWNER) {
    const space = { name: this.dmOf(from.name), type: 'DM', spaceType: 'DIRECT_MESSAGE' };
    return this.deliver({
      type: 'CARD_CLICKED',
      eventTime: new Date().toISOString(),
      space,
      user: from,
      message: { name: messageName },
      action: { actionMethodName: 'conch', parameters: [{ key: 'data', value: data }] },
      common: { invokedFunction: 'conch', parameters: { data } },
    });
  }

  last(space = this.dmOf(MockGoogleChat.OWNER.name)) {
    return this.sent.filter((m) => m.space === space).at(-1);
  }
}
