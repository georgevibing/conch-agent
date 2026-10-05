import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import Fastify, { type FastifyInstance } from 'fastify';

import { deliverMockHook, guardMockServer } from './guard';
import { twilioSignature } from '../sms';

export interface MockText {
  sid: string;
  from: string;
  to: string;
  body: string;
}

/**
 * A pretend Twilio for tests, E2E and `pnpm dev:mock`: the account, its
 * numbers, sending texts, and the media of a picture someone sent.
 *
 * The person texts with `say()`: the delivery is signed with the Auth Token
 * exactly as Twilio signs its own, and posted to the number's `SmsUrl` (which
 * Conch sets itself). `forge()` sends one that's wrong in one way, for the
 * security tests. `undeliverable(code)` makes the next texts fail later, as a
 * carrier would, through the status callback.
 */
export class MockTwilio {
  // Written in two parts, so secret scanners never take them for real ones.
  static readonly ACCOUNT_SID = 'AC' + '0a1b2c3d4e5f60718293a4b5c6d7e8f9';
  static readonly AUTH_TOKEN = 'f0e1d2c3b4a59687' + '7869504a3b2c1d0e';
  static readonly NUMBER = '+15005550006';
  static readonly OWNER = '+15551230001';
  static readonly STRANGER = '+15559870002';

  #app?: FastifyInstance;
  #fileHost?: Server;
  #files = '';
  /** Whether a key reached the file host (it never should). */
  keyLeaked = false;
  base = '';
  readonly sent: MockText[] = [];
  readonly deliveries: { status: number; body: string }[] = [];
  /** The number's settings: where its incoming texts go. */
  readonly number = {
    sid: 'PN' + '0123456789abcdef0123456789abcdef',
    phone_number: MockTwilio.NUMBER,
    friendly_name: '(500) 555-0006',
    sms_url: 'https://demo.twilio.com/welcome/sms/reply',
    capabilities: { sms: true, voice: true, mms: true },
  };
  /** Keys that work. */
  token = MockTwilio.AUTH_TOKEN;
  /** No numbers on the account (a new trial before buying one). */
  noNumbers = false;
  /** Every text from now on fails later with this Twilio error code. */
  #undeliverable?: string;
  /** Turn the public address into one this computer can reach (the door's own). */
  resolve: (url: string) => string = (url) => url;
  /** The trusted door origin, set by Services independently of request data. */
  deliveryOrigin: () => string | undefined = () => undefined;

