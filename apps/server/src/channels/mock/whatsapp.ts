import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { WaConnect, WaHandlers, WaInbound, WaSocket } from '../whatsapp';
import { WA_CLOSE } from '../whatsapp';
import type { WaIdentity, WaSessionHandle } from '../whatsapp-sessions';

export interface MockWaSent {
  kind: 'text' | 'edit' | 'react' | 'presence' | 'read';
  chat: string;
  id?: string;
  text?: string;
  emoji?: string;
}

interface MockState {
  mock: 1;
  device: string;
  registered: boolean;
}

interface Live {
  handlers: WaHandlers;
  session: WaSessionHandle;
  state: MockState;
  open: boolean;
  codes: number;
  timer?: NodeJS.Timeout;
}

/**
 * A pretend WhatsApp for tests, E2E and `pnpm dev:mock` (ADR 0043). It stands
 * in for Baileys at the connection seam (`WaConnect`): an unlinked session
 * gets QR codes until `scan()`, then WhatsApp's own "restart" (515), then
 * an open connection as the owner. What Conch sends is echoed back as the
 * linked account's own message, as WhatsApp does.
 *
 * Tests drive the phone with `scan()`, `say()` and friends (or
 * `POST /__control/scan`, `/__control/say` from outside), and break things
 * on purpose: `logout()` (unlinked on the phone), `drop()`, `replace()`
 * (another copy of the link), `down()`.
 */
export class MockWhatsApp {
  static readonly OWNER: WaIdentity = {
    jid: '15550001111:7@s.whatsapp.net',
    lid: '99887766554433:7@lid',
    name: 'Ada Lovelace',
  };
  static readonly SELF_CHAT = '15550001111@s.whatsapp.net';
  static readonly FRIEND = { jid: '15550002222@s.whatsapp.net', name: 'Grace Hopper' };
  static readonly GROUP = '120363025550000000@g.us';

  #server?: Server;
  #live = new Set<Live>();
  #revoked = new Set<string>();
  #next = 1;
  #down = false;
  base = '';
  readonly sent: MockWaSent[] = [];
  /** How often a waiting link gets a new code (WhatsApp: 60 s, then 20 s). */
  qrEveryMs = 20_000;
  /** Codes before WhatsApp gives up on a link (408). */
  maxCodes = 6;

