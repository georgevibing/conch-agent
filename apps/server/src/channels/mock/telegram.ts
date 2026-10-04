import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { botAvatar } from '../assets';

interface MockUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  is_bot?: boolean;
}

export interface MockSent {
  method: string;
  chat_id: string;
  message_id: number;
  text: string;
  parse_mode?: string;
  buttons: { text: string; callback_data: string }[];
}

type Update = Record<string, unknown> & { update_id: number };

/**
 * A pretend Telegram Bot API for tests, E2E and `pnpm dev:mock`, speaking
 * just enough of the real one: `getMe`, long-polling `getUpdates`, sending
 * and editing messages, buttons, files, and the bot's profile calls.
 *
 * Tests drive the person's side with `say()` and `press()` (or, from outside
 * the process, `POST /__control/say` and `/__control/press`), and break things
 * on purpose: `revoke()` (the key stops working), `webhook()` (another tool
 * set one), `rival()` (another program polls the same bot), `down()`.
 */
export class MockTelegram {
  #server?: Server;
  #updates: Update[] = [];
  #nextUpdate = 1;
  #nextMessage = 100;
  #waiters = new Set<() => void>();
  #webhook = false;
  #rival = 0;
  #down = false;
  base = '';
  /** Keys that work, and the bot each one belongs to. */
  readonly bots = new Map<string, MockUser>();
  readonly sent: MockSent[] = [];
  readonly calls: { method: string; params: Record<string, unknown> }[] = [];
  /** The bot has a profile picture (set with setMyProfilePhoto). */
  hasPhoto = false;
  /** Streaming drafts sent (Bot API `sendMessageDraft`). */
  readonly drafts: { chat_id: string; draft_id: number; text: string; can_stop: boolean }[] = [];
  /** Answer `sendMessageDraft` as an older Telegram would: not available. */
  noDrafts = false;
  /** Refuse every formatted message, as Telegram does with markup it can't read. */
  refuseHtml = false;
  /** How long an empty `getUpdates` waits at most (ms), whatever timeout it asked for. */
  pollCapMs = 1500;

  static readonly TOKEN = '123456789:' + 'AAHmockmockmockmockmockmockmockmock1';
  static readonly OWNER: MockUser = {
    id: 4242,
    first_name: 'Ada',
    last_name: 'Lovelace',
    username: 'ada',
  };

  /** A group the bot is in (ADR 0075), and someone else in it. */
  static readonly GROUP = { id: -1001234567890, type: 'supergroup', title: 'Family' };
  static readonly MEMBER: MockUser = { id: 5151, first_name: 'Bob', username: 'bob' };

  constructor() {
    this.bots.set(MockTelegram.TOKEN, {
      id: 123456789,
      is_bot: true,
      first_name: 'Conch',
      username: 'my_conch_bot',
    });
  }

