import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import Fastify, { type FastifyInstance } from 'fastify';

import { cryptoSdk } from '../matrix-crypto';

type Sdk = Awaited<ReturnType<typeof cryptoSdk>>;
type Olm = InstanceType<Sdk['OlmMachine']>;

interface Event {
  type: string;
  sender: string;
  event_id: string;
  origin_server_ts: number;
  content: Record<string, unknown>;
  state_key?: string;
  room_id: string;
}

interface Room {
  id: string;
  members: Map<string, 'join' | 'invite' | 'leave'>;
  direct: Set<string>;
  encrypted: boolean;
}

/** Something that happened, in order; a sync returns what's new since its token. */
type Item =
  | { kind: 'event'; at: number; room: string; event: Event }
  | { kind: 'invite'; at: number; room: string; user: string; sender: string; direct: boolean }
  | { kind: 'keys'; at: number; user: string };

export interface MockMatrixSeen {
  event_id: string;
  type: string;
  text: string;
  html?: string;
  encrypted: boolean;
  edits?: string;
  reaction?: string;
}

/**
 * A pretend Matrix homeserver for tests, E2E and `pnpm dev:mock`: the
 * client-server API Conch uses (sign-in, sync, rooms, typing, receipts,
 * media, account data) and the end-to-end encryption endpoints (keys,
 * one-time keys, to-device), so encrypted rooms work as they do on
 * matrix.org.
 *
 * The person on the other side is a pretend Element with its own copy of
 * Matrix's Rust crypto: `dm()` opens a direct message (encrypted unless
 * asked not to), `say()` writes in it, `react()` taps a reaction, and
 * `seen()` reads what the bot wrote, decrypted. Tests break things with
 * `signOut()` (the bot's session ends), `slowDown()` (429s), `down()`.
 */
export class MockMatrix {
  #app?: FastifyInstance;
  #items: Item[] = [];
  #clock = 1;
  #waiters = new Set<() => void>();
  #rooms = new Map<string, Room>();
  #tokens = new Map<string, { user: string; device: string }>();
  #keys = new Map<string, Record<string, unknown>>();
  #otks = new Map<string, Record<string, unknown>>();
  #fallback = new Map<string, Record<string, unknown>>();
  #inbox = new Map<string, unknown[]>();
  #accountData = new Map<string, Record<string, unknown>>();
  #profiles = new Map<string, { displayname?: string; avatar_url?: string }>();
  #media = new Map<string, { bytes: Buffer; type: string }>();
  #owner?: { olm: Olm; sdk: Sdk; cursor: number; device: string };
  /** A second session of Ada's that her account never signed (one a homeserver slipped in). */
  #impostor?: { olm: Olm; sdk: Sdk; cursor: number; device: string };
  /** Cross-signing keys, by user: master, self-signing, user-signing. */
  #signing = new Map<string, Record<string, unknown>>();
  #limit = 0;
  #down = false;
  base = '';
  readonly calls: { method: string; path: string }[] = [];
  readonly typing: string[] = [];
  readonly receipts: string[] = [];

  static readonly SERVER = 'mock.local';
  static readonly BOT = '@conch:mock.local';
  static readonly PASSWORD = 'correct horse battery staple';
  static readonly OWNER = '@ada:mock.local';
  static readonly OWNER_DEVICE = 'ADAPHONE';
  static readonly STRANGER = '@grace:mock.local';

  constructor() {
    this.#profiles.set(MockMatrix.BOT, { displayname: 'conch' });
    this.#profiles.set(MockMatrix.OWNER, { displayname: 'Ada Lovelace' });
    this.#profiles.set(MockMatrix.STRANGER, { displayname: 'Grace Hopper' });
  }