  connect: WaConnect = (session, handlers) => {
    const live: Live = {
      handlers,
      session,
      state: { mock: 1, device: randomBytes(4).toString('hex'), registered: false },
      open: false,
      codes: 0,
    };
    this.#live.add(live);
    void (async () => {
      const raw = await session.read();
      if (raw) live.state = JSON.parse(raw) as MockState;
      else session.write(JSON.stringify(live.state));
      setTimeout(() => this.#begin(live), 5);
    })();
    const socket: WaSocket = {
      send: (chat, text, options) => {
        if (!live.open) return Promise.reject(new Error('Connection Closed'));
        const id =
          options?.edit ??
          options?.id ??
          `3EB0${(this.#next++).toString(16).toUpperCase().padStart(8, '0')}`;
        this.sent.push({ kind: options?.edit ? 'edit' : 'text', chat, id, text });
        // WhatsApp echoes what this device sent, as the account's own message.
        if (!options?.edit)
          setTimeout(
            () =>
              this.#deliver({
                id,
                chat,
                fromMe: true,
                sender: chat,
                at: Date.now(),
                text,
                files: [],
                group: chat.endsWith('@g.us'),
              }),
            1,
          );
        return Promise.resolve(id);
      },
      react: (chat, id, _fromMe, emoji) => {
        this.sent.push({ kind: 'react', chat, id, emoji });
        return Promise.resolve();
      },
      presence: (chat) => {
        this.sent.push({ kind: 'presence', chat });
        return Promise.resolve();
      },
      read: (chat, id) => {
        this.sent.push({ kind: 'read', chat, id });
        return Promise.resolve();
      },
      download: () => Promise.resolve({ bytes: PNG, mimeType: 'image/png' }),
      picture: () => Promise.resolve(undefined),
      logout: () => {
        this.#revoked.add(live.state.device);
        this.#close(live, WA_CLOSE.loggedOut, 'Intentional Logout');
        return Promise.resolve();
      },
      end: () => {
        clearInterval(live.timer);
        live.open = false;
        this.#live.delete(live);
      },
    };
    return Promise.resolve(socket);
  };

  #begin(live: Live) {
    if (!this.#live.has(live)) return;
    if (this.#down) return this.#close(live, WA_CLOSE.connectionLost, 'Connection Failure');
    if (this.#revoked.has(live.state.device))
      return this.#close(live, WA_CLOSE.loggedOut, 'Connection Failure');
    if (!live.state.registered) {
      const code = () => {
        if (++live.codes > this.maxCodes)
          return this.#close(live, WA_CLOSE.connectionLost, 'QR refs attempts ended');
        live.handlers.qr(
          `https://wa.me/settings/linked_devices#2@mock${live.codes}${randomBytes(6).toString('base64url')},mockNoiseKey=,mockIdentityKey=,mockAdvSecret=,1`,
        );
      };
      code();
      live.timer = setInterval(code, this.qrEveryMs);
      return;
    }
    live.open = true;
    live.handlers.open(MockWhatsApp.OWNER);
  }

  #close(live: Live, code: number, message: string) {
    clearInterval(live.timer);
    live.open = false;
    this.#live.delete(live);
    live.handlers.close(code, message);
  }

  #deliver(message: WaInbound) {
    for (const live of this.#live) if (live.open) live.handlers.messages([message], true);
  }

  // ── The phone's side ───────────────────────────────────────────────────

  /** The phone scans the code that's showing: WhatsApp links, then asks for a restart. */
  scan(): boolean {
    const waiting = [...this.#live].find((l) => !l.state.registered && !l.open && l.codes > 0);
    if (!waiting) return false;
    waiting.state = { ...waiting.state, registered: true };
    waiting.session.write(JSON.stringify(waiting.state));
    this.#close(waiting, WA_CLOSE.restartRequired, 'Stream Errored (restart required)');
    return true;
  }

  /** A message: from you in Message yourself (the default), from a friend, or in a group. */
  say(text: string, from: 'owner' | 'friend' | 'group' = 'owner', extra: Partial<WaInbound> = {}) {
    const id = `MOCK${(this.#next++).toString(16).toUpperCase().padStart(8, '0')}`;
    const base = { id, at: Date.now(), text, files: [], ...extra };
    if (from === 'owner')
      this.#deliver({
        ...base,
        chat: MockWhatsApp.SELF_CHAT,
        fromMe: true,
        sender: MockWhatsApp.SELF_CHAT,
        name: MockWhatsApp.OWNER.name,
        group: false,
      });
    else if (from === 'friend')
      this.#deliver({
        ...base,
        chat: MockWhatsApp.FRIEND.jid,
        fromMe: false,
        sender: MockWhatsApp.FRIEND.jid,
        name: MockWhatsApp.FRIEND.name,
        group: false,
      });
    else
      this.#deliver({
        ...base,
        chat: MockWhatsApp.GROUP,
        fromMe: false,
        sender: MockWhatsApp.FRIEND.jid,
        name: MockWhatsApp.FRIEND.name,
        group: true,
      });
    return id;
  }

  /** A picture from you, with a caption. */
  photo(caption: string) {
    return this.say(caption, 'owner', {
      files: [{ name: 'image-1.jpeg', mimeType: 'image/png', size: PNG.length, ref: 'photo' }],
    });
  }

  /** The newest text sent to a chat. */
  last(chat = MockWhatsApp.SELF_CHAT): MockWaSent | undefined {
    return this.sent
      .filter((m) => m.chat === chat && (m.kind === 'text' || m.kind === 'edit'))
      .at(-1);
  }

  /** Whether a code is on screen, waiting to be scanned. */
  get showing(): boolean {
    return [...this.#live].some((l) => !l.state.registered && l.codes > 0);
  }

  // ── Breaking it on purpose ─────────────────────────────────────────────

  /** Unlinked from the phone (Linked devices → Log out). */
  logout() {
    for (const live of [...this.#live]) {
      if (!live.state.registered) continue;
      this.#revoked.add(live.state.device);
      this.#close(live, WA_CLOSE.loggedOut, 'Stream Errored (conflict)');
    }
  }

  drop() {
    for (const live of [...this.#live])
      if (live.open) this.#close(live, WA_CLOSE.connectionClosed, 'Connection Closed');
  }

  replace() {
    for (const live of [...this.#live])
      if (live.open) this.#close(live, WA_CLOSE.connectionReplaced, 'Stream Errored (conflict)');
  }

  down(isDown = true) {
    this.#down = isDown;
    if (isDown) this.drop();
  }

  // ── HTTP ───────────────────────────────────────────────────────────────

  async start(port = 0): Promise<string> {
    this.#server = createServer((req, res) => {
      this.#handle(req, res).catch((error: unknown) => res.writeHead(500).end(String(error)));
    });
    const server = this.#server;
    const listening = await new Promise<boolean>((resolve) => {
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => resolve(true));
    });
    if (!listening) {
      if (port === 0) throw new Error('The pretend WhatsApp couldn’t start.');
      server.close();
      return this.start(0);
    }
    this.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return this.base;
  }

  async stop() {
    for (const live of this.#live) clearInterval(live.timer);
    this.#live.clear();
    await new Promise<void>((resolve) => {
      if (!this.#server) return resolve();
      this.#server.closeAllConnections();
      this.#server.close(() => resolve());
    });
  }

  async #handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://x');
    const body = await readBody(req);
    const ok = (value: unknown = { ok: true }) =>
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(value));
    switch (url.pathname) {
      case '/__control/scan':
        return ok({ ok: this.scan() });
      case '/__control/say':
        return ok({
          id: this.say(
            String(body.text ?? ''),
            body.from === 'friend' || body.from === 'group' ? body.from : 'owner',
            typeof body.quote === 'string' ? { quoted: body.quote } : {},
          ),
        });
      case '/__control/photo':
        return ok({ id: this.photo(String(body.text ?? '')) });
      case '/__control/sent':
        return ok(this.sent);
      case '/__control/showing':
        return ok({ showing: this.showing });
      case '/__control/logout':
        this.logout();
        return ok();
      case '/__control/drop':
        this.drop();
        return ok();
      case '/__control/replace':
        this.replace();
        return ok();
      case '/__control/down':
        this.down(true);
        return ok();
      case '/__control/up':
        this.down(false);
        return ok();
      default:
        return res.writeHead(404).end();
    }
  }
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** 1×1 transparent PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
