import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { ChannelBot } from '@conch/protocol';

import { run, type RunResult } from '../lib/proc';
import { plain, split } from './format';
import { handleId, normalHandle } from './handles';
import { CONCH_MARK, STALE_MS, TextChoices } from './linked';
import { attributedText } from './typedstream';
import {
  Backoff,
  type ChannelAdapter,
  type ChannelConnection,
  ChannelError,
  type ChannelEvents,
  type ChannelFile,
  type ChannelUser,
  type ConnectOptions,
  type SendOptions,
  type SentRef,
  pause,
  capOf,
} from './types';

/** Where Messages keeps everything, for the person running Conch. */
export const MESSAGES_DB = join(homedir(), 'Library', 'Messages', 'chat.db');
const SEND_SCRIPT = join(import.meta.dirname, 'assets', 'messages-send.applescript');

/** Messages has no hard limit, but long texts arrive in pieces on some phones; cut like a person. */
const PART = 3500;
/** How often to look for new messages. A read of the newest rows by id is cheap. */
const POLL_MS = 1_000;
/** How often to look again for Full Disk Access while it's off. */
const ACCESS_POLL_MS = 3_000;
/** Apple's clock starts on 1 January 2001. */
const APPLE_EPOCH_MS = 978_307_200_000;
const FILE_LIMIT = 25 * 1024 * 1024;
/** What Conch sends in one file (iMessage carries about 100 MB). */
const FILE_SEND_LIMIT = 100 * 1024 * 1024;
/**
 * Messages copies a file it sends while it delivers it: the copy Conch hands
 * it is kept this long, then removed.
 */
const OUTBOX_KEEP_MS = 10 * 60_000;
/**
 * Where files Conch sends wait for Messages: a folder of Conch's own in your
 * Pictures, which Messages may read (it can't send from a system temp folder).
 */
const OUTBOX = join(homedir(), 'Pictures', 'Conch outbox');

/** Messages' own ways of saying a chat is between two people or a group. */
const STYLE_GROUP = 43;

/** Why Messages can't be read. */
export type MessagesAccess = 'ready' | 'full-disk-access' | 'no-messages';

interface Row {
  id: number;
  guid: string;
  text: string | null;
  body: Uint8Array | null;
  fromMe: number;
  /** Milliseconds since 1 January 2001. */
  date: number;
  hasFiles: number;
  assoc: number;
  itemType: number;
  sender: string | null;
  chat: string | null;
  chatHandle: string | null;
  style: number | null;
}

interface FileRow {
  filename: string | null;
  mime: string | null;
  name: string | null;
  size: number | null;
}

/**
 * `~/Library/Messages/chat.db`, read-only. macOS keeps it behind Full Disk
 * Access: without it, opening fails while the file is plainly there, which
 * is how Conch tells "turn it on" from "Messages was never used here".
 *
 * The queries follow Messages' schema on macOS 13–26 (`message`, `chat`,
 * `handle`, `chat_message_join`, `attachment`, `message_attachment_join`),
 * asking only for columns that every one of those versions has.
 */
export class ChatDb {
  #db?: DatabaseSync;

  constructor(readonly path = MESSAGES_DB) {}

  /** Can Conch read Messages, and if not, why not. Never throws. */
  async access(): Promise<MessagesAccess> {
    try {
      this.open();
      return 'ready';
    } catch {
      const there = await stat(dirname(this.path)).then(
        () => true,
        () => false,
      );
      return there ? 'full-disk-access' : 'no-messages';
    }
  }

