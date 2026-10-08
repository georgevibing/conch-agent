import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import Fastify, { type FastifyInstance } from 'fastify';

import type { RunResult } from '../../lib/proc';
import { archiveText } from '../typedstream';

/** What the pretend Messages sent for Conch. */
export interface MockImessageSent {
  text: string;
  target: string;
  kind: 'chat' | 'to';
  /** A file sent (the script's item 4): its name and size, as Messages took it. */
  file?: { name: string; size: number };
}

/**
 * A pretend Messages for tests, E2E and `pnpm dev:mock`: a `chat.db` laid
 * out like the real one (the tables and columns Conch reads, in WAL mode,
 * written while Conch reads it), an attachments folder, and the send script
 * played by `send()`, which files what was sent the way Messages does,
 * twice over in the chat with yourself.
 *
 * Play the person with `say()`; break it with `hide()` (Full Disk Access
 * off), `denyAutomation` (macOS hasn't let Conch use Messages) and
 * `forgetChats()` (the chat was deleted on the Mac).
 */
export class MockMessages {
  static readonly ME = 'ada@icloud.com';
  static readonly FRIEND = '+15550001234';
  readonly dir: string;
  readonly db: string;
  readonly attachments: string;
  readonly sent: MockImessageSent[] = [];
  denyAutomation = false;
  #write: DatabaseSync;
  #control?: FastifyInstance;
  #knownChats = true;
  base = '';