  async start(port = 0): Promise<string> {
    this.#server = createServer((req, res) => {
      this.#handle(req, res).catch((error: unknown) => {
        res.writeHead(500).end(String(error));
      });
    });
    const server = this.#server;
    const listening = await new Promise<boolean>((resolve) => {
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => resolve(true));
    });
    // The port asked for is taken (another program, another test run): any free one will do.
    if (!listening) {
      if (port === 0) throw new Error('The pretend Telegram couldn’t start.');
      server.close();
      return this.start(0);
    }
    this.base = `http://127.0.0.1:${(this.#server.address() as AddressInfo).port}`;
    return this.base;
  }

  async stop() {
    for (const wake of this.#waiters) wake();
    await new Promise<void>((resolve) => {
      if (!this.#server) return resolve();
      this.#server.closeAllConnections();
      this.#server.close(() => resolve());
    });
  }

  // ── The person's side ──────────────────────────────────────────────────

  say(text: string, from: MockUser = MockTelegram.OWNER, extra: Record<string, unknown> = {}) {
    this.#push({
      message: {
        message_id: this.#nextMessage++,
        from,
        chat: { id: from.id, type: 'private' },
        date: Math.floor(Date.now() / 1000),
        text,
        ...extra,
      },
    });
  }

  /**
   * A message in the group. `mention` puts "@my_conch_bot " in front, as
   * Telegram writes it (with its entity); `replyTo` makes it a reply to that
   * message (the bot's own when `from` is the bot).
   */
  sayInGroup(
    text: string,
    from: MockUser = MockTelegram.OWNER,
    options: {
      mention?: boolean;
      replyTo?: { message_id: number; from: MockUser; text: string };
      group?: { id: number; type: string; title: string };
    } = {},
  ) {
    const handle = '@my_conch_bot';
    const said = options.mention ? `${handle} ${text}` : text;
    this.#push({
      message: {
        message_id: this.#nextMessage++,
        from,
        chat: options.group ?? MockTelegram.GROUP,
        date: Math.floor(Date.now() / 1000),
        text: said,
        ...(options.mention && {
          entities: [{ type: 'mention', offset: 0, length: handle.length }],
        }),
        ...(options.replyTo && {
          reply_to_message: {
            ...options.replyTo,
            chat: options.group ?? MockTelegram.GROUP,
          },
        }),
      },
    });
  }

  /** Someone adds the bot to the group. */
  addToGroup(from: MockUser = MockTelegram.OWNER, group = MockTelegram.GROUP) {
    this.#push({
      my_chat_member: {
        chat: group,
        from,
        date: Math.floor(Date.now() / 1000),
        old_chat_member: { status: 'left' },
        new_chat_member: { status: 'member' },
      },
    });
  }

  /** A photo from the person (the file's bytes come from `/file/…`). */
  photo(caption: string, from: MockUser = MockTelegram.OWNER) {
    this.say('', from, {
      text: undefined,
      caption,
      photo: [
        { file_id: 'photo-small', file_size: 10, width: 90 },
        { file_id: 'photo-large', file_size: 68, width: 800 },
      ],
    });
  }

  press(data: string, messageId: number, from: MockUser = MockTelegram.OWNER, chatId?: number) {
    this.#push({
      callback_query: {
        id: `cb${this.#nextUpdate}`,
        from,
        data,
        message: {
          message_id: messageId,
          chat: { id: chatId ?? from.id, type: chatId === undefined ? 'private' : 'supergroup' },
        },
      },
    });
  }

  /** The person presses Stop under a streaming draft. */
  stopDraft(draftId: number, from: MockUser = MockTelegram.OWNER) {
    this.#push({ stopped_message_generation: { chat: { id: from.id }, draft_id: draftId } });
  }

  /** The newest message sent to a chat (edits included). */
  last(chatId: number | string = MockTelegram.OWNER.id): MockSent | undefined {
    return this.sent.filter((m) => m.chat_id === String(chatId)).at(-1);
  }

  // ── Breaking it on purpose ─────────────────────────────────────────────

  revoke(token = MockTelegram.TOKEN) {
    this.bots.delete(token);
  }

  webhook() {
    this.#webhook = true;
  }

  /** Another program polls this bot for the next `times` polls. */
  rival(times = Infinity) {
    this.#rival = times;
  }

  down(isDown = true) {
    this.#down = isDown;
  }

  // ── HTTP ───────────────────────────────────────────────────────────────

  #push(update: Record<string, unknown>) {
    this.#updates.push({ update_id: this.#nextUpdate++, ...update });
    for (const wake of this.#waiters) wake();
  }

  async #handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://x');
    const body = await readBody(req);
    if (url.pathname.startsWith('/__control/')) return this.#control(url.pathname, body, res);
    if (this.#down) return res.writeHead(502).end('Bad gateway');

    const file = /^\/file\/bot([^/]+)\/(.+)$/.exec(url.pathname);
    if (file) {
      if (!this.bots.has(decodeURIComponent(file[1] ?? ''))) return res.writeHead(401).end();
      // The bot's picture is the pearl it was given; anything else, a tiny valid PNG.
      if (file[2]?.includes('avatar'))
        return res.writeHead(200, { 'content-type': 'image/jpeg' }).end(await botAvatar());
      return res.writeHead(200, { 'content-type': 'image/png' }).end(PNG);
    }
    const match = /^\/bot([^/]+)\/(\w+)$/.exec(url.pathname);
    if (!match) return json(res, 404, { ok: false, error_code: 404, description: 'Not Found' });
    const token = decodeURIComponent(match[1] ?? '');
    const method = match[2] ?? '';
    const bot = this.bots.get(token);
    if (!bot) return json(res, 401, { ok: false, error_code: 401, description: 'Unauthorized' });
    this.calls.push({ method, params: body });
    return this.#method(method, body, bot, res);
  }

  async #method(
    method: string,
    params: Record<string, unknown>,
    bot: MockUser,
    res: ServerResponse,
  ) {
    const ok = (result: unknown) => json(res, 200, { ok: true, result });
    switch (method) {
      case 'getMe':
        return ok(bot);
      case 'getUpdates': {
        if (this.#webhook)
          return conflict(
            res,
            "Conflict: can't use getUpdates method while webhook is active; use deleteWebhook to delete the webhook first",
          );
        if (this.#rival > 0) {
          this.#rival--;
          return conflict(
            res,
            'Conflict: terminated by other getUpdates request; make sure that only one bot instance is running',
          );
        }
        const offset = Number(params.offset ?? 0);
        this.#updates = this.#updates.filter((u) => u.update_id >= offset);
        if (!this.#updates.length) {
          const wait = Math.min(Number(params.timeout ?? 0) * 1000, this.pollCapMs);
          await new Promise<void>((resolve) => {
            const wake = () => {
              this.#waiters.delete(wake);
              clearTimeout(timer);
              resolve();
            };
            const timer = setTimeout(wake, wait);
            this.#waiters.add(wake);
          });
        }
        return ok(this.#updates);
      }
      case 'deleteWebhook':
        this.#webhook = false;
        return ok(true);
      case 'sendMessage':
      case 'editMessageText': {
        const text = String(params.text ?? '');
        if (
          params.parse_mode === 'HTML' &&
          (this.refuseHtml || /<(?!\/?(b|i|s|u|code|pre|a|blockquote)\b)/.test(text))
        )
          return json(res, 400, {
            ok: false,
            error_code: 400,
            description: "Bad Request: can't parse entities: Unsupported start tag",
          });
        const markup = params.reply_markup as
          { inline_keyboard?: { text: string; callback_data: string }[][] } | undefined;
        const message_id =
          method === 'sendMessage' ? this.#nextMessage++ : Number(params.message_id);
        this.sent.push({
          method,
          chat_id: String(params.chat_id),
          message_id,
          text,
          ...(typeof params.parse_mode === 'string' && { parse_mode: params.parse_mode }),
          buttons: markup?.inline_keyboard?.flat() ?? [],
        });
        return ok({ message_id, chat: { id: Number(params.chat_id) } });
      }
      case 'sendMessageDraft':
        if (this.noDrafts)
          return json(res, 400, {
            ok: false,
            error_code: 400,
            description: 'Bad Request: method is not available',
          });
        this.drafts.push({
          chat_id: String(params.chat_id),
          draft_id: Number(params.draft_id),
          text: String(params.text ?? ''),
          can_stop: params.can_stop === true,
        });
        return ok(true);
      case 'getUserProfilePhotos':
        return ok(
          this.hasPhoto
            ? { total_count: 1, photos: [[{ file_id: 'avatar-small', file_size: 68, width: 160 }]] }
            : { total_count: 0, photos: [] },
        );
      case 'setMyProfilePhoto':
        this.hasPhoto = true;
        return ok(true);
      case 'getFile':
        return ok({ file_id: params.file_id, file_path: `photos/${String(params.file_id)}.png` });
      case 'sendChatAction':
      case 'answerCallbackQuery':
      case 'setMyCommands':
      case 'setMyDescription':
      case 'setMyShortDescription':
        return ok(true);
      default:
        return json(res, 404, {
          ok: false,
          error_code: 404,
          description: 'Not Found: method not found',
        });
    }
  }

  #control(path: string, body: Record<string, unknown>, res: ServerResponse) {
    const from = body.from ? (body.from as MockUser) : MockTelegram.OWNER;
    if (path === '/__control/say') this.say(String(body.text ?? ''), from);
    else if (path === '/__control/group-say')
      this.sayInGroup(String(body.text ?? ''), from, { mention: body.mention !== false });
    else if (path === '/__control/group-add') this.addToGroup(from);
    else if (path === '/__control/press')
      this.press(String(body.data), Number(body.messageId), from);
    else if (path === '/__control/revoke') this.revoke();
    else if (path === '/__control/webhook') this.webhook();
    else if (path === '/__control/rival') this.rival(Number(body.times ?? 5));
    else if (path === '/__control/down') this.down(true);
    else if (path === '/__control/up') this.down(false);
    else if (path === '/__control/sent') return json(res, 200, this.sent);
    else return json(res, 404, {});
    return json(res, 200, { ok: true });
  }
}

function conflict(res: ServerResponse, description: string) {
  return json(res, 409, { ok: false, error_code: 409, description });
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
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