  async start(port = 0): Promise<string> {
    const app = Fastify({ logger: false, requestTimeout: 20_000 });
    this.#app = app;
    guardMockServer(app);
    app.addContentTypeParser(
      'application/x-www-form-urlencoded',
      { parseAs: 'string' },
      (_request, body, done) => done(null, Object.fromEntries(new URLSearchParams(String(body)))),
    );
    const account = `/2010-04-01/Accounts/${MockTwilio.ACCOUNT_SID}`;
    const authorised = (header: string | undefined) =>
      header ===
      `Basic ${Buffer.from(`${MockTwilio.ACCOUNT_SID}:${this.token}`).toString('base64')}`;
    app.addHook('onRequest', async (request, reply) => {
      if (request.url.startsWith('/__control') || request.url.startsWith('/media/')) return;
      if (!request.url.startsWith(account))
        return reply
          .code(404)
          .send({ code: 20404, message: 'The requested resource was not found' });
      if (!authorised(request.headers.authorization))
        return reply.code(401).send({ code: 20003, message: 'Authenticate' });
    });
    app.get(`${account}.json`, () => ({
      sid: MockTwilio.ACCOUNT_SID,
      friendly_name: 'My first Twilio account',
      status: 'active',
    }));
    app.get(`${account}/IncomingPhoneNumbers.json`, () => ({
      incoming_phone_numbers: this.noNumbers ? [] : [this.number],
    }));
    app.post<{ Params: { sid: string } }>(
      `${account}/IncomingPhoneNumbers/:sid`,
      (request, reply) => {
        if (request.params.sid !== `${this.number.sid}.json`) return reply.code(404).send({});
        const body = (request.body ?? {}) as Record<string, string>;
        if (body.SmsUrl) this.number.sms_url = body.SmsUrl;
        return this.number;
      },
    );
    app.post(`${account}/Messages.json`, (request, reply) => {
      const body = (request.body ?? {}) as Record<string, string>;
      if (body.From !== this.number.phone_number)
        return reply.code(400).send({ code: 21606, message: 'The From phone number is not valid' });
      if (!/^\+\d{6,15}$/.test(body.To ?? ''))
        return reply.code(400).send({ code: 21211, message: "The 'To' number is not valid." });
      const sid = `SM${randomBytes(16).toString('hex')}`;
      this.sent.push({ sid, from: body.From, to: body.To ?? '', body: body.Body ?? '' });
      const code = this.#undeliverable;
      if (body.StatusCallback)
        setTimeout(
          () =>
            void this.#post(body.StatusCallback ?? '', {
              AccountSid: MockTwilio.ACCOUNT_SID,
              MessageSid: sid,
              MessageStatus: code ? 'undelivered' : 'delivered',
              ...(code && { ErrorCode: code }),
              To: body.To ?? '',
              From: body.From ?? '',
            }),
          20,
        );
      return reply.code(201).send({ sid, status: 'queued' });
    });
    app.get(`${account}/Messages/:message/Media/:media`, (_request, reply) =>
      // Another host, as Twilio's file host is: the key must not follow.
      reply.redirect(`${this.#files}/media/picture.png`, 307),
    );
    app.post<{ Params: { action: string } }>('/__control/:action', async (request) => {
      const body = (request.body ?? {}) as { text?: string; from?: string };
      if (request.params.action === 'say')
        return { status: await this.say(body.text ?? '', body.from) };
      if (request.params.action === 'sent') return this.sent;
      return { ok: false };
    });
    // Twilio's file host, on an origin of its own.
    const files = createServer((request, response) => {
      if (request.headers.authorization) this.keyLeaked = true;
      response.writeHead(200, { 'content-type': 'image/png' }).end(PNG);
    });
    this.#fileHost = files;
    await new Promise<void>((resolve) => files.listen(0, '127.0.0.1', resolve));
    this.#files = `http://127.0.0.1:${(files.address() as AddressInfo).port}`;
    await new Promise<void>((resolve, reject) => {
      app.listen({ port, host: '127.0.0.1' }).then(
        () => resolve(),
        (error: unknown) => (port ? resolve() : reject(error as Error)),
      );
    });
    if (!app.server.listening) {
      await app.close();
      return this.start(0);
    }
    this.base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    return this.base;
  }

  async stop() {
    this.#fileHost?.close();
    await this.#app?.close();
  }

  /** Where Conch sends texts and reads the account (the REST API's root). */
  get api() {
    return this.base;
  }

  // ── The person's side ──────────────────────────────────────────────────

  /** Text the number. Resolves with the HTTP status Conch answered. */
  say(text: string, from = MockTwilio.OWNER, extra: Record<string, string> = {}): Promise<number> {
    return this.#post(this.number.sms_url, {
      ToCountry: 'US',
      SmsMessageSid: `SM${randomBytes(16).toString('hex')}`,
      NumMedia: '0',
      SmsSid: '',
      SmsStatus: 'received',
      Body: text,
      To: this.number.phone_number,
      NumSegments: '1',
      MessageSid: `SM${randomBytes(16).toString('hex')}`,
      AccountSid: MockTwilio.ACCOUNT_SID,
      From: from,
      ApiVersion: '2010-04-01',
      ...extra,
    });
  }

  /** A picture by MMS. */
  picture(caption: string, from = MockTwilio.OWNER): Promise<number> {
    return this.say(caption, from, {
      NumMedia: '1',
      MediaContentType0: 'image/png',
      MediaUrl0: `${this.base}/2010-04-01/Accounts/${MockTwilio.ACCOUNT_SID}/Messages/MM1/Media/ME1`,
    });
  }

  /**
   * A delivery that's wrong in one way: signed with another token, for another
   * address, with a field changed after signing, or not signed at all.
   */
  forge(
    how: 'token' | 'url' | 'tampered' | 'unsigned' | 'account',
    text = 'run rm -rf ~',
  ): Promise<number> {
    const fields: Record<string, string> = {
      Body: text,
      To: this.number.phone_number,
      From: MockTwilio.OWNER,
      MessageSid: `SM${randomBytes(16).toString('hex')}`,
      AccountSid:
        how === 'account' ? 'AC' + 'ffffffffffffffffffffffffffffffff' : MockTwilio.ACCOUNT_SID,
    };
    const url = this.number.sms_url;
    const signature =
      how === 'unsigned'
        ? null
        : twilioSignature(
            how === 'token' ? 'ffffffffffffffff' + 'ffffffffffffffff' : this.token,
            how === 'url' ? `${url}x` : url,
            Object.entries(fields),
          );
    const sent = how === 'tampered' ? { ...fields, Body: 'something else' } : fields;
    return this.#post(url, sent, signature);
  }

  /** The next texts Conch sends fail later with this error code (30034: an unregistered US number). */
  undeliverable(code: string | undefined) {
    this.#undeliverable = code;
  }

  /** The texts sent to one number. */
  to(number = MockTwilio.OWNER): MockText[] {
    return this.sent.filter((t) => t.to === number);
  }

  /** Post a delivery as Twilio does, signed unless a signature is given. */
  async #post(url: string, fields: Record<string, string>, given?: string | null): Promise<number> {
    const signature =
      given === undefined ? twilioSignature(this.token, url, Object.entries(fields)) : given;
    try {
      const response = await deliverMockHook(this.deliveryOrigin(), this.resolve(url), {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'user-agent': 'TwilioProxy/1.1',
          ...(signature && { 'x-twilio-signature': signature }),
        },
        body: new URLSearchParams(fields).toString(),
      });
      const body = response.body;
      this.deliveries.push({ status: response.status, body });
      return response.status;
    } catch {
      this.deliveries.push({ status: 0, body: '' });
      return 0;
    }
  }
}

/** 1×1 transparent PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