  async start(port = 0): Promise<string> {
    const app = Fastify({ logger: false, bodyLimit: 10 * 1024 * 1024 });
    this.#app = app;
    app.addContentTypeParser(
      ['image/jpeg', 'image/png', 'application/octet-stream'],
      { parseAs: 'buffer' },
      (_request, body, done) => done(null, body),
    );
    app.get('/.well-known/matrix/client', () => ({ 'm.homeserver': { base_url: this.base } }));
    app.get('/_matrix/client/versions', () => ({ versions: ['v1.11'] }));
    app.post<{ Params: { action: string } }>('/__control/:action', (request) =>
      this.#control(request.params.action, (request.body ?? {}) as Record<string, unknown>),
    );
    app.route({
      method: ['GET', 'POST', 'PUT'],
      url: '/_matrix/*',
      handler: async (request, reply) => {
        const path = request.url.split('?')[0] ?? '';
        this.calls.push({ method: request.method, path });
        if (this.#down) return reply.code(502).send({});
        if (this.#limit > 0) {
          this.#limit--;
          return reply
            .code(429)
            .send({ errcode: 'M_LIMIT_EXCEEDED', error: 'Too many', retry_after_ms: 50 });
        }
        const token = request.headers.authorization?.replace(/^Bearer /, '');
        const result = await this.#route(
          request.method,
          path,
          (request.query ?? {}) as Record<string, string>,
          request.body,
          token,
          request.headers['content-type'],
        );
        if (result.status !== 200 && result.status !== undefined)
          return reply.code(result.status).send(result.body);
        if (result.raw) return reply.type(result.raw.type).send(result.raw.bytes);
        return result.body;
      },
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
    for (const wake of this.#waiters) wake();
    await this.#app?.close();
  }

  // ── The person's side (a pretend Element) ──────────────────────────────

  /** Ada's phone, with its own encryption keys. */
  async #element(impostor = false) {
    const known = impostor ? this.#impostor : this.#owner;
    if (known) return known;
    const sdk = await cryptoSdk();
    const device = impostor ? 'NOTADA' : MockMatrix.OWNER_DEVICE;
    const olm = await sdk.OlmMachine.initialize(
      new sdk.UserId(MockMatrix.OWNER),
      new sdk.DeviceId(device),
      `mock-element-${randomBytes(4).toString('hex')}`,
      'element',
    );
    const phone = { olm, sdk, cursor: 0, device };
    if (impostor) this.#impostor = phone;
    else this.#owner = phone;
    await this.#elementFlush(phone);
    if (!impostor) {
      // Element sets up cross-signing and signs its own session, as it does at sign-up.
      const boot = await olm.bootstrapCrossSigning(true);
      const upload = boot.uploadKeysRequest as
        { id: string; type: number; body: string } | undefined;
      if (upload)
        await olm.markRequestAsSent(
          upload.id,
          upload.type,
          JSON.stringify(
            this.#upload(
              MockMatrix.OWNER,
              device,
              JSON.parse(upload.body) as Record<string, unknown>,
            ),
          ),
        );
      this.#signingUpload(
        MockMatrix.OWNER,
        JSON.parse(boot.uploadSigningKeysRequest.body) as Record<string, unknown>,
      );
      const signatures = boot.uploadSignaturesRequest;
      this.#signatures(
        JSON.parse(signatures.body) as Record<string, Record<string, Record<string, unknown>>>,
      );
      if (signatures.id)
        await olm.markRequestAsSent(
          signatures.id,
          signatures.type,
          JSON.stringify({ failures: {} }),
        );
      await this.#elementFlush(phone);
    }
    return phone;
  }

  async #elementFlush(phone = this.#owner) {
    const owner = phone;
    if (!owner) return;
    for (let i = 0; i < 5; i++) {
      const requests = await owner.olm.outgoingRequests();
      if (!requests.length) return;
      for (const r of requests as unknown as {
        id: string;
        type: number;
        body: string;
        event_type?: string;
      }[]) {
        const body = JSON.parse(r.body || '{}') as Record<string, unknown>;
        const T = owner.sdk.RequestType;
        const answer =
          r.type === T.KeysUpload
            ? this.#upload(MockMatrix.OWNER, owner.device, body)
            : r.type === T.KeysQuery
              ? this.#query(body)
              : r.type === T.KeysClaim
                ? this.#claim(body)
                : r.type === T.ToDevice
                  ? this.#toDevice(MockMatrix.OWNER, r.event_type ?? '', body)
                  : r.type === T.SignatureUpload
                    ? (this.#signatures(
                        body as Record<string, Record<string, Record<string, unknown>>>,
                      ),
                      { failures: {} })
                    : {};
        await owner.olm.markRequestAsSent(r.id, r.type, JSON.stringify(answer));
      }
    }
  }

  /** What reached Ada's phone since it last looked: keys sent to it, and the room key. */
  async #elementSync(impostor = false) {
    const owner = await this.#element(impostor);
    const key = `${MockMatrix.OWNER}|${owner.device}`;
    const inbox = this.#inbox.get(key) ?? [];
    this.#inbox.set(key, []);
    const changed = this.#items
      .slice(owner.cursor)
      .flatMap((item) => (item.kind === 'keys' ? [new owner.sdk.UserId(item.user)] : []));
    owner.cursor = this.#items.length;
    await owner.olm.receiveSyncChanges(
      JSON.stringify(inbox),
      new owner.sdk.DeviceLists(changed, []),
      new Map([['signed_curve25519', Object.keys(this.#otks.get(key) ?? {}).length]]),
      new Set(),
    );
    await this.#elementFlush(owner);
  }

  /** Ada opens a direct message with the bot (encrypted, as Element does when it can). */
  async dm(options: { encrypted?: boolean; from?: string } = {}): Promise<string> {
    const from = options.from ?? MockMatrix.OWNER;
    const id = `!${randomBytes(6).toString('hex')}:${MockMatrix.SERVER}`;
    const room: Room = {
      id,
      members: new Map([[from, 'join']]),
      direct: new Set([from]),
      encrypted: false,
    };
    this.#rooms.set(id, room);
    this.#state(room, from, 'm.room.create', '', { creator: from });
    this.#state(room, from, 'm.room.member', from, {
      membership: 'join',
      displayname: this.#profiles.get(from)?.displayname,
    });
    if (options.encrypted !== false) {
      room.encrypted = true;
      this.#state(room, from, 'm.room.encryption', '', { algorithm: 'm.megolm.v1.aes-sha2' });
    }
    room.members.set(MockMatrix.BOT, 'invite');
    this.#push({
      kind: 'invite',
      at: 0,
      room: id,
      user: MockMatrix.BOT,
      sender: from,
      direct: true,
    });
    return id;
  }

  /** A group with someone else in it. */
  group(from = MockMatrix.OWNER): string {
    const id = `!${randomBytes(6).toString('hex')}:${MockMatrix.SERVER}`;
    const room: Room = {
      id,
      members: new Map([
        [from, 'join'],
        [MockMatrix.STRANGER, 'join'],
        [MockMatrix.BOT, 'invite'],
      ]),
      direct: new Set(),
      encrypted: false,
    };
    this.#rooms.set(id, room);
    this.#state(room, from, 'm.room.member', from, { membership: 'join' });
    this.#state(room, MockMatrix.STRANGER, 'm.room.member', MockMatrix.STRANGER, {
      membership: 'join',
    });
    this.#push({
      kind: 'invite',
      at: 0,
      room: id,
      user: MockMatrix.BOT,
      sender: from,
      direct: false,
    });
    return id;
  }

  /** The room Ada and the bot share (the last one opened). */
  roomOf(user = MockMatrix.OWNER): string | undefined {
    return [...this.#rooms.values()]
      .filter(
        (r) =>
          r.members.get(user) === 'join' && r.members.has(MockMatrix.BOT) && r.members.size === 2,
      )
      .at(-1)?.id;
  }

  async say(
    text: string,
    options: { room?: string; from?: string; impostor?: boolean } = {},
  ): Promise<string> {
    const from = options.from ?? MockMatrix.OWNER;
    const roomId = options.room ?? this.roomOf(from);
    const room = roomId ? this.#rooms.get(roomId) : undefined;
    if (!room) throw new Error('No room with the bot yet: call dm() first.');
    return this.#write(
      room,
      from,
      'm.room.message',
      { msgtype: 'm.text', body: text },
      options.impostor,
    );
  }

  async react(eventId: string, key: string, options: { room?: string } = {}): Promise<string> {
    const room = this.#rooms.get(options.room ?? this.roomOf() ?? '');
    if (!room) throw new Error('No room.');
    return this.#write(room, MockMatrix.OWNER, 'm.reaction', {
      'm.relates_to': { rel_type: 'm.annotation', event_id: eventId, key },
    });
  }

  /** A file Ada sends (kept here as media). */
  async sendFile(name: string, bytes: Buffer, type: string): Promise<string> {
    const room = this.#rooms.get(this.roomOf() ?? '');
    if (!room) throw new Error('No room.');
    const mediaId = randomBytes(6).toString('hex');
    this.#media.set(mediaId, { bytes, type });
    return this.#write(room, MockMatrix.OWNER, 'm.room.message', {
      msgtype: type.startsWith('image/') ? 'm.image' : 'm.file',
      body: name,
      url: `mxc://${MockMatrix.SERVER}/${mediaId}`,
      info: { mimetype: type, size: bytes.length },
    });
  }

  async #write(
    room: Room,
    from: string,
    type: string,
    content: Record<string, unknown>,
    impostor = false,
  ) {
    if (room.encrypted && from === MockMatrix.OWNER) {
      const owner = await this.#element(impostor);
      await this.#elementSync(impostor);
      // The crypto takes what it's handed: each call gets ids of its own.
      const users = () => [...room.members.keys()].map((u) => new owner.sdk.UserId(u));
      await owner.olm.updateTrackedUsers(users());
      await this.#elementFlush(owner);
      const claim = await owner.olm.getMissingSessions(users());
      if (claim)
        await owner.olm.markRequestAsSent(
          claim.id,
          claim.type,
          JSON.stringify(this.#claim(JSON.parse(claim.body) as Record<string, unknown>)),
        );
      const roomId = new owner.sdk.RoomId(room.id);
      for (const share of await owner.olm.shareRoomKey(
        roomId,
        users(),
        new owner.sdk.EncryptionSettings(),
      ))
        await owner.olm.markRequestAsSent(
          share.id,
          share.type,
          JSON.stringify(
            this.#toDevice(
              MockMatrix.OWNER,
              share.event_type,
              JSON.parse(share.body) as Record<string, unknown>,
            ),
          ),
        );
      const encrypted = JSON.parse(
        await owner.olm.encryptRoomEvent(
          new owner.sdk.RoomId(room.id),
          type,
          JSON.stringify(content),
        ),
      ) as Record<string, unknown>;
      return this.#event(room, from, 'm.room.encrypted', encrypted).event_id;
    }
    return this.#event(room, from, type, content).event_id;
  }

  /** What the bot wrote in a room, as Ada's phone shows it (decrypted). */
  async seen(roomId = this.roomOf()): Promise<MockMatrixSeen[]> {
    const owner = await this.#element();
    await this.#elementSync();
    const out: MockMatrixSeen[] = [];
    for (const item of this.#items) {
      if (item.kind !== 'event' || item.room !== roomId || item.event.sender !== MockMatrix.BOT)
        continue;
      let event = item.event;
      const encrypted = event.type === 'm.room.encrypted';
      if (encrypted) {
        try {
          const clear = await owner.olm.decryptRoomEvent(
            JSON.stringify(event),
            new owner.sdk.RoomId(item.room),
            new owner.sdk.DecryptionSettings(owner.sdk.TrustRequirement.Untrusted),
          );
          event = {
            ...event,
            ...(JSON.parse(clear.event) as { type: string; content: Record<string, unknown> }),
          };
        } catch {
          out.push({
            event_id: event.event_id,
            type: 'm.room.encrypted',
            text: '(unable to decrypt)',
            encrypted,
          });
          continue;
        }
      }
      const c = event.content;
      const relates = c['m.relates_to'] as
        { rel_type?: string; event_id?: string; key?: string } | undefined;
      out.push({
        event_id: event.event_id,
        type: event.type,
        text: typeof c.body === 'string' ? c.body : '',
        ...(typeof c.formatted_body === 'string' && { html: c.formatted_body }),
        encrypted,
        ...(relates?.rel_type === 'm.replace' && relates.event_id && { edits: relates.event_id }),
        ...(relates?.rel_type === 'm.annotation' && relates.key && { reaction: relates.key }),
      });
    }
    return out;
  }

  // ── Breaking it on purpose ─────────────────────────────────────────────

  /** The bot's session is ended elsewhere (signed out from Element). */
  signOut() {
    for (const [token, who] of this.#tokens)
      if (who.user === MockMatrix.BOT) this.#tokens.delete(token);
    for (const wake of this.#waiters) wake();
  }

  slowDown(requests = 3) {
    this.#limit = requests;
  }

  down(on = true) {
    this.#down = on;
    for (const wake of this.#waiters) wake();
  }

  /** Bot sessions that were made (devices), and whether they're still signed in. */
  sessions(): { device: string; active: boolean }[] {
    const active = new Set(
      [...this.#tokens.values()].filter((t) => t.user === MockMatrix.BOT).map((t) => t.device),
    );
    return [...this.#keysDevices(MockMatrix.BOT), ...active]
      .filter((d, i, all) => all.indexOf(d) === i)
      .map((device) => ({ device, active: active.has(device) }));
  }

  #keysDevices(user: string) {
    return Object.keys(this.#keys.get(user) ?? {});
  }

  // ── Wire ───────────────────────────────────────────────────────────────

  #push(item: Item) {
    this.#items.push({ ...item, at: this.#clock++ } as Item);
    for (const wake of this.#waiters) wake();
  }

  #event(
    room: Room,
    sender: string,
    type: string,
    content: Record<string, unknown>,
    stateKey?: string,
  ): Event {
    const event: Event = {
      type,
      sender,
      event_id: `$${randomBytes(8).toString('base64url')}`,
      origin_server_ts: Date.now(),
      content,
      room_id: room.id,
      ...(stateKey !== undefined && { state_key: stateKey }),
    };
    this.#push({ kind: 'event', at: 0, room: room.id, event });
    return event;
  }

  #state(room: Room, sender: string, type: string, key: string, content: Record<string, unknown>) {
    return this.#event(room, sender, type, content, key);
  }

  async #control(action: string, body: Record<string, unknown>) {
    const text = typeof body.text === 'string' ? body.text : '';
    switch (action) {
      case 'dm':
        return {
          room: await this.dm({
            encrypted: body.encrypted !== false,
            ...(typeof body.from === 'string' && { from: body.from }),
          }),
        };
      case 'say':
        return {
          event_id: await this.say(text, typeof body.from === 'string' ? { from: body.from } : {}),
        };
      case 'react':
        return { event_id: await this.react(String(body.event_id ?? ''), String(body.key ?? '')) };
      case 'seen':
        return this.seen(typeof body.room === 'string' ? body.room : undefined);
      case 'sign-out':
        this.signOut();
        return { ok: true };
      default:
        return { ok: false };
    }
  }

  #who(token: string | undefined) {
    return token ? this.#tokens.get(token) : undefined;
  }

  async #route(
    method: string,
    path: string,
    query: Record<string, string>,
    body: unknown,
    token: string | undefined,
    type: string | undefined,
  ): Promise<{ status?: number; body?: unknown; raw?: { type: string; bytes: Buffer } }> {
    const json = (body ?? {}) as Record<string, unknown>;
    const p = path
      .replace(/^\/_matrix\/client\/(v3|v1)/, '')
      .replace(/^\/_matrix\/media\/v3/, '/media');
    if (method === 'POST' && p === '/login') {
      const id = (json.identifier as { user?: string } | undefined)?.user ?? '';
      const user = id.startsWith('@') ? id : `@${id}:${MockMatrix.SERVER}`;
      if (user !== MockMatrix.BOT || json.password !== MockMatrix.PASSWORD)
        return {
          status: 403,
          body: { errcode: 'M_FORBIDDEN', error: 'Invalid username or password' },
        };
      const access = `syt_${randomBytes(12).toString('base64url')}`;
      const device = `CONCH${randomBytes(3).toString('hex').toUpperCase()}`;
      this.#tokens.set(access, { user, device });
      return { body: { access_token: access, device_id: device, user_id: user } };
    }
    if (p.startsWith('/profile/') && method === 'GET') {
      const user = decodeURIComponent(p.split('/')[2] ?? '');
      return { body: this.#profiles.get(user) ?? {} };
    }
    // Thumbnails and downloads need the token since authenticated media (Matrix 1.11).
    const who = this.#who(token);
    if (!who)
      return {
        status: 401,
        body: { errcode: 'M_UNKNOWN_TOKEN', error: 'Unknown token', soft_logout: false },
      };
    const { user, device } = who;
    const parts = p.split('/').map((s) => decodeURIComponent(s));
    if (p === '/account/whoami') return { body: { user_id: user, device_id: device } };
    if (p === '/logout') {
      if (token) this.#tokens.delete(token);
      return { body: {} };
    }
    if (p.startsWith('/profile/') && method === 'PUT') {
      const field = parts[3] ?? '';
      const now = this.#profiles.get(user) ?? {};
      this.#profiles.set(user, { ...now, [field]: json[field] });
      return { body: {} };
    }
    if (p === '/media/upload' && method === 'POST') {
      const id = randomBytes(6).toString('hex');
      this.#media.set(id, {
        bytes: Buffer.isBuffer(body) ? body : Buffer.alloc(0),
        type: type ?? 'application/octet-stream',
      });
      return { body: { content_uri: `mxc://${MockMatrix.SERVER}/${id}` } };
    }
    if (p.startsWith('/media/download/') || p.startsWith('/media/thumbnail/')) {
      const media = this.#media.get(parts[4] ?? '');
      if (!media) return { status: 404, body: { errcode: 'M_NOT_FOUND' } };
      return { raw: { type: media.type, bytes: media.bytes } };
    }
    if (p === '/sync') return { body: await this.#sync(user, device, query) };
    if (p === '/keys/upload') return { body: this.#upload(user, device, json) };
    if (p === '/keys/query') return { body: this.#query(json) };
    if (p === '/keys/claim') return { body: this.#claim(json) };
    if (p === '/keys/signatures/upload') {
      this.#signatures(json as Record<string, Record<string, Record<string, unknown>>>);
      return { body: { failures: {} } };
    }
    if (p === '/keys/device_signing/upload') {
      this.#signingUpload(user, json);
      return { body: {} };
    }
    if (p.startsWith('/sendToDevice/')) return { body: this.#toDevice(user, parts[2] ?? '', json) };
    if (p.startsWith('/join/')) {
      const room = this.#rooms.get(parts[2] ?? '');
      if (!room || !room.members.has(user))
        return { status: 403, body: { errcode: 'M_FORBIDDEN' } };
      room.members.set(user, 'join');
      this.#state(room, user, 'm.room.member', user, { membership: 'join', displayname: 'conch' });
      return { body: { room_id: room.id } };
    }
    if (p === '/createRoom') {
      const id = `!${randomBytes(6).toString('hex')}:${MockMatrix.SERVER}`;
      const room: Room = {
        id,
        members: new Map([[user, 'join']]),
        direct: new Set(),
        encrypted: false,
      };
      this.#rooms.set(id, room);
      this.#state(room, user, 'm.room.member', user, { membership: 'join' });
      for (const s of (json.initial_state as
        { type: string; state_key: string; content: Record<string, unknown> }[] | undefined) ??
        []) {
        if (s.type === 'm.room.encryption') room.encrypted = true;
        this.#state(room, user, s.type, s.state_key, s.content);
      }
      for (const invited of (json.invite as string[] | undefined) ?? []) {
        // Ada's phone accepts at once.
        room.members.set(invited, 'join');
        this.#state(room, invited, 'm.room.member', invited, {
          membership: 'join',
          displayname: this.#profiles.get(invited)?.displayname,
        });
      }
      return { body: { room_id: id } };
    }
    if (parts[1] === 'user' && parts[3] === 'account_data') {
      const key = `${user}|${parts[4]}`;
      if (method === 'PUT') this.#accountData.set(key, json);
      return { body: this.#accountData.get(key) ?? {} };
    }
    if (parts[1] === 'rooms') {
      const room = this.#rooms.get(parts[2] ?? '');
      if (!room) return { status: 404, body: { errcode: 'M_NOT_FOUND' } };
      const what = parts[3];
      if (what === 'joined_members')
        return {
          body: {
            joined: Object.fromEntries(
              [...room.members]
                .filter(([, m]) => m === 'join')
                .map(([u]) => [u, { display_name: this.#profiles.get(u)?.displayname }]),
            ),
          },
        };
      if (what === 'state' && parts[4] === 'm.room.encryption')
        return room.encrypted
          ? { body: { algorithm: 'm.megolm.v1.aes-sha2' } }
          : { status: 404, body: { errcode: 'M_NOT_FOUND' } };
      if (what === 'leave') {
        room.members.set(user, 'leave');
        this.#state(room, user, 'm.room.member', user, {
          membership: 'leave',
          ...(typeof json.reason === 'string' && { reason: json.reason }),
        });
        return { body: {} };
      }
      if (what === 'typing') {
        this.typing.push(room.id);
        return { body: {} };
      }
      if (what === 'receipt') {
        this.receipts.push(parts[5] ?? '');
        return { body: {} };
      }
      if (what === 'send') {
        if (room.members.get(user) !== 'join')
          return { status: 403, body: { errcode: 'M_FORBIDDEN' } };
        const event = this.#event(room, user, parts[4] ?? '', json);
        return { body: { event_id: event.event_id } };
      }
    }
    return {
      status: 404,
      body: { errcode: 'M_UNRECOGNIZED', error: `Unknown: ${method} ${path}` },
    };
  }

  #upload(user: string, device: string, body: Record<string, unknown>) {
    const key = `${user}|${device}`;
    if (body.device_keys) {
      const all = this.#keys.get(user) ?? {};
      all[device] = body.device_keys;
      this.#keys.set(user, all);
      this.#push({ kind: 'keys', at: 0, user });
    }
    const otks = {
      ...(this.#otks.get(key) ?? {}),
      ...((body.one_time_keys as Record<string, unknown> | undefined) ?? {}),
    };
    this.#otks.set(key, otks);
    if (body.fallback_keys) this.#fallback.set(key, body.fallback_keys as Record<string, unknown>);
    return { one_time_key_counts: { signed_curve25519: Object.keys(otks).length } };
  }

  #query(body: Record<string, unknown>) {
    const wanted = (body.device_keys ?? {}) as Record<string, string[]>;
    const device_keys: Record<string, unknown> = {};
    const master_keys: Record<string, unknown> = {};
    const self_signing_keys: Record<string, unknown> = {};
    for (const user of Object.keys(wanted)) {
      const all = this.#keys.get(user) ?? {};
      const only = wanted[user] ?? [];
      device_keys[user] = only.length
        ? Object.fromEntries(Object.entries(all).filter(([d]) => only.includes(d)))
        : all;
      const signing = this.#signing.get(user);
      if (signing?.master_key) master_keys[user] = signing.master_key;
      if (signing?.self_signing_key) self_signing_keys[user] = signing.self_signing_key;
    }
    return { device_keys, master_keys, self_signing_keys, failures: {} };
  }

  #signingUpload(user: string, body: Record<string, unknown>) {
    this.#signing.set(user, { ...(this.#signing.get(user) ?? {}), ...body });
    this.#push({ kind: 'keys', at: 0, user });
  }

  /** Signatures added to the keys they sign (a device signed by its account's self-signing key). */
  #signatures(body: Record<string, Record<string, Record<string, unknown>>>) {
    for (const [user, signed] of Object.entries(body)) {
      for (const [id, object] of Object.entries(signed)) {
        const devices = this.#keys.get(user) ?? {};
        const target = (devices[id] ??
          (this.#signing.get(user)?.master_key as Record<string, unknown> | undefined)) as
          { signatures?: Record<string, Record<string, string>> } | undefined;
        if (!target) continue;
        const add =
          (object as { signatures?: Record<string, Record<string, string>> }).signatures ?? {};
        for (const [signer, sigs] of Object.entries(add))
          target.signatures = {
            ...target.signatures,
            [signer]: { ...target.signatures?.[signer], ...sigs },
          };
      }
      this.#push({ kind: 'keys', at: 0, user });
    }
  }

  #claim(body: Record<string, unknown>) {
    const out: Record<string, Record<string, unknown>> = {};
    for (const [user, devices] of Object.entries(
      (body.one_time_keys ?? {}) as Record<string, Record<string, string>>,
    ))
      for (const device of Object.keys(devices)) {
        const key = `${user}|${device}`;
        const otks = this.#otks.get(key) ?? {};
        const first = Object.keys(otks)[0];
        let claimed: Record<string, unknown> | undefined;
        if (first) {
          claimed = { [first]: otks[first] };
          // One-time keys are used once.
          this.#otks.set(
            key,
            Object.fromEntries(Object.entries(otks).filter(([id]) => id !== first)),
          );
        } else {
          const fallback = this.#fallback.get(key) ?? {};
          const f = Object.keys(fallback)[0];
          if (f) claimed = { [f]: fallback[f] };
        }
        if (claimed) (out[user] ??= {})[device] = claimed;
      }
    return { one_time_keys: out, failures: {} };
  }

  #toDevice(sender: string, type: string, body: Record<string, unknown>) {
    for (const [user, devices] of Object.entries(
      (body.messages ?? {}) as Record<string, Record<string, unknown>>,
    ))
      for (const [device, content] of Object.entries(devices)) {
        const targets = device === '*' ? Object.keys(this.#keys.get(user) ?? {}) : [device];
        for (const d of targets) {
          const key = `${user}|${d}`;
          this.#inbox.set(key, [...(this.#inbox.get(key) ?? []), { type, sender, content }]);
        }
      }
    for (const wake of this.#waiters) wake();
    return {};
  }

  async #sync(user: string, device: string, query: Record<string, string>) {
    const since = Number(query.since ?? 0);
    const key = `${user}|${device}`;
    const pending = () =>
      this.#items.some((item) => item.at > since && this.#concerns(user, item)) ||
      (this.#inbox.get(key)?.length ?? 0) > 0;
    const timeout = Math.min(Number(query.timeout ?? 0), 1_500);
    if (!pending() && timeout > 0)
      await new Promise<void>((resolve) => {
        const wake = () => {
          clearTimeout(timer);
          this.#waiters.delete(wake);
          resolve();
        };
        const timer = setTimeout(wake, timeout);
        this.#waiters.add(wake);
      });
    if (
      !this.#tokens.has(
        [...this.#tokens].find(([, t]) => t.user === user && t.device === device)?.[0] ?? '',
      )
    )
      return { next_batch: String(this.#clock) };
    const join: Record<string, { timeline: { events: Event[] }; state: { events: Event[] } }> = {};
    const invite: Record<string, { invite_state: { events: unknown[] } }> = {};
    const changed = new Set<string>();
    // A room just joined comes with what was said there before, as a homeserver sends it.
    const joinedNow = new Set(
      this.#items.flatMap((item) =>
        item.kind === 'event' &&
        item.at > since &&
        item.event.type === 'm.room.member' &&
        item.event.state_key === user &&
        item.event.content.membership === 'join'
          ? [item.room]
          : [],
      ),
    );
    for (const item of this.#items) {
      if (item.at <= since && !(item.kind === 'event' && joinedNow.has(item.room))) continue;
      if (item.kind === 'keys') {
        if (item.user !== user) changed.add(item.user);
        continue;
      }
      if (item.kind === 'invite') {
        if (item.user !== user) continue;
        const room = this.#rooms.get(item.room);
        if (room?.members.get(user) !== 'invite') continue;
        invite[item.room] = {
          invite_state: {
            events: [
              {
                type: 'm.room.member',
                state_key: user,
                sender: item.sender,
                content: { membership: 'invite', is_direct: item.direct },
              },
              ...[...room.members]
                .filter(([u]) => u !== user)
                .map(([u, m]) => ({
                  type: 'm.room.member',
                  state_key: u,
                  sender: u,
                  content: { membership: m },
                })),
            ],
          },
        };
        continue;
      }
      const room = this.#rooms.get(item.room);
      if (room?.members.get(user) !== 'join') continue;
      (join[item.room] ??= {
        timeline: { events: [] },
        state: { events: [] },
      }).timeline.events.push(item.event);
    }
    const inbox = this.#inbox.get(key) ?? [];
    this.#inbox.set(key, []);
    return {
      next_batch: String(this.#clock - 1),
      rooms: { join, invite, leave: {} },
      to_device: { events: inbox },
      device_lists: { changed: [...changed], left: [] },
      device_one_time_keys_count: {
        signed_curve25519: Object.keys(this.#otks.get(key) ?? {}).length,
      },
      device_unused_fallback_key_types: this.#fallback.has(key) ? ['signed_curve25519'] : [],
    };
  }

  #concerns(user: string, item: Item): boolean {
    if (item.kind === 'keys') return item.user !== user;
    if (item.kind === 'invite') return item.user === user;
    return this.#rooms.get(item.room)?.members.get(user) === 'join';
  }
}