  constructor() {
    this.dir = mkdtempSync(join(tmpdir(), 'conch-messages-'));
    this.db = join(this.dir, 'chat.db');
    this.attachments = join(this.dir, 'Attachments');
    mkdirSync(this.attachments, { recursive: true });
    this.#write = new DatabaseSync(this.db);
    this.#write.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE handle (ROWID INTEGER PRIMARY KEY AUTOINCREMENT UNIQUE, id TEXT NOT NULL, country TEXT, service TEXT NOT NULL, uncanonicalized_id TEXT, person_centric_id TEXT, UNIQUE (id, service));
      CREATE TABLE chat (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, guid TEXT UNIQUE NOT NULL, style INTEGER, state INTEGER, account_id TEXT, properties BLOB, chat_identifier TEXT, service_name TEXT, room_name TEXT, account_login TEXT, is_archived INTEGER DEFAULT 0, last_addressed_handle TEXT, display_name TEXT, group_id TEXT);
      CREATE TABLE message (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, guid TEXT UNIQUE NOT NULL, text TEXT, replace INTEGER DEFAULT 0, service_center TEXT, handle_id INTEGER DEFAULT 0, subject TEXT, country TEXT, attributedBody BLOB, version INTEGER DEFAULT 0, type INTEGER DEFAULT 0, service TEXT, account TEXT, account_guid TEXT, error INTEGER DEFAULT 0, date INTEGER, date_read INTEGER, date_delivered INTEGER, is_delivered INTEGER DEFAULT 0, is_finished INTEGER DEFAULT 0, is_emote INTEGER DEFAULT 0, is_from_me INTEGER DEFAULT 0, is_read INTEGER DEFAULT 0, is_sent INTEGER DEFAULT 0, cache_has_attachments INTEGER DEFAULT 0, item_type INTEGER DEFAULT 0, associated_message_guid TEXT, associated_message_type INTEGER DEFAULT 0, destination_caller_id TEXT);
      CREATE TABLE chat_message_join (chat_id INTEGER REFERENCES chat (ROWID) ON DELETE CASCADE, message_id INTEGER REFERENCES message (ROWID) ON DELETE CASCADE, message_date INTEGER DEFAULT 0, PRIMARY KEY (chat_id, message_id));
      CREATE TABLE attachment (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, guid TEXT UNIQUE NOT NULL, created_date INTEGER DEFAULT 0, filename TEXT, uti TEXT, mime_type TEXT, transfer_state INTEGER DEFAULT 0, is_outgoing INTEGER DEFAULT 0, transfer_name TEXT, total_bytes INTEGER DEFAULT 0);
      CREATE TABLE message_attachment_join (message_id INTEGER REFERENCES message (ROWID) ON DELETE CASCADE, attachment_id INTEGER REFERENCES attachment (ROWID) ON DELETE CASCADE, UNIQUE(message_id, attachment_id));
    `);
    // A little history, as any Mac has: a chat with a friend, and some texts to yourself.
    this.say('see you at 7', { from: MockMessages.FRIEND, ago: 3_600_000 });
    this.say('note to self: milk', { from: MockMessages.ME, ago: 7_200_000 });
  }

  async start(port = 0) {
    const app = Fastify({ logger: false });
    this.#control = app;
    app.post<{ Params: { action: string } }>('/__control/:action', (request) => {
      const body = (request.body ?? {}) as { text?: string; from?: string };
      if (request.params.action === 'say') this.say(body.text ?? '', { from: body.from });
      else if (request.params.action === 'sent') return this.sent;
      else if (request.params.action === 'hide') this.hide();
      else if (request.params.action === 'show') this.show();
      return { ok: true };
    });
    try {
      await app.listen({ port, host: '127.0.0.1' });
    } catch {
      await app.listen({ port: 0, host: '127.0.0.1' });
    }
    this.base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  }

  async stop() {
    await this.#control?.close();
    if (this.#write.isOpen) this.#write.close();
    rmSync(this.dir, { recursive: true, force: true });
  }

  /** The adapter's options for this pretend Messages. */
  get endpoints() {
    return {
      db: this.db,
      attachments: this.attachments,
      outbox: join(this.dir, 'outbox'),
      send: (args: string[]) => this.send(args),
      convert: async () => Buffer.from('jpeg'),
      platform: 'darwin' as const,
      pollMs: 100,
    };
  }

  // ── The person's side ──────────────────────────────────────────────────

  /**
   * A text arrives. From `ME` it's you, texting yourself from your iPhone;
   * newer macOS keeps only `attributedBody`, which is what this writes unless
   * `plainText` is set.
   */
  say(
    text: string,
    options: {
      from?: string;
      ago?: number;
      plainText?: boolean;
      group?: boolean;
      file?: { name: string; mime: string; bytes: Buffer };
      reaction?: boolean;
    } = {},
  ): number {
    const from = options.from ?? MockMessages.ME;
    const chat = this.#chat(options.group ? 'chat-group-1' : from, options.group ? 43 : 45);
    const handle = this.#handle(from);
    const id = this.#insert({
      text,
      handle,
      fromMe: from === MockMessages.ME ? 1 : 0,
      chat,
      ago: options.ago ?? 0,
      plainText: options.plainText ?? false,
      reaction: options.reaction ?? false,
      file: options.file,
    });
    // Texting yourself: Messages files it twice, as sent and as received.
    if (from === MockMessages.ME && !options.group)
      this.#insert({
        text,
        handle,
        fromMe: 0,
        chat,
        ago: options.ago ?? 0,
        plainText: options.plainText ?? false,
      });
    return id;
  }

  /**
   * Full Disk Access is off: macOS won't let Conch open the database, though
   * its folder is plainly there. (Moved aside rather than locked: SQLite in
   * one process shares open files, so a lock wouldn't hold against the writer.)
   */
  hide() {
    for (const suffix of ['', '-wal', '-shm'])
      if (existsSync(this.db + suffix)) renameSync(this.db + suffix, `${this.db}${suffix}.hidden`);
  }

  show() {
    for (const suffix of ['', '-wal', '-shm'])
      if (existsSync(`${this.db}${suffix}.hidden`))
        renameSync(`${this.db}${suffix}.hidden`, this.db + suffix);
  }

  /** The chats were deleted on the Mac: sending to a chat id fails, to a person works. */
  forgetChats() {
    this.#knownChats = false;
  }

  /** Plays the send script: `[text, target, "chat" | "to", file?]`. */
  async send(args: string[]): Promise<RunResult> {
    const [text = '', target = '', kind = 'to', path] = args;
    if (this.denyAutomation)
      return {
        stdout: '',
        stderr: 'execution error: Not authorized to send Apple events to Messages. (-1743)',
        code: 1,
      };
    if (kind === 'chat' && !this.#knownChats)
      return {
        stdout: '',
        stderr: `execution error: Can’t get chat id "${target}". (-1728)`,
        code: 1,
      };
    // Messages reads the file as it sends it (and fails when it can't).
    const bytes = path ? readFileSync(path) : undefined;
    const file = path && bytes ? { name: basename(path), mime: mimeOf(path), bytes } : undefined;
    this.sent.push({
      text: file ? '' : text,
      target,
      kind: kind === 'chat' ? 'chat' : 'to',
      ...(file && { file: { name: file.name, size: file.bytes.length } }),
    });
    const to = kind === 'chat' ? (/;-;(.+)$/.exec(target)?.[1] ?? target) : target;
    const chat = this.#chat(to, 45);
    const handle = this.#handle(to);
    const said = file ? '' : text;
    this.#insert({
      text: said,
      handle,
      fromMe: 1,
      chat,
      ago: 0,
      plainText: false,
      ...(file && { file }),
    });
    if (to === MockMessages.ME)
      this.#insert({
        text: said,
        handle,
        fromMe: 0,
        chat,
        ago: 0,
        plainText: false,
        ...(file && { file }),
      });
    return { stdout: '', stderr: '', code: 0 };
  }

  last(): MockImessageSent | undefined {
    return this.sent.at(-1);
  }

  // ── Storage ────────────────────────────────────────────────────────────

  #handle(id: string): number {
    this.#write
      .prepare('INSERT OR IGNORE INTO handle (id, service) VALUES (?, ?)')
      .run(id, 'iMessage');
    return (
      this.#write.prepare('SELECT ROWID AS id FROM handle WHERE id = ?').get(id) as { id: number }
    ).id;
  }

  #chat(identifier: string, style: number): number {
    const guid = `iMessage;${style === 43 ? '+' : '-'};${identifier}`;
    this.#write
      .prepare(
        'INSERT OR IGNORE INTO chat (guid, style, chat_identifier, service_name, account_login, last_addressed_handle) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(guid, style, identifier, 'iMessage', `E:${MockMessages.ME}`, MockMessages.ME);
    return (
      this.#write.prepare('SELECT ROWID AS id FROM chat WHERE guid = ?').get(guid) as { id: number }
    ).id;
  }

  #insert(m: {
    text: string;
    handle: number;
    fromMe: number;
    chat: number;
    ago: number;
    plainText: boolean;
    reaction?: boolean;
    file?: { name: string; mime: string; bytes: Buffer };
  }): number {
    // Nanoseconds since 1 January 2001, as Messages counts.
    const date = BigInt(Date.now() - m.ago - 978_307_200_000) * 1_000_000n;
    const result = this.#write
      .prepare(
        `INSERT INTO message (guid, text, attributedBody, handle_id, service, account, date, is_from_me,
           cache_has_attachments, associated_message_type, destination_caller_id)
         VALUES (?, ?, ?, ?, 'iMessage', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID().toUpperCase(),
        m.plainText ? m.text : null,
        archiveText(m.text),
        m.fromMe ? 0 : m.handle,
        `e:${MockMessages.ME}`,
        date,
        m.fromMe,
        m.file ? 1 : 0,
        m.reaction ? 2000 : 0,
        MockMessages.ME,
      );
    const id = Number(result.lastInsertRowid);
    this.#write
      .prepare('INSERT INTO chat_message_join (chat_id, message_id, message_date) VALUES (?, ?, ?)')
      .run(m.chat, id, date);
    if (m.file) {
      const folder = join(this.attachments, randomUUID());
      mkdirSync(folder, { recursive: true });
      const path = join(folder, m.file.name);
      writeFileSync(path, m.file.bytes);
      const attachment = this.#write
        .prepare(
          'INSERT INTO attachment (guid, filename, mime_type, transfer_name, total_bytes) VALUES (?, ?, ?, ?, ?)',
        )
        .run(randomUUID(), path, m.file.mime, m.file.name, m.file.bytes.length);
      this.#write
        .prepare('INSERT INTO message_attachment_join (message_id, attachment_id) VALUES (?, ?)')
        .run(id, Number(attachment.lastInsertRowid));
    }
    return id;
  }
}

function mimeOf(path: string): string {
  if (/\.png$/i.test(path)) return 'image/png';
  if (/\.jpe?g$/i.test(path)) return 'image/jpeg';
  if (/\.pdf$/i.test(path)) return 'application/pdf';
  return 'application/octet-stream';
}
