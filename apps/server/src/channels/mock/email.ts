import { randomBytes } from 'node:crypto';
import { type AddressInfo, createServer, type Server, type Socket } from 'node:net';

import Fastify, { type FastifyInstance } from 'fastify';

/** One stored email. */
interface Stored {
  uid: number;
  raw: Buffer;
  flags: Set<string>;
  date: Date;
}

interface Folder {
  name: string;
  special?: string;
  uidValidity: number;
  uidNext: number;
  messages: Stored[];
}

/** An email the pretend person sends. */
export interface MockEmail {
  from?: string;
  fromName?: string;
  to?: string;
  cc?: string;
  subject?: string;
  text?: string;
  html?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  /**
   * What the provider's check says about the sender:
   * - `pass`: DKIM, SPF and DMARC pass for the From domain;
   * - `fail`: DMARC fails (someone pretending);
   * - `none`: no check (mail you sent yourself);
   * - `forged`: the provider says fail, and below it the sender wrote its own "pass".
   */
  auth?: 'pass' | 'fail' | 'none' | 'forged';
  /** Also file it in Sent (you sent it from your phone). */
  alsoSent?: boolean;
  headers?: Record<string, string>;
  attachments?: { name: string; type: string; content: Buffer }[];
}

/** A message Conch sent through the pretend SMTP server. */
export interface MockSentMail {
  from: string;
  to: string[];
  raw: string;
  /** The parts tests look at, read from the raw message. */
  subject: string;
  messageId: string;
  inReplyTo: string;
  references: string;
  replyTo: string;
  text: string;
}

/**
 * A pretend mail service for tests, E2E and `pnpm dev:mock`: an IMAP server
 * (the commands ImapFlow uses: LOGIN, LIST, SELECT, SEARCH, FETCH, MOVE,
 * IDLE…), an SMTP server, and `/__control/…` to play the person. It pretends
 * to be Gmail by default: its checks are signed `mx.google.com`, and what
 * Conch sends to the account itself lands in the inbox, as Gmail does.
 *
 * Break it on purpose with `revoke()` (a new app password), `drop()` (every
 * connection closes), `rebuild()` (a new UIDVALIDITY).
 */