  open(): DatabaseSync {
    if (this.#db?.isOpen) return this.#db;
    // Read-only, and a query that waits rather than fails while Messages writes.
    const db = new DatabaseSync(this.path, { readOnly: true, timeout: 2_000 });
    try {
      db.prepare('SELECT ROWID FROM message LIMIT 1').get();
    } catch (error) {
      db.close();
      throw error;
    }
    this.#db = db;
    return db;
  }

  close() {
    if (this.#db?.isOpen) this.#db.close();
    this.#db = undefined;
  }

  latest(): number {
    const row = this.open().prepare('SELECT MAX(ROWID) AS id FROM message').get() as
      { id: number | null } | undefined;
    return row?.id ?? 0;
  }

  after(rowid: number, limit = 100): Row[] {
    return this.open()
      .prepare(
        `SELECT m.ROWID AS id, m.guid AS guid, m.text AS text, m.attributedBody AS body,
                m.is_from_me AS fromMe,
                -- Nanoseconds since 2001 (seconds before High Sierra) don't fit a JavaScript number: milliseconds do.
                CASE WHEN m.date > 100000000000 THEN m.date / 1000000 ELSE m.date * 1000 END AS date,
                m.cache_has_attachments AS hasFiles,
                m.associated_message_type AS assoc, m.item_type AS itemType,
                h.id AS sender, c.guid AS chat, c.chat_identifier AS chatHandle, c.style AS style
           FROM message m
           LEFT JOIN chat_message_join j ON j.message_id = m.ROWID
           LEFT JOIN chat c ON c.ROWID = j.chat_id
           LEFT JOIN handle h ON h.ROWID = m.handle_id
          WHERE m.ROWID > ?
          ORDER BY m.ROWID
          LIMIT ?`,
      )
      .all(rowid, limit) as unknown as Row[];
  }

  files(rowid: number): FileRow[] {
    return this.open()
      .prepare(
        `SELECT a.filename AS filename, a.mime_type AS mime, a.transfer_name AS name,
                a.total_bytes AS size
           FROM attachment a
           JOIN message_attachment_join j ON j.attachment_id = a.ROWID
          WHERE j.message_id = ?`,
      )
      .all(rowid) as unknown as FileRow[];
  }

  /** The addresses this Mac's Messages sends from, most used first. */
  handles(): string[] {
    const db = this.open();
    const counts = new Map<string, number>();
    const add = (raw: string | null | undefined, n: number) => {
      const handle = raw?.replace(/^[ep]:/i, '').trim();
      if (!handle || handle.length < 3) return;
      const key = normalHandle(handle);
      counts.set(key, (counts.get(key) ?? 0) + n);
    };
    for (const sql of [
      `SELECT destination_caller_id AS h, COUNT(*) AS n FROM message
        WHERE is_from_me = 1 AND destination_caller_id IS NOT NULL
        GROUP BY destination_caller_id`,
      `SELECT account_login AS h, COUNT(*) AS n FROM chat
        WHERE account_login IS NOT NULL GROUP BY account_login`,
      `SELECT last_addressed_handle AS h, COUNT(*) AS n FROM chat
        WHERE last_addressed_handle IS NOT NULL AND last_addressed_handle != ''
        GROUP BY last_addressed_handle`,
    ]) {
      try {
        for (const row of db.prepare(sql).all() as { h: string | null; n: number }[])
          add(row.h, row.n);
      } catch {
        // An older Messages without that column: the others still say.
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([handle]) => handle)
      .slice(0, 20);
  }
}

/** When a message was written, from Messages' clock (nanoseconds since 2001; seconds before 2017). */
export function appleTime(date: number): number {
  const ms = date > 1e11 ? date / 1e6 : date * 1000;
  return APPLE_EPOCH_MS + ms;
}

/** Runs the send script; tests pretend to be Messages here. */
export type MessagesRunner = (args: string[]) => Promise<RunResult>;

export const osascript: MessagesRunner = (args) =>
  run('/usr/bin/osascript', [SEND_SCRIPT, ...args], { timeout: 30_000 });

/** Turns a HEIC photo into a JPEG with macOS's own `sips`, for models that don't read HEIC. */
export type PhotoConverter = (path: string) => Promise<Buffer | undefined>;

const sips: PhotoConverter = async (path) => {
  const out = join(tmpdir(), `conch-photo-${process.pid}-${Date.now()}.jpg`);
  const result = await run('/usr/bin/sips', ['-s', 'format', 'jpeg', path, '--out', out], {
    timeout: 30_000,
  });
  if (result.code !== 0) return undefined;
  const bytes = await readFile(out).catch(() => undefined);
  await rm(out, { force: true });
  return bytes;
};

export interface ImessageOptions {
  mode: 'self' | 'account';
  handle: string;
  /** The pretend Messages in tests and `pnpm dev:mock`. */
  db?: string;
  /** Files may only be read from here (Messages' own attachments folder). */
  attachments?: string;
  send?: MessagesRunner;
  /** Where files wait for Messages to send them (tests: a folder of their own). */
  outbox?: string;
  convert?: PhotoConverter;
  platform?: NodeJS.Platform;
  pollMs?: number;
}

/** What Messages said when a send failed, as a `ChannelError` that names the fix. */
export function sendError(result: RunResult): ChannelError {
  const said = `${result.stderr} ${result.stdout}`;
  if (/-1743|not authori[sz]ed|not allowed to send apple ?events/i.test(said))
    return new ChannelError(
      'setup',
      'macOS hasn’t let Conch use Messages yet. Open System Settings → Privacy & Security → Automation, and turn on Messages for Conch.',
    );
  if (/-1728|can.t get (participant|chat|buddy)/i.test(said))
    return new ChannelError('refused', 'Messages doesn’t know that address.');
  if (/-1719|-10810|isn.t running|application can.t be found/i.test(said))
    return new ChannelError('network', 'Messages didn’t answer. Conch will try again.');
  if (/account/i.test(said))
    return new ChannelError(
      'setup',
      'Messages on this Mac isn’t signed in to iMessage. Open Messages and sign in.',
    );
  return new ChannelError('network', 'Messages couldn’t send that. Conch will try again.');
}

/**
 * iMessage on this Mac (ADR 0044). Conch reads Messages' own database
 * (read-only, with Full Disk Access) and answers through Messages itself,
 * with AppleScript. Nothing goes through a server but Apple's.
 *
 * Two ways in, chosen on the connect page:
 *
 * - `self`: you text yourself. The Mac shares your Apple ID, so the chat
 *   with your own address is one nobody else can write in. Only that chat is
 *   read; every other conversation on the Mac is never looked at.
 * - `account`: the Mac has an Apple ID of its own that people text. Only
 *   one-to-one chats count, and nobody gets in without you letting them.
 *
 * Either way it's your account answering: groups never hear from it, and
 * strangers only when you said so (`ownAccount`, `settings.others`).
 * Messages has no buttons: a question lists numbered answers (`TextChoices`),
 * and what Conch sends ends with `CONCH_MARK`, so it's never read back.
 */
export class ImessageAdapter implements ChannelAdapter {
  readonly kind = 'imessage' as const;
  readonly #db: ChatDb;
  readonly #handle: string;

  constructor(private readonly options: ImessageOptions) {
    this.#db = new ChatDb(options.db ?? MESSAGES_DB);
    this.#handle = normalHandle(options.handle);
  }

  get #platform() {
    return this.options.platform ?? process.platform;
  }

  get #attachments() {
    return this.options.attachments ?? join(homedir(), 'Library', 'Messages', 'Attachments');
  }

  owner(): ChannelUser | undefined {
    if (this.options.mode !== 'self') return undefined;
    return { id: handleId('i', this.#handle), name: this.#handle, username: this.#handle };
  }

  async identify(): Promise<ChannelBot> {
    if (this.#platform !== 'darwin')
      throw new ChannelError('setup', 'iMessage only works on a Mac.');
    const access = await this.#db.access();
    if (access === 'no-messages')
      throw new ChannelError(
        'setup',
        'Messages isn’t set up on this Mac. Open Messages and sign in with your Apple ID first.',
      );
    if (access === 'full-disk-access')
      throw new ChannelError(
        'setup',
        'macOS hides Messages from Conch until you turn on Full Disk Access for it.',
      );
    return {
      id: handleId('i', this.#handle),
      name: this.options.mode === 'self' ? 'You, on this Mac' : 'This Mac',
      address: this.#handle,
      chatUrl: `sms:${this.#handle}`,
    };
  }

  connect(events: ChannelEvents, options: ConnectOptions = {}): ChannelConnection {
    const stop = new AbortController();
    /** Questions waiting for an answer, per chat: Messages has no buttons. */
    const choices = new TextChoices();
    /** Your own texts to yourself can be stored twice (sent and received): each is read once. */
    const seen = new Map<string, { at: number; fromMe: number }>();
    const state = { selfChat: undefined as string | undefined, blocked: false };
    /** Names of files Conch sent lately (Messages has no room for a mark in a file): never read back. */
    const ownFiles = new Map<string, number>();

    void this.#poll(events, stop.signal, options.cursor, (row) => {
      const text = (row.text ?? attributedText(row.body) ?? '')
        // Messages puts U+FFFC where a picture sits in the text.
        .replaceAll('￼', '')
        .trim();
      // Reactions, edits, "named the group": not messages.
      if (row.assoc || row.itemType) return;
      // Conch's own words, read back from the database (or another Conch's): never yours.
      if (text.endsWith(CONCH_MARK)) return;
      // A file Conch sent, read back (twice, to yourself): no words, only its own files.
      if (!text && row.hasFiles && ownFiles.size) {
        const now = Date.now();
        for (const [name, until] of ownFiles) if (until < now) ownFiles.delete(name);
        const names = this.#db.files(row.id).map((f) => f.name ?? '');
        if (names.length && names.every((name) => ownFiles.has(name))) return;
      }
      const self = this.options.mode === 'self';
      if (self) {
        if (row.style === STYLE_GROUP || normalHandle(row.chatHandle ?? '') !== this.#handle)
          return;
        state.selfChat = row.chat ?? state.selfChat;
        // The same words as sent and as received, close together: the second copy.
        const key = `${text}\u0000${row.hasFiles}`;
        const now = Date.now();
        for (const [k, was] of seen) if (now - was.at > 15_000) seen.delete(k);
        const twin = seen.get(key);
        if (twin && twin.fromMe !== row.fromMe) {
          seen.delete(key);
          return;
        }
        seen.set(key, { at: now, fromMe: row.fromMe });
      } else if (row.fromMe) return;

      const sender = self ? this.#handle : normalHandle(row.sender ?? '');
      if (!sender) return;
      const user: ChannelUser = { id: handleId('i', sender), name: sender, username: sender };
      const chatId = row.chat ?? `to:${sender}`;
      const answer = choices.match(chatId, text);
      if (answer) {
        events.press({
          chatId,
          user,
          data: answer.data,
          message: answer.ref,
          ack: () => Promise.resolve(),
        });
        return;
      }
      const files: ChannelFile[] = row.hasFiles
        ? this.#db.files(row.id).flatMap((f) =>
            f.filename
              ? [
                  {
                    name: f.name ?? 'file',
                    ...(f.mime && { mimeType: f.mime }),
                    ...(f.size && { size: f.size }),
                    ref: f.filename,
                    // Messages records audio messages as Core Audio files.
                    ...(/\.caf$/i.test(f.filename) && { voice: true }),
                  },
                ]
              : [],
          )
        : [];
      if (!text && !files.length) return;
      events.message({
        chatId,
        messageId: row.guid,
        user,
        text,
        files,
        direct: row.style !== STYLE_GROUP,
      });
    });

    const send = async (chatId: string, markdown: string, sendOptions?: SendOptions) => {
      const buttons = sendOptions?.buttons ?? [];
      const words = plain(buttons.length ? TextChoices.render(markdown, buttons) : markdown);
      const sent: SentRef[] = [];
      for (const part of split(words, PART)) {
        try {
          await this.#send(chatId, `${part}${CONCH_MARK}`);
        } catch (error) {
          // Only a person can allow it: say so on the page, and carry on once a send works.
          if (error instanceof ChannelError && error.message.includes('Automation')) {
            state.blocked = true;
            events.state('error', { message: error.message, access: 'automation' });
          }
          throw error;
        }
        if (state.blocked) {
          state.blocked = false;
          events.state('online');
        }
        sent.push({ chatId, messageId: `${Date.now()}-${sent.length}` });
      }
      const last = sent.at(-1);
      if (buttons.length && last) choices.remember(last, buttons);
      return sent;
    };

    return {
      send,
      files: {
        maxBytes: FILE_SEND_LIMIT,
        send: async (chatId, files, caption) => {
          const refs: SentRef[] = caption?.trim() ? await send(chatId, caption) : [];
          const outbox = this.options.outbox ?? OUTBOX;
          await mkdir(outbox, { recursive: true, mode: 0o700 });
          for (const file of files) {
            // A folder of its own, so the name Messages shows is the file's own.
            const folder = await mkdtemp(join(outbox, 'f-'));
            const name = file.name.replaceAll('\u0000', '').replace(/[/\\:]/g, '_') || 'file';
            const path = join(folder, name);
            await writeFile(path, file.bytes, { mode: 0o600 });
            ownFiles.set(name, Date.now() + OUTBOX_KEEP_MS);
            const later = setTimeout(
              () => void rm(folder, { recursive: true, force: true }).catch(() => undefined),
              OUTBOX_KEEP_MS,
            );
            later.unref?.();
            try {
              await this.#send(chatId, '', path);
            } catch (error) {
              clearTimeout(later);
              await rm(folder, { recursive: true, force: true }).catch(() => undefined);
              throw error;
            }
            refs.push({ chatId, messageId: `${Date.now()}-${refs.length}` });
          }
          return refs;
        },
      },
      // Messages can't change a text once sent: what was decided goes as a new one.
      edit: async (ref, markdown) => {
        choices.forget(ref);
        await send(ref.chatId, markdown);
      },
      // AppleScript can't show typing… in Messages.
      typing: () => Promise.resolve(),
      download: (file, options) => this.#download(file, options),
      directChat: (userId) =>
        Promise.resolve(
          this.options.mode === 'self'
            ? (state.selfChat ?? `to:${this.#handle}`)
            : `to:${userIdHandle(userId)}`,
        ),
      close: () => {
        stop.abort();
        this.#db.close();
      },
    };
  }

  async #poll(
    events: ChannelEvents,
    signal: AbortSignal,
    cursor: string | undefined,
    onRow: (row: Row) => void,
  ) {
    const backoff = new Backoff();
    let at = /^\d+$/.test(cursor ?? '') ? Number(cursor) : undefined;
    let online = false;
    events.state('connecting');
    while (!signal.aborted) {
      if (this.#platform !== 'darwin') {
        events.state('error', { message: 'iMessage only works on a Mac.' });
        return;
      }
      const access = await this.#db.access();
      if (access !== 'ready') {
        online = false;
        events.state('error', {
          message:
            access === 'full-disk-access'
              ? 'macOS hides Messages from Conch. Turn on Full Disk Access for it in System Settings.'
              : 'Messages isn’t set up on this Mac. Open Messages and sign in.',
          ...(access === 'full-disk-access' && { access: 'full-disk-access' as const }),
        });
        // Watch for it to be turned on, and carry on by itself when it is.
        await pause(access === 'full-disk-access' ? ACCESS_POLL_MS : 30_000, signal);
        continue;
      }
      try {
        if (at === undefined) {
          at = this.#db.latest();
          events.cursor?.(String(at));
        }
        if (!online) {
          online = true;
          backoff.reset();
          events.state('online');
        }
        const rows = this.#db.after(at);
        for (const row of rows) {
          at = row.id;
          // Picked up after Conch was off for a long time: too old to answer now.
          if (Date.now() - (APPLE_EPOCH_MS + row.date) > STALE_MS) continue;
          try {
            onRow(row);
          } catch {
            // One odd message never stops the rest.
          }
        }
        if (rows.length) events.cursor?.(String(at));
        await pause(rows.length >= 100 ? 0 : (this.options.pollMs ?? POLL_MS), signal);
      } catch (error) {
        if (signal.aborted) return;
        // Messages was writing, or it moved its database aside: open it again shortly.
        this.#db.close();
        online = false;
        const wait = backoff.next();
        events.state('reconnecting', {
          message: `Couldn’t read Messages (${(error as Error).message}).`,
          retryAt: Date.now() + wait,
        });
        await pause(wait, signal);
      }
    }
  }

  /** Words, or the file at `file` (a path Conch wrote itself) instead. */
  async #send(chatId: string, text: string, file?: string) {
    const runner = this.options.send ?? osascript;
    // An argument can't carry a NUL; nothing else needs changing (it's never part of the script).
    const words = text.replaceAll('\u0000', '');
    const target = chatId.startsWith('to:')
      ? (['to', chatId.slice(3)] as const)
      : (['chat', chatId] as const);
    const extra = file ? [file] : [];
    let result = await runner([words, target[1], target[0], ...extra]);
    if (result.code !== 0 && target[0] === 'chat') {
      // A chat Messages no longer has (deleted on the Mac): send to the person instead.
      const person = /;-;(.+)$/.exec(chatId)?.[1];
      if (person && sendError(result).code === 'refused')
        result = await runner([words, person, 'to', ...extra]);
    }
    if (result.code !== 0) throw sendError(result);
  }

  async #download(file: ChannelFile, options?: { maxBytes?: number }) {
    const cap = capOf(FILE_LIMIT, options);
    if (file.size && file.size > cap)
      throw new ChannelError('refused', 'That file is over 25 MB, the most Conch takes.');
    const path = file.ref.replace(/^~(?=\/)/, homedir());
    // Only Messages' own attachments: a name in the database can't point anywhere else.
    const root = await realpath(this.#attachments).catch(() => this.#attachments);
    const real = await realpath(path).catch(() => undefined);
    if (!real || !(real === root || real.startsWith(root + sep)))
      throw new ChannelError('refused', 'Messages doesn’t have that file any more.');
    const size = (await stat(real)).size;
    if (size > cap)
      throw new ChannelError('refused', 'That file is over 25 MB, the most Conch takes.');
    if (/heic|heif/i.test(`${file.mimeType ?? ''} ${real}`)) {
      const jpeg = await (this.options.convert ?? sips)(real).catch(() => undefined);
      if (jpeg)
        return {
          name: file.name.replace(/\.(heic|heif)$/i, '.jpg'),
          bytes: jpeg,
          mimeType: 'image/jpeg',
        };
    }
    return { name: file.name, bytes: await readFile(real), mimeType: file.mimeType };
  }
}

const userIdHandle = (userId: string) => {
  const raw = /^i[A-Za-z0-9_-]+$/.test(userId)
    ? Buffer.from(userId.slice(1), 'base64url').toString('utf8')
    : '';
  if (!raw || handleId('i', raw) !== userId)
    throw new ChannelError('refused', 'Conch doesn’t know where to text them.');
  return raw;
};

/**
 * The program macOS asks Full Disk Access for: the app Conch was started
 * from (Terminal, iTerm…), or, running in the background, Node itself.
 */
export function accessApp(env: NodeJS.ProcessEnv = process.env): string {
  const known: Record<string, string> = {
    Apple_Terminal: 'Terminal',
    'iTerm.app': 'iTerm',
    vscode: 'Visual Studio Code',
    WarpTerminal: 'Warp',
    ghostty: 'Ghostty',
    WezTerm: 'WezTerm',
  };
  const term = env.TERM_PROGRAM;
  if (term && known[term]) return known[term];
  if (env.__CFBundleIdentifier === 'com.apple.Terminal') return 'Terminal';
  return 'node';
}

/** What the connect page needs to know before iMessage can be connected. */
export async function imessageSetup(
  db: ChatDb,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ access: MessagesAccess; handles: string[]; app: string }> {
  const access = await db.access();
  let handles: string[] = [];
  if (access === 'ready') {
    try {
      handles = db.handles();
    } catch {
      handles = [];
    } finally {
      db.close();
    }
  }
  return { access, handles, app: accessApp(env) };
}

/** System Settings' own addresses for the two switches iMessage needs. */
const SETTINGS = {
  'full-disk-access': 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
  automation: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation',
} as const;

/**
 * Open the place that fixes it: a System Settings page, Messages, or Node in
 * Finder (to drag into the Full Disk Access list). Fixed arguments only.
 */
export async function openForImessage(
  place: 'full-disk-access' | 'automation' | 'messages' | 'show-app',
  runner: (file: string, args: string[]) => Promise<RunResult> = (file, args) =>
    run(file, args, { timeout: 10_000 }),
): Promise<void> {
  const args =
    place === 'messages'
      ? ['-a', 'Messages']
      : place === 'show-app'
        ? ['-R', process.execPath]
        : [SETTINGS[place]];
  const result = await runner('/usr/bin/open', args);
  if (result.code !== 0) throw new ChannelError('setup', 'Couldn’t open System Settings.');
}
