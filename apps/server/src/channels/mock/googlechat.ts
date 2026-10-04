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
  jwtVerify,
} from 'jose';

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
    app.get('/certs', () => ({
      keys: [{ ...this.#google?.public, kid: 'google-key', alg: 'RS256', use: 'sig' }],
    }));
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
      record(space, request.body as { text?: string }, name);
      return { name };
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
    return {
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
  }

  /** Send an event to the endpoint, signed as Google does (or wrong in one way). */
  async deliver(
    event: unknown,
    wrong?: 'key' | 'audience' | 'sender' | 'expired' | 'issuer' | 'none',
  ): Promise<number> {
    const token = wrong === 'none' ? undefined : await this.#token(wrong);
    try {
      const response = await fetch(this.resolve(this.#endpoint), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token && { authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify(event),
      });
      return response.status;
    } catch {
      return 0;
    }
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