export class MockMail {
  static readonly ADDRESS = 'ada@gmail.com';
  static readonly PASSWORD = 'abcd efgh ijkl mnop';
  static readonly FRIEND = 'grace@example.org';
  readonly sent: MockSentMail[] = [];
  readonly logins: string[] = [];
  authserv = 'mx.google.com';
  password = MockMail.PASSWORD.replaceAll(' ', '');
  imapPort = 0;
  smtpPort = 0;
  base = '';
  #folders = new Map<string, Folder>();
  #imap?: Server;
  #smtp?: Server;
  #control?: FastifyInstance;
  #sockets = new Set<Socket>();
  #idlers = new Set<{
    folder: () => Folder | undefined;
    send: () => void;
    seen: number;
  }>();
  #validity = 1;

  constructor() {
    this.#reset();
  }

  #reset() {
    this.#folders.clear();
    for (const [name, special] of [
      ['INBOX', undefined],
      ['[Gmail]/Sent Mail', '\\Sent'],
      ['[Gmail]/Trash', '\\Trash'],
    ] as const)
      this.#folders.set(name, {
        name,
        special,
        uidValidity: this.#validity,
        uidNext: 1,
        messages: [],
      });
  }

  async start(ports: { imap?: number; smtp?: number; control?: number } = {}) {
    this.#imap = await listen((socket) => this.#imapSession(socket), ports.imap ?? 0);
    this.#smtp = await listen((socket) => this.#smtpSession(socket), ports.smtp ?? 0);
    this.imapPort = (this.#imap.address() as AddressInfo).port;
    this.smtpPort = (this.#smtp.address() as AddressInfo).port;
    const app = Fastify({ logger: false });
    this.#control = app;
    app.post<{ Params: { action: string } }>('/__control/:action', (request) => {
      const body = (request.body ?? {}) as MockEmail;
      if (request.params.action === 'deliver') return { messageId: this.deliver(body) };
      if (request.params.action === 'sent') return this.sent;
      if (request.params.action === 'revoke') this.revoke();
      return { ok: true };
    });
    const control = ports.control ?? 0;
    try {
      await app.listen({ port: control, host: '127.0.0.1' });
    } catch {
      await app.listen({ port: 0, host: '127.0.0.1' });
    }
    this.base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  }

  async stop() {
    for (const socket of this.#sockets) socket.destroy();
    await Promise.all([
      new Promise((r) => this.#imap?.close(r) ?? r(undefined)),
      new Promise((r) => this.#smtp?.close(r) ?? r(undefined)),
      this.#control?.close(),
    ]);
  }

  /** Where Conch connects, as the email adapter's endpoints. */
  get endpoints() {
    return {
      imap: { host: '127.0.0.1', port: this.imapPort },
      smtp: { host: '127.0.0.1', port: this.smtpPort },
      insecure: true as const,
    };
  }

  folderNames() {
    return [...this.#folders.keys()];
  }
  folder(name: string) {
    return this.#folders.get(name);
  }

  // ── The person's side ──────────────────────────────────────────────────

  /** An email arrives, as the provider would store it. Returns its Message-ID. */
  deliver(mail: MockEmail): string {
    const from = mail.from ?? MockMail.ADDRESS;
    const domain = from.split('@')[1] ?? 'example.org';
    const messageId = mail.messageId ?? `<${randomBytes(8).toString('hex')}@${domain}>`;
    const auth = mail.auth ?? 'pass';
    const lines: string[] = [];
    if (auth !== 'none') {
      lines.push(
        `Received: from mail.${domain} (mail.${domain} [203.0.113.7]) by ${this.authserv} with ESMTPS id ${randomBytes(4).toString('hex')}; ${new Date().toUTCString()}`,
      );
      const ok = auth === 'pass';
      lines.push(
        `Authentication-Results: ${this.authserv};\r\n       dkim=${ok ? 'pass' : 'fail'} header.i=@${domain} header.s=s1;\r\n       spf=${ok ? 'pass' : 'fail'} (${this.authserv}: domain of ${from}) smtp.mailfrom=${from};\r\n       dmarc=${ok ? 'pass' : 'fail'} (p=REJECT) header.from=${domain}`,
      );
    }
    if (auth === 'forged')
      lines.push(
        `Authentication-Results: ${this.authserv}; dkim=pass header.i=@${domain}; dmarc=pass header.from=${domain}`,
      );
    lines.push(
      `From: ${mail.fromName ? `"${mail.fromName}" ` : ''}<${from}>`,
      `To: ${mail.to ?? 'ada+conch@gmail.com'}`,
      ...(mail.cc ? [`Cc: ${mail.cc}`] : []),
      `Subject: ${mail.subject ?? 'Hello'}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: ${messageId}`,
      ...(mail.inReplyTo ? [`In-Reply-To: ${mail.inReplyTo}`] : []),
      ...(mail.references ? [`References: ${mail.references}`] : []),
      ...Object.entries(mail.headers ?? {}).map(([k, v]) => `${k}: ${v}`),
      'MIME-Version: 1.0',
    );
    const boundary = `b${randomBytes(6).toString('hex')}`;
    const parts: string[] = [];
    if (mail.text !== undefined || !mail.html)
      parts.push(
        `Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(mail.text ?? '')}`,
      );
    if (mail.html)
      parts.push(
        `Content-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(mail.html)}`,
      );
    const body = [
      parts.length > 1
        ? `Content-Type: multipart/alternative; boundary="${boundary}a"\r\n\r\n${parts.map((p) => `--${boundary}a\r\n${p}`).join('\r\n')}\r\n--${boundary}a--`
        : (parts[0] ?? ''),
      ...(mail.attachments ?? []).map(
        (a) =>
          `Content-Type: ${a.type}; name="${a.name}"\r\nContent-Disposition: attachment; filename="${a.name}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${a.content.toString('base64').replace(/.{76}/g, '$&\r\n')}`,
      ),
    ];
    lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`, '');
    const raw = `${lines.join('\r\n')}\r\n${body.map((p) => `--${boundary}\r\n${p}`).join('\r\n')}\r\n--${boundary}--\r\n`;
    this.#store('INBOX', Buffer.from(raw));
    if (mail.alsoSent) this.#store('[Gmail]/Sent Mail', Buffer.from(raw));
    return messageId;
  }

  /** The last email Conch sent. */
  last(): MockSentMail | undefined {
    return this.sent.at(-1);
  }

  // ── Breaking it on purpose ─────────────────────────────────────────────

  /** The app password was revoked: logins fail and every connection drops. */
  revoke() {
    this.password = `revoked-${randomBytes(4).toString('hex')}`;
    this.drop();
  }

  /** Every connection closes (a network blip, a server restart). */
  drop() {
    for (const socket of this.#sockets) socket.destroy();
  }

  /** The mailbox was rebuilt: new UIDVALIDITY, nothing in it. */
  rebuild() {
    this.#validity++;
    this.#reset();
    this.drop();
  }

  // ── Storage ────────────────────────────────────────────────────────────

  #store(folderName: string, raw: Buffer) {
    const folder = this.#folders.get(folderName);
    if (!folder) return;
    folder.messages.push({ uid: folder.uidNext++, raw, flags: new Set(), date: new Date() });
    for (const idler of this.#idlers) if (idler.folder() === folder) idler.send();
  }

  // ── SMTP ───────────────────────────────────────────────────────────────

  #smtpSession(socket: Socket) {
    this.#sockets.add(socket);
    socket.on('close', () => this.#sockets.delete(socket));
    socket.on('error', () => undefined);
    const say = (line: string) => socket.write(`${line}\r\n`);
    let from = '';
    let to: string[] = [];
    let data: string[] | undefined;
    let authed = false;
    let pendingLogin: 'user' | 'pass' | undefined;
    let loginUser = '';
    say('220 mock.smtp ESMTP ready');
    lines(socket, (line) => {
      if (data) {
        if (line === '.') {
          const raw = data.join('\r\n');
          data = undefined;
          this.#received(from, to, raw);
          say('250 2.0.0 OK queued');
        } else data.push(line.startsWith('..') ? line.slice(1) : line);
        return;
      }
      if (pendingLogin === 'user') {
        loginUser = Buffer.from(line, 'base64').toString();
        pendingLogin = 'pass';
        return say('334 UGFzc3dvcmQ6');
      }
      if (pendingLogin === 'pass') {
        pendingLogin = undefined;
        authed = this.#login(loginUser, Buffer.from(line, 'base64').toString());
        return say(authed ? '235 2.7.0 Accepted' : '535 5.7.8 Username and Password not accepted');
      }
      const [verb = '', ...rest] = line.split(' ');
      switch (verb.toUpperCase()) {
        case 'EHLO':
        case 'HELO':
          socket.write('250-mock.smtp\r\n250-AUTH PLAIN LOGIN\r\n250-8BITMIME\r\n250 SMTPUTF8\r\n');
          return;
        case 'AUTH': {
          if (rest[0]?.toUpperCase() === 'LOGIN') {
            pendingLogin = 'user';
            return say('334 VXNlcm5hbWU6');
          }
          const decoded = Buffer.from(rest[1] ?? '', 'base64')
            .toString()
            .split('\u0000');
          authed = this.#login(decoded[1] ?? '', decoded[2] ?? '');
          return say(
            authed ? '235 2.7.0 Accepted' : '535 5.7.8 Username and Password not accepted',
          );
        }
        case 'MAIL':
          if (!authed) return say('530 5.7.0 Authentication Required');
          from = /<([^>]*)>/.exec(line)?.[1] ?? '';
          to = [];
          return say('250 OK');
        case 'RCPT':
          to.push(/<([^>]*)>/.exec(line)?.[1] ?? '');
          return say('250 OK');
        case 'DATA':
          data = [];
          return say('354 Go ahead');
        case 'RSET':
          from = '';
          to = [];
          return say('250 OK');
        case 'NOOP':
          return say('250 OK');
        case 'QUIT':
          say('221 Bye');
          socket.end();
          return;
        default:
          return say('502 Command not implemented');
      }
    });
  }

  #received(from: string, to: string[], raw: string) {
    const header = (name: string) =>
      new RegExp(`^${name}:[ \\t]*(.*(?:\\r\\n[ \\t].*)*)`, 'im')
        .exec(raw.split(/\r\n\r\n/)[0] ?? '')?.[1]
        ?.replace(/\r\n[ \t]+/g, ' ')
        .trim() ?? '';
    const textPart = /Content-Type: text\/plain[^]*?\r\n\r\n([^]*?)\r\n--/i.exec(raw)?.[1] ?? '';
    const encoding = /Content-Type: text\/plain[^]*?Content-Transfer-Encoding: ([\w-]+)/i.exec(
      raw,
    )?.[1];
    const text =
      encoding?.toLowerCase() === 'base64'
        ? Buffer.from(textPart.replace(/\s+/g, ''), 'base64').toString()
        : encoding?.toLowerCase() === 'quoted-printable'
          ? textPart
              .replace(/=\r\n/g, '')
              .replace(/=([0-9A-F]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
          : textPart;
    const decodedText = Buffer.from(text, 'latin1').toString('utf8');
    this.sent.push({
      from,
      to,
      raw,
      subject: decodeWords(header('Subject')),
      messageId: header('Message-ID'),
      inReplyTo: header('In-Reply-To'),
      references: header('References'),
      replyTo: header('Reply-To'),
      text: decodedText,
    });
    // As Gmail does: kept in Sent, and mail to yourself also lands in the inbox.
    this.#store('[Gmail]/Sent Mail', Buffer.from(raw));
    if (to.some((t) => t.toLowerCase() === MockMail.ADDRESS))
      this.#store('INBOX', Buffer.from(raw));
  }

  #login(user: string, pass: string): boolean {
    this.logins.push(user);
    return user.toLowerCase() === MockMail.ADDRESS && pass.replaceAll(' ', '') === this.password;
  }

  // ── IMAP ───────────────────────────────────────────────────────────────

  #imapSession(socket: Socket) {
    this.#sockets.add(socket);
    socket.on('error', () => undefined);
    const send = (line: string) => {
      if (!socket.destroyed) socket.write(`${line}\r\n`);
    };
    let authed = false;
    let selected: Folder | undefined;
    let idling: { tag: string } | undefined;
    /** How many messages this session was last told the selected folder has. */
    let reported = 0;
    /** Like a real server: news since the last report goes out with the next chance to say it. */
    const report = () => {
      if (selected && selected.messages.length !== reported) {
        reported = selected.messages.length;
        send(`* ${reported} EXISTS`);
      }
    };
    const idler = { folder: () => selected, send: () => idling && report(), seen: 0 };
    socket.on('close', () => {
      this.#sockets.delete(socket);
      this.#idlers.delete(idler);
    });
    let authenticate: string | undefined;
    send(
      '* OK [CAPABILITY IMAP4rev1 IDLE MOVE UIDPLUS SPECIAL-USE LITERAL+ AUTH=PLAIN] Mock IMAP ready',
    );
    readImap(
      socket,
      (literal) => {
        if (!literal.plus) send('+ Ready for literal');
      },
      (line) => {
        if (idling) {
          if (line.trim().toUpperCase() === 'DONE') {
            send(`${idling.tag} OK IDLE terminated`);
            idling = undefined;
            this.#idlers.delete(idler);
          }
          return;
        }
        if (authenticate) {
          const tag = authenticate;
          authenticate = undefined;
          const decoded = Buffer.from(line.trim(), 'base64').toString().split('\u0000');
          authed = this.#login(decoded[1] ?? '', decoded[2] ?? '');
          return send(
            authed ? `${tag} OK Logged in` : `${tag} NO [AUTHENTICATIONFAILED] Invalid credentials`,
          );
        }
        const args = tokenize(line);
        const tag = String(args.shift() ?? '*');
        let command = String(args.shift() ?? '').toUpperCase();
        let uid = false;
        if (command === 'UID') {
          uid = true;
          command = String(args.shift() ?? '').toUpperCase();
        }
        const ok = (text = 'completed') => send(`${tag} OK ${command} ${text}`);
        const no = (text: string) => send(`${tag} NO ${text}`);
        if (
          !authed &&
          !['CAPABILITY', 'LOGIN', 'AUTHENTICATE', 'LOGOUT', 'NOOP', 'ID'].includes(command)
        )
          return send(`${tag} BAD Log in first`);
        switch (command) {
          case 'CAPABILITY':
            send('* CAPABILITY IMAP4rev1 IDLE MOVE UIDPLUS SPECIAL-USE LITERAL+ AUTH=PLAIN');
            return ok();
          case 'ID':
            send('* ID ("name" "mock")');
            return ok();
          case 'LOGIN':
            authed = this.#login(String(args[0] ?? ''), String(args[1] ?? ''));
            return authed
              ? send(
                  `${tag} OK [CAPABILITY IMAP4rev1 IDLE MOVE UIDPLUS SPECIAL-USE LITERAL+] Logged in`,
                )
              : send(`${tag} NO [AUTHENTICATIONFAILED] Invalid credentials (Failure)`);
          case 'AUTHENTICATE': {
            if (args[1] !== undefined) {
              const decoded = Buffer.from(String(args[1]), 'base64').toString().split('\u0000');
              authed = this.#login(decoded[1] ?? '', decoded[2] ?? '');
              return send(
                authed
                  ? `${tag} OK Logged in`
                  : `${tag} NO [AUTHENTICATIONFAILED] Invalid credentials`,
              );
            }
            authenticate = tag;
            return send('+ ');
          }
          case 'LOGOUT':
            send('* BYE Logging out');
            ok();
            socket.end();
            return;
          case 'NOOP':
          case 'CHECK':
            report();
            return ok();
          case 'ENABLE':
            return ok();
          case 'NAMESPACE':
            send('* NAMESPACE (("" "/")) NIL NIL');
            return ok();
          case 'LIST':
          case 'LSUB': {
            const pattern = flatten(args.filter((a) => !Array.isArray(a)))[1] ?? '*';
            // `LIST "" ""` asks only for the hierarchy delimiter.
            if (pattern === '') {
              send(`* ${command} (\\Noselect) "/" ""`);
              return ok();
            }
            for (const folder of this.#folders.values())
              send(
                `* ${command} (\\HasNoChildren${folder.special ? ` ${folder.special}` : ''}) "/" ${quote(folder.name)}`,
              );
            return ok();
          }
          case 'CREATE': {
            const name = String(args[0] ?? '');
            if (this.#folders.has(name)) return no('[ALREADYEXISTS] Mailbox exists');
            this.#folders.set(name, {
              name,
              uidValidity: this.#validity,
              uidNext: 1,
              messages: [],
            });
            return ok();
          }
          case 'SUBSCRIBE':
            return ok();
          case 'STATUS': {
            const folder = this.#folders.get(String(args[0] ?? ''));
            if (!folder) return no('[NONEXISTENT] No such mailbox');
            send(
              `* STATUS ${quote(folder.name)} (MESSAGES ${folder.messages.length} UIDNEXT ${folder.uidNext} UIDVALIDITY ${folder.uidValidity} UNSEEN 0)`,
            );
            return ok();
          }
          case 'SELECT':
          case 'EXAMINE': {
            const folder = this.#folders.get(String(args[0] ?? ''));
            if (!folder) return no('[NONEXISTENT] No such mailbox');
            selected = folder;
            send('* FLAGS (\\Answered \\Flagged \\Draft \\Deleted \\Seen)');
            send(
              '* OK [PERMANENTFLAGS (\\Answered \\Flagged \\Draft \\Deleted \\Seen \\*)] Flags permitted',
            );
            send(`* ${folder.messages.length} EXISTS`);
            reported = folder.messages.length;
            send('* 0 RECENT');
            send(`* OK [UIDVALIDITY ${folder.uidValidity}] UIDs valid`);
            send(`* OK [UIDNEXT ${folder.uidNext}] Predicted next UID`);
            return send(
              `${tag} OK [${command === 'SELECT' ? 'READ-WRITE' : 'READ-ONLY'}] ${command} completed`,
            );
          }
          case 'CLOSE':
          case 'UNSELECT':
            selected = undefined;
            return ok();
          case 'IDLE':
            if (!selected) return no('Select a mailbox first');
            idling = { tag };
            this.#idlers.add(idler);
            send('+ idling');
            return report();
          case 'SEARCH': {
            if (!selected) return no('Select a mailbox first');
            const folder = selected;
            const hits = folder.messages
              .map((m, i) => ({ m, seq: i + 1 }))
              .filter(({ m, seq }) => matches(m, seq, folder, [...args]))
              .map(({ m, seq }) => (uid ? m.uid : seq));
            send(`* SEARCH${hits.length ? ` ${hits.join(' ')}` : ''}`);
            return ok();
          }
          case 'FETCH': {
            if (!selected) return no('Select a mailbox first');
            const folder = selected;
            const set = String(args[0] ?? '');
            const items = flatten(args.slice(1)).map((i) => i.toUpperCase());
            folder.messages.forEach((m, i) => {
              if (!inSet(uid ? m.uid : i + 1, set, uid ? lastUid(folder) : folder.messages.length))
                return;
              const parts: string[] = [`UID ${m.uid}`];
              if (items.includes('FLAGS')) parts.push(`FLAGS (${[...m.flags].join(' ')})`);
              if (items.includes('RFC822.SIZE')) parts.push(`RFC822.SIZE ${m.raw.length}`);
              if (items.includes('INTERNALDATE')) parts.push(`INTERNALDATE "${imapDate(m.date)}"`);
              const body = items.find((it) => /^BODY(\.PEEK)?\[\]$/.test(it) || it === 'RFC822');
              const head = `* ${i + 1} FETCH (${parts.join(' ')}`;
              if (body) {
                socket.write(`${head} BODY[] {${m.raw.length}}\r\n`);
                socket.write(m.raw);
                socket.write(')\r\n');
              } else send(`${head})`);
            });
            return ok();
          }
          case 'STORE': {
            if (!selected) return no('Select a mailbox first');
            const set = String(args[0] ?? '');
            const mode = String(args[1] ?? '').toUpperCase();
            const flags = flatten(args.slice(2));
            for (const m of selected.messages)
              if (inSet(m.uid, set, lastUid(selected)))
                for (const flag of flags) {
                  if (mode.startsWith('-')) m.flags.delete(flag);
                  else m.flags.add(flag);
                }
            return ok();
          }
          case 'MOVE':
          case 'COPY': {
            if (!selected) return no('Select a mailbox first');
            const from = selected;
            const target = this.#folders.get(String(args[1] ?? ''));
            if (!target) return no('[TRYCREATE] No such mailbox');
            const set = String(args[0] ?? '');
            const moving = from.messages.filter((m, i) =>
              inSet(uid ? m.uid : i + 1, set, uid ? lastUid(from) : from.messages.length),
            );
            const fromUids: number[] = [];
            const toUids: number[] = [];
            for (const m of moving) {
              fromUids.push(m.uid);
              toUids.push(target.uidNext);
              target.messages.push({ ...m, uid: target.uidNext++, flags: new Set(m.flags) });
            }
            if (moving.length)
              send(
                `* OK [COPYUID ${target.uidValidity} ${fromUids.join(',')} ${toUids.join(',')}] Moved`,
              );
            if (command === 'MOVE')
              for (const m of moving) {
                const index = from.messages.indexOf(m);
                from.messages.splice(index, 1);
                if (from === selected) reported--;
                send(`* ${index + 1} EXPUNGE`);
              }
            return ok();
          }
          case 'EXPUNGE':
            return ok();
          default:
            return send(`${tag} BAD Unknown command ${command}`);
        }
      },
    );
  }
}

// ── Wire helpers ───────────────────────────────────────────────────────────

function listen(onSocket: (socket: Socket) => void, port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer(onSocket);
    server.once('error', (error) => {
      // The port asked for is taken: any free one will do.
      if (port) resolve(listen(onSocket, 0));
      else reject(error);
    });
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

/** Lines from a socket (SMTP). */
function lines(socket: Socket, onLine: (line: string) => void) {
  let buffer = '';
  socket.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('latin1');
    for (;;) {
      const at = buffer.indexOf('\r\n');
      if (at < 0) break;
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 2);
      onLine(Buffer.from(line, 'latin1').toString('utf8'));
    }
  });
}

/** IMAP command lines, with `{n}` literals folded in (as quoted strings). */
function readImap(
  socket: Socket,
  onLiteral: (literal: { plus: boolean }) => void,
  onLine: (line: string) => void,
) {
  let buffer = Buffer.alloc(0);
  let line = '';
  let need = 0;
  socket.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      if (need > 0) {
        if (buffer.length < need) return;
        line += quote(buffer.subarray(0, need).toString('utf8'));
        buffer = buffer.subarray(need);
        need = 0;
        continue;
      }
      const at = buffer.indexOf('\r\n');
      if (at < 0) return;
      const part = buffer.subarray(0, at).toString('utf8');
      buffer = buffer.subarray(at + 2);
      const literal = /\{(\d+)(\+?)\}$/.exec(part);
      if (literal) {
        line += part.slice(0, literal.index);
        need = Number(literal[1]);
        onLiteral({ plus: literal[2] === '+' });
        if (need === 0) line += '""';
        continue;
      }
      const full = line + part;
      line = '';
      onLine(full);
    }
  });
}

type Token = string | Token[];

function tokenize(line: string): Token[] {
  const root: Token[] = [];
  const stack: Token[][] = [root];
  let i = 0;
  const top = () => stack[stack.length - 1] ?? root;
  while (i < line.length) {
    const ch = line[i] ?? '';
    if (ch === ' ') {
      i++;
    } else if (ch === '(') {
      const list: Token[] = [];
      top().push(list);
      stack.push(list);
      i++;
    } else if (ch === ')') {
      if (stack.length > 1) stack.pop();
      i++;
    } else if (ch === '"') {
      let out = '';
      i++;
      while (i < line.length && line[i] !== '"') {
        if (line[i] === '\\') i++;
        out += line[i] ?? '';
        i++;
      }
      i++;
      top().push(out);
    } else {
      let out = '';
      // An atom; brackets keep BODY.PEEK[HEADER.FIELDS (…)] in one piece.
      let depth = 0;
      while (i < line.length) {
        const c = line[i] ?? '';
        if (c === '[') depth++;
        if (c === ']') depth--;
        if (depth === 0 && (c === ' ' || c === '(' || c === ')')) break;
        out += c;
        i++;
      }
      top().push(out);
    }
  }
  return root;
}

const flatten = (tokens: Token[]): string[] =>
  tokens.flatMap((t) => (Array.isArray(t) ? flatten(t) : [t]));

const quote = (s: string) => `"${s.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;

const lastUid = (folder: Folder) => folder.messages.at(-1)?.uid ?? 0;

/** Whether `n` is in an IMAP set like `1:*`, `3,5:7`; `*` is the largest. */
function inSet(n: number, set: string, max: number): boolean {
  return set.split(',').some((range) => {
    const [a = '', b] = range.split(':');
    const lo = a === '*' ? max : Number(a);
    const hi = b === undefined ? lo : b === '*' ? max : Number(b);
    return n >= Math.min(lo, hi) && n <= Math.max(lo, hi);
  });
}

function headerOf(raw: Buffer, name: string): string {
  const head = raw.toString('utf8').split(/\r\n\r\n/)[0] ?? '';
  return [...head.matchAll(new RegExp(`^${name}:[ \\t]*(.*(?:\\r\\n[ \\t].*)*)`, 'gim'))]
    .map((m) => m[1] ?? '')
    .join(' ')
    .toLowerCase();
}

/** A SEARCH's criteria against one message (the ones ImapFlow writes). */
function matches(m: Stored, seq: number, folder: Folder, criteria: Token[]): boolean {
  const next = (): boolean => {
    const token = criteria.shift();
    if (token === undefined) return true;
    if (Array.isArray(token)) return matches(m, seq, folder, [...token]);
    const word = token.toUpperCase();
    const arg = () => String(criteria.shift() ?? '').toLowerCase();
    switch (word) {
      case 'ALL':
        return true;
      case 'CHARSET':
        criteria.shift();
        return true;
      case 'UID':
        return inSet(m.uid, arg(), lastUid(folder));
      case 'OR': {
        const a = next();
        const b = next();
        return a || b;
      }
      case 'NOT':
        return !next();
      case 'SINCE': {
        const date = new Date(arg());
        return m.date.getTime() >= date.getTime() - 24 * 3600_000;
      }
      case 'TO':
      case 'CC':
      case 'FROM':
      case 'SUBJECT':
        return headerOf(m.raw, word).includes(arg());
      case 'HEADER': {
        const name = arg();
        return headerOf(m.raw, name).includes(arg());
      }
      case 'SEEN':
        return m.flags.has('\\Seen');
      case 'UNSEEN':
        return !m.flags.has('\\Seen');
      case 'DELETED':
        return m.flags.has('\\Deleted');
      case 'UNDELETED':
        return !m.flags.has('\\Deleted');
      default:
        // A sequence set.
        return /^[\d*:,]+$/.test(word) ? inSet(seq, word, folder.messages.length) : true;
    }
  };
  let all = true;
  while (criteria.length) if (!next()) all = false;
  return all;
}

function imapDate(date: Date): string {
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getUTCDate())}-${months[date.getUTCMonth()]}-${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} +0000`;
}

const b64 = (text: string) =>
  Buffer.from(text, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');

/** `=?UTF-8?B?…?=` and `=?UTF-8?Q?…?=` in a header. */
function decodeWords(value: string): string {
  return value.replace(
    /=\?([\w-]+)\?([BQ])\?([^?]*)\?=\s*/gi,
    (_, _charset: string, kind: string, data: string) =>
      kind.toUpperCase() === 'B'
        ? Buffer.from(data, 'base64').toString('utf8')
        : Buffer.from(
            data
              .replace(/_/g, ' ')
              .replace(/=([0-9A-F]{2})/gi, (__, h: string) => String.fromCharCode(parseInt(h, 16))),
            'latin1',
          ).toString('utf8'),
  );
}
