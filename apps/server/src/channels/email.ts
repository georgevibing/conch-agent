import { createHash, randomBytes } from 'node:crypto';

import type { ChannelBot, ChannelSecrets, MailProvider } from '@conch/protocol';
import type { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import type { Email } from 'postal-mime';
import { getDomain } from 'tldts';

import { plain, toEmailHtml } from './format';
import { imapClient, imapFailure, isAuth, parseSource } from './imap';
import { handleId, normalHandle } from './handles';
import { TextChoices } from './linked';
import { automatic, bareSubject, messageIds, newWords, senderVerdict } from './mail-read';
import {
  Backoff,
  type ChannelAdapter,
  type ChannelConnection,
  ChannelError,
  type ChannelEvents,
  type ChannelFile,
  type ChannelUser,
  type ConnectOptions,
  type OutboundFile,
  type SendOptions,
  type SentRef,
  pause,
} from './types';

type EmailSecrets = Extract<ChannelSecrets, { kind: 'email' }>;

/** What Conch knows about a mail service, so nobody looks up a server name. */
export interface MailPreset {
  name: string;
  imap: { host: string; port: number };
  /** Port 465 is TLS from the start; 587 starts plain and must upgrade (STARTTLS). */
  smtp: { host: string; port: number };
  /** Whether `you+conch@…` reaches you. */
  plus: boolean;
  /** Where an app password is made. */
  passwords?: string;
  /** The names its own servers sign `Authentication-Results` with. */
  authserv: (id: string) => boolean;
  /** Microsoft turned off app passwords (September 2024): it needs a sign-in Conch doesn't do yet. */
  signInOnly?: boolean;
}

const endsWith =
  (...domains: string[]) =>
  (id: string) =>
    domains.some((d) => id === d || id.endsWith(`.${d}`));

/**
 * The services the connect page offers, checked against each one's own help
 * (October 2026): Gmail and Fastmail take `+` addresses and app passwords;
 * iCloud takes app-specific passwords but drops mail sent to a `+` address;
 * Outlook.com only takes Microsoft's own sign-in for IMAP since September 2024.
 */
export const MAIL_PRESETS: Record<Exclude<MailProvider, 'other'>, MailPreset> = {
  gmail: {
    name: 'Gmail',
    imap: { host: 'imap.gmail.com', port: 993 },
    smtp: { host: 'smtp.gmail.com', port: 465 },
    plus: true,
    passwords: 'https://myaccount.google.com/apppasswords',
    authserv: endsWith('mx.google.com'),
  },
  icloud: {
    name: 'iCloud Mail',
    imap: { host: 'imap.mail.me.com', port: 993 },
    smtp: { host: 'smtp.mail.me.com', port: 587 },
    plus: false,
    passwords: 'https://account.apple.com',
    authserv: endsWith('icloud.com', 'me.com', 'apple.com'),
  },
  fastmail: {
    name: 'Fastmail',
    imap: { host: 'imap.fastmail.com', port: 993 },
    smtp: { host: 'smtp.fastmail.com', port: 465 },
    plus: true,
    passwords: 'https://app.fastmail.com/settings/',
    authserv: endsWith('messagingengine.com', 'fastmail.com'),
  },
  outlook: {
    name: 'Outlook',
    imap: { host: 'outlook.office365.com', port: 993 },
    smtp: { host: 'smtp-mail.outlook.com', port: 587 },
    plus: true,
    authserv: (id) =>
      id === '' || endsWith('outlook.com', 'office365.com', 'protection.outlook.com')(id),
    signInOnly: true,
  },
};

/** The folder (a label, in Gmail) Conch files the mail it has handled into. */
export const CONCH_FOLDER = 'Conch';
/** The subject that marks mail for Conch where `+` addresses don't work (iCloud). */
const SUBJECT_TAG = /^conch\b[\s:,-]*/i;
/** Only mail this recent is read when Conch starts: older is too late to answer usefully. */
const RECENT_MS = 24 * 60 * 60_000;
const MAX_MESSAGE = 30 * 1024 * 1024;
const FILE_LIMIT = 25 * 1024 * 1024;
/** How long a file from an email waits to be fetched by the conversation. */
const FILE_KEEP_MS = 10 * 60_000;
/** IDLE is renewed this often (servers drop it after 29 minutes; some much sooner). */
const IDLE_MS = 4 * 60_000;

/** Where the pretend mail server lives in tests: plain connections to this computer only. */
export interface MailEndpoints {
  imap: { host: string; port: number };
  smtp: { host: string; port: number };
  /** Without TLS. Only ever for a pretend server on 127.0.0.1. */
  insecure: true;
}

interface Thread {
  to: string;
  subject: string;
  /** The last message in it, for In-Reply-To. */
  last?: string;
  references: string[];
}

/** The address mail for Conch goes to: `you+conch@…` where that works, else your own. */
export function conchAddress(address: string, plus: boolean): string {
  const [local = '', domain = ''] = address.toLowerCase().split('@');
  const base = local.split('+')[0] ?? local;
  return plus ? `${base}+conch@${domain}` : `${base}@${domain}`;
}

/**
 * Email (ADR 0044): IMAP to read, SMTP to answer, from your own account,
 * with an app password. Conch connects out to your mail service; nothing on
 * this computer is reachable from the internet.
 *
 * What it reads, and nothing else: mail to `you+conch@…` (iCloud, which has
 * no `+` addresses: mail you send yourself with “Conch” at the start of the
 * subject), from the last day, that isn't an auto-reply or a list. It's moved
 * to a “Conch” folder once handled, so the inbox stays yours.
 *
 * Who sent it is never taken from the From line alone: the mail service's
 * own `Authentication-Results` must say DMARC (or aligned DKIM or SPF)
 * passed, or, for your own address, the same message must be in your Sent
 * mail. Anything else is dropped unread. The answer goes back in the same
 * thread (In-Reply-To, References), from your address, with Reply-To set to
 * the Conch address so your reply comes back here.
 */
export class EmailAdapter implements ChannelAdapter {
  readonly kind = 'email' as const;
  readonly #address: string;
  readonly #preset: MailPreset;
  readonly #writeTo: string;

  constructor(
    private readonly secrets: EmailSecrets,
    private readonly endpoints?: MailEndpoints,
  ) {
    this.#address = normalHandle(secrets.address);
    this.#preset =
      secrets.provider === 'other'
        ? {
            name: 'your mail',
            imap: { host: secrets.server?.imapHost ?? '', port: secrets.server?.imapPort ?? 993 },
            smtp: { host: secrets.server?.smtpHost ?? '', port: secrets.server?.smtpPort ?? 465 },
            plus: true,
            authserv: otherAuthserv(secrets),
          }
        : MAIL_PRESETS[secrets.provider];
    this.#writeTo = conchAddress(this.#address, this.#preset.plus);
  }

  get #password() {
    // Google shows app passwords in groups of four; the spaces aren't part of it.
    return this.secrets.provider === 'gmail'
      ? this.secrets.password.replace(/\s+/g, '')
      : this.secrets.password;
  }

  owner(): ChannelUser {
    return { id: handleId('m', this.#address), name: this.#address, username: this.#address };
  }

  #imap(user = this.#address): ImapFlow {
    return imapClient(
      this.endpoints?.imap ?? this.#preset.imap,
      { user, pass: this.#password },
      { insecure: Boolean(this.endpoints), idleMs: IDLE_MS },
    );
  }

  #smtp() {
    const where = this.endpoints?.smtp ?? this.#preset.smtp;
    return nodemailer.createTransport({
      host: where.host,
      port: where.port,
      secure: !this.endpoints && where.port === 465,
      // Never send a password without TLS, except to the pretend server.
      requireTLS: !this.endpoints,
      ...(this.endpoints && { ignoreTLS: true }),
      auth: { user: this.#address, pass: this.#password },
      connectionTimeout: 20_000,
      greetingTimeout: 15_000,
      socketTimeout: 60_000,
    });
  }

  /** Logs in, trying the name before the @ where iCloud wants that instead. */
  async #login(): Promise<ImapFlow> {
    const client = this.#imap();
    try {
      await client.connect();
      return client;
    } catch (error) {
      client.close();
      if (this.secrets.provider === 'icloud' && isAuth(error)) {
        const local = this.#imap(this.#address.split('@')[0]);
        try {
          await local.connect();
          return local;
        } catch {
          local.close();
        }
      }
      throw this.#imapError(error);
    }
  }

  async identify(signal?: AbortSignal): Promise<ChannelBot> {
    if (this.#preset.signInOnly)
      throw new ChannelError(
        'setup',
        'Outlook stopped taking app passwords in 2024 and needs Microsoft’s own sign-in, which Conch can’t do yet. Use Gmail, iCloud or Fastmail, or forward your Outlook mail to one of them.',
        { field: 'address' },
      );
    if (this.secrets.provider === 'other' && !this.secrets.server)
      throw new ChannelError('setup', 'Say where your mail lives: its IMAP and SMTP servers.', {
        field: 'server',
      });
    const check = async () => {
      const client = await this.#login();
      await client.logout().catch(() => client.close());
      const smtp = this.#smtp();
      try {
        await smtp.verify();
      } catch (error) {
        throw this.#smtpError(error);
      } finally {
        smtp.close();
      }
    };
    await (signal ? abortable(check(), signal) : check());
    return {
      id: handleId('m', this.#address),
      name: this.#address,
      address: this.#writeTo,
      chatUrl: `mailto:${this.#writeTo}?subject=${encodeURIComponent(this.#preset.plus ? 'Hello' : 'Conch: hello')}`,
    };
  }

  connect(events: ChannelEvents, options: ConnectOptions = {}): ChannelConnection {
    const stop = new AbortController();
    const threads = new Map<string, Thread>();
    /** Which chat each message Conch has seen or sent belongs to, so a reply finds its thread. */
    const known = new Map<string, string>();
    /** Questions waiting for an answer, per thread: email has no buttons. */
    const choices = new TextChoices();
    const files = new Map<string, { name: string; bytes: Buffer; mimeType: string; at: number }>();
    const domain = this.#address.split('@')[1] ?? 'conch.invalid';

    const keep = <K, V>(map: Map<K, V>, key: K, value: V, max = 500) => {
      map.delete(key);
      map.set(key, value);
      while (map.size > max) map.delete(map.keys().next().value as K);
    };

    void this.#listen(events, stop.signal, options.cursor, async (email) => {
      const from = normalHandle(email.from?.address ?? '');
      const ids = messageIds(email.references);
      const parent = messageIds(email.inReplyTo)[0];
      const root = ids[0] ?? parent ?? email.messageId ?? `${Date.now()}`;
      // A thread is one chat: replying in it carries on; a new email starts afresh.
      const chatId =
        [parent, ...ids.toReversed()].map((id) => id && known.get(id)).find(Boolean) ??
        `t${createHash('sha256').update(root).digest('base64url').slice(0, 22)}`;
      if (email.messageId) keep(known, email.messageId, chatId, 2000);
      const bare = bareSubject(email.subject);
      const subject = this.#preset.plus ? bare : bare.replace(SUBJECT_TAG, '');
      keep(threads, chatId, {
        to: from,
        subject: subject || 'Your assistant',
        ...(email.messageId && { last: email.messageId }),
        references: [
          ...ids,
          ...(parent && !ids.includes(parent) ? [parent] : []),
          ...(email.messageId ? [email.messageId] : []),
        ].slice(-20),
      });
      const words = newWords(email);
      const user: ChannelUser = {
        id: handleId('m', from),
        name: email.from?.name?.trim() || from,
        username: from,
      };
      // A reply to a question answers it (the one it replies to, else the newest in the thread).
      const answer = words.forwarded ? undefined : choices.match(chatId, words.text, parent);
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
      const attached: ChannelFile[] = [];
      for (const [index, file] of email.attachments.entries()) {
        if (file.related || file.mimeType === 'message/rfc822') continue;
        const bytes = toBuffer(file.content);
        if (!bytes.length || bytes.length > FILE_LIMIT) continue;
        const ref = `${chatId}:${randomBytes(6).toString('base64url')}`;
        const name = file.filename ?? `attachment-${index + 1}`;
        keep(files, ref, { name, bytes, mimeType: file.mimeType, at: Date.now() }, 50);
        attached.push({ name, mimeType: file.mimeType, size: bytes.length, ref });
      }
      const fresh = !parent && !ids.length;
      // A new thread's subject is part of what was asked.
      const text =
        fresh &&
        subject &&
        !words.text.startsWith(subject) &&
        !/^\/[\w-]+(?:@\w+)?(?:\s|$)/.test(words.text)
          ? `${subject}\n\n${words.text}`.trim()
          : words.text;
      if (!text && !attached.length) return;
      events.message({
        chatId,
        messageId: email.messageId ?? chatId,
        user,
        text,
        files: attached,
        direct: true,
        ...(words.forwarded && { outside: 'a forwarded email' }),
        ...(fresh && { fresh: true }),
      });
    });

    const send = async (
      chatId: string,
      markdown: string,
      sendOptions?: SendOptions,
      attached: OutboundFile[] = [],
    ) => {
      const to = chatId.startsWith('new:') ? chatId.slice(4) : threads.get(chatId)?.to;
      if (!to) throw new ChannelError('refused', 'Conch lost track of that email thread.');
      const thread: Thread = threads.get(chatId) ?? {
        to,
        subject: subjectFrom(markdown || (attached[0]?.name ?? '')),
        references: [],
      };
      const buttons = sendOptions?.buttons ?? [];
      const body = buttons.length ? TextChoices.render(markdown, buttons) : markdown;
      const messageId = `<conch.${randomBytes(12).toString('base64url')}@${domain}>`;
      const subject = this.#preset.plus ? thread.subject : `Conch: ${thread.subject}`;
      const smtp = this.#smtp();
      const mail = {
        from: this.#address,
        to,
        // Your reply comes back to Conch, not into your inbox as a note to self.
        replyTo: this.#writeTo,
        subject: thread.last ? `Re: ${subject}` : subject,
        messageId,
        ...(thread.last && { inReplyTo: thread.last }),
        ...(thread.references.length && { references: thread.references }),
        text: plain(body).slice(0, 200_000),
        // Pictures shown in the email itself, under the words; every file attached too.
        html:
          toEmailHtml(body.slice(0, 200_000)) +
          attached
            .map((file, index) =>
              file.image
                ? `<p><img src="cid:conch-${index}@${domain}" alt="${escapeAttr(file.name)}" style="max-width:100%"></p>`
                : '',
            )
            .join(''),
        ...(attached.length && {
          attachments: attached.map((file, index) => ({
            filename: file.name,
            content: file.bytes,
            contentType: file.mimeType,
            ...(file.image && { cid: `conch-${index}@${domain}` }),
          })),
        }),
        // RFC 3834: an answer made by a program, so other programs don't answer it back.
        headers: { 'Auto-Submitted': 'auto-replied', 'X-Auto-Response-Suppress': 'All' },
      };
      try {
        await sendWithRetry(() => smtp.sendMail(mail));
      } catch (error) {
        throw this.#smtpError(error);
      } finally {
        smtp.close();
      }
      // Answers in a new thread start it; the next ones follow on.
      keep(known, messageId, chatId, 2000);
      keep(threads, chatId, {
        ...thread,
        last: messageId,
        references: [...thread.references, messageId].slice(-20),
      });
      const ref = { chatId, messageId };
      if (buttons.length) choices.remember(ref, buttons);
      return [ref];
    };

    return {
      send: (chatId, markdown, options) => send(chatId, markdown, options),
      // Attached to emails in the thread, as many to one email as mail services take.
      files: {
        maxBytes: MAIL_FILES_LIMIT,
        send: async (chatId, files, caption) => {
          const refs: SentRef[] = [];
          let batch: OutboundFile[] = [];
          let size = 0;
          let words = caption?.trim() ?? '';
          const flush = async () => {
            if (!batch.length) return;
            refs.push(...(await send(chatId, words, undefined, batch)));
            words = '';
            batch = [];
            size = 0;
          };
          for (const file of files) {
            if (batch.length && size + file.bytes.length > MAIL_FILES_LIMIT) await flush();
            batch.push(file);
            size += file.bytes.length;
          }
          await flush();
          return refs;
        },
      },
      // An email can't change once sent; the question's buttons just stop working.
      edit: async (ref) => {
        choices.forget(ref);
      },
      typing: () => Promise.resolve(),
      download: async (file) => {
        const now = Date.now();
        for (const [key, kept] of files) if (now - kept.at > FILE_KEEP_MS) files.delete(key);
        const kept = files.get(file.ref);
        if (!kept) throw new ChannelError('refused', 'That attachment isn’t there any more.');
        files.delete(file.ref);
        return { name: kept.name, bytes: kept.bytes, mimeType: kept.mimeType };
      },
      directChat: (userId) => {
        const raw = Buffer.from(userId.slice(1), 'base64url').toString('utf8');
        if (!userId.startsWith('m') || handleId('m', raw) !== userId)
          return Promise.reject(new ChannelError('refused', 'Conch doesn’t know their address.'));
        return Promise.resolve(`new:${raw}`);
      },
      close: () => stop.abort(),
    };
  }

  /** Watch the inbox (IDLE), and hand over each new email for Conch that really is from its sender. */
  async #listen(
    events: ChannelEvents,
    signal: AbortSignal,
    cursor: string | undefined,
    onEmail: (email: Email) => Promise<void>,
  ) {
    const backoff = new Backoff();
    events.state('connecting');
    let at = parseCursor(cursor);
    while (!signal.aborted) {
      let client: ImapFlow | undefined;
      try {
        client = await this.#login();
        const c = client;
        signal.addEventListener('abort', () => c.close(), { once: true });
        const folders = await c.list().catch(() => []);
        const sent = folders.find((f) => f.specialUse === '\\Sent')?.path;
        if (!folders.some((f) => f.path.toLowerCase() === CONCH_FOLDER.toLowerCase()))
          await c.mailboxCreate(CONCH_FOLDER).catch(() => undefined);
        const inbox = await c.mailboxOpen('INBOX');
        const validity = String(inbox.uidValidity);
        // The mailbox was rebuilt (a new UIDVALIDITY), or it's the first time: start from now.
        if (!at || at.validity !== validity) {
          at = { validity, uid: Math.max(0, inbox.uidNext - 1) };
          events.cursor?.(`${at.validity}:${at.uid}`);
        }
        backoff.reset();
        events.state('online');
        // One look at a time; news that lands during a look gets another look straight after.
        let checking: Promise<void> | undefined;
        let again = false;
        const look = async () => {
          do {
            again = false;
            await this.#check(c, at as Cursor, sent, onEmail, events);
            // The Sent check opens another folder: listen on the inbox again.
            if (c.mailbox && c.mailbox.path !== 'INBOX') await c.mailboxOpen('INBOX');
          } while (again && c.usable);
        };
        const check = () => {
          if (checking) {
            again = true;
            return checking;
          }
          checking = look().finally(() => (checking = undefined));
          return checking;
        };
        c.on('exists', () => void check().catch(() => undefined));
        while (!signal.aborted && c.usable) {
          await check();
          await c.idle();
        }
        if (signal.aborted) return;
        throw new ChannelError('network', 'The mail server closed the connection.');
      } catch (error) {
        client?.close();
        if (signal.aborted) return;
        const failure = error instanceof ChannelError ? error : this.#imapError(error);
        if (failure.code === 'auth') {
          events.state('needs-token', { message: failure.message });
          return;
        }
        const wait = failure.detail?.retryAfterMs ?? backoff.next();
        events.state('reconnecting', { message: failure.message, retryAt: Date.now() + wait });
        await pause(wait, signal);
      }
    }
  }

  async #check(
    client: ImapFlow,
    at: Cursor,
    sent: string | undefined,
    onEmail: (email: Email) => Promise<void>,
    events: ChannelEvents,
  ) {
    if (client.mailbox && client.mailbox.path !== 'INBOX') await client.mailboxOpen('INBOX');
    const since = new Date(Date.now() - RECENT_MS);
    const query = this.#preset.plus
      ? { uid: `${at.uid + 1}:*`, since, or: [{ to: this.#writeTo }, { cc: this.#writeTo }] }
      : { uid: `${at.uid + 1}:*`, since, from: this.#address, to: this.#address };
    const found = (await client.search(query, { uid: true })) || [];
    const uids = found.filter((uid) => uid > at.uid).sort((a, b) => a - b);
    const handled: number[] = [];
    for (const uid of uids) {
      at.uid = uid;
      try {
        const message = await client.fetchOne(
          String(uid),
          { uid: true, size: true, source: true },
          { uid: true },
        );
        if (!message || !message.source || (message.size ?? 0) > MAX_MESSAGE) continue;
        const email = await parseSource(message.source);
        const verdict = await this.#forConch(client, email, sent);
        // Not for Conch, or not provably from its sender: left where it is, unread by anyone.
        if (verdict !== 'ok') continue;
        handled.push(uid);
        await onEmail(email);
      } catch {
        // One email that can't be read never stops the others.
      } finally {
        events.cursor?.(`${at.validity}:${at.uid}`);
      }
    }
    // Filed away once handled, so the inbox stays yours (best effort: reading never depends on it).
    if (handled.length)
      await client
        .messageMove(handled.join(','), CONCH_FOLDER, { uid: true })
        .catch(() => undefined);
  }

  /** Whether an email is for Conch, and really from who it says. */
  async #forConch(
    client: ImapFlow,
    email: Email,
    sent: string | undefined,
  ): Promise<'skip' | 'unverified' | 'ok'> {
    const from = normalHandle(email.from?.address ?? '');
    if (!from || from === this.#writeTo) return 'skip';
    // Conch's own answers (it writes from your address) are never read back.
    if (/^<conch\./.test(email.messageId ?? '') || automatic(email)) return 'skip';
    const recipients = [...(email.to ?? []), ...(email.cc ?? [])].flatMap((a) =>
      a.group ? a.group.map((g) => g.address) : [a.address],
    );
    if (this.#preset.plus) {
      if (!recipients.some((r) => normalHandle(r ?? '') === this.#writeTo)) return 'skip';
    } else {
      const ours = [...messageIds(email.inReplyTo), ...messageIds(email.references)].some((id) =>
        id.startsWith('<conch.'),
      );
      if (!ours && !SUBJECT_TAG.test(bareSubject(email.subject))) return 'skip';
    }
    const verdict = senderVerdict(email.headers, from, this.#preset.authserv);
    // A server of your own may not check mail at all, and then a check written by the
    // sender would be the topmost: your own address needs the Sent-mail proof there.
    const ownOnOther = this.secrets.provider === 'other' && from === this.#address;
    if (verdict === 'pass' && !ownOnOther) return 'ok';
    // Your own mail, sent from your phone, often isn't checked: it's yours if it's in your Sent mail.
    if ((verdict === 'none' || ownOnOther) && from === this.#address && sent && email.messageId) {
      try {
        await client.mailboxOpen(sent, { readOnly: true });
        const inSent = await client.search(
          { header: { 'message-id': email.messageId } },
          { uid: true },
        );
        await client.mailboxOpen('INBOX');
        if (inSent && inSent.length) return 'ok';
      } catch {
        await client.mailboxOpen('INBOX').catch(() => undefined);
      }
    }
    return 'unverified';
  }

  #imapError(error: unknown): ChannelError {
    return imapFailure(error, this.#preset.name, this.#password, this.secrets.password);
  }

  #smtpError(error: unknown): ChannelError {
    if (error instanceof ChannelError) return error;
    const e = error as { code?: string; responseCode?: number; message?: string };
    if (e.code === 'EAUTH')
      return new ChannelError(
        'auth',
        `${this.#preset.name} won’t let Conch send with that app password. Make a new one and paste it.`,
        { field: 'password' },
      );
    if (e.responseCode && e.responseCode >= 500)
      return new ChannelError('refused', `${this.#preset.name} wouldn’t send that email.`);
    return new ChannelError('network', `Couldn’t reach ${this.#preset.name} to send.`);
  }
}

interface Cursor {
  validity: string;
  uid: number;
}

function parseCursor(value: string | undefined): Cursor | undefined {
  const match = /^(\d+):(\d+)$/.exec(value ?? '');
  return match?.[1] && match[2] ? { validity: match[1], uid: Number(match[2]) } : undefined;
}

/** For a server of your own: its checks are signed with its own name (its organisation's domain). */
function otherAuthserv(secrets: EmailSecrets) {
  const host = secrets.server?.imapHost;
  const org = host ? (getDomain(host) ?? host) : undefined;
  return org ? endsWith(org) : () => false;
}

/** A first line short enough for a subject. */
/**
 * What Conch attaches to one email at most: mail services take about 25 MB
 * once the files are written as text (a third bigger), so 18 MB of files.
 */
const MAIL_FILES_LIMIT = 18 * 1024 * 1024;

function escapeAttr(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function subjectFrom(markdown: string): string {
  const line =
    plain(markdown)
      .split('\n')
      .find((l) => l.trim())
      ?.trim() ?? 'Your assistant';
  if (line.length <= 60) return line;
  const cut = line.slice(0, 60);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 30 ? cut.lastIndexOf(' ') : 60)}…`;
}

function toBuffer(content: ArrayBuffer | Uint8Array | string): Buffer {
  if (typeof content === 'string') return Buffer.from(content, 'utf8');
  if (content instanceof Uint8Array)
    return Buffer.from(content.buffer, content.byteOffset, content.byteLength);
  return Buffer.from(content);
}

/** One more try after a moment for a send that hit a blip (never for a refusal). */
async function sendWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const e = error as { code?: string; responseCode?: number };
    if (e.code === 'EAUTH' || (e.responseCode && e.responseCode >= 500)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return fn();
  }
}

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const stop = () =>
      reject(
        new ChannelError('network', 'It took too long to answer. Check the server and try again.'),
      );
    if (signal.aborted) return stop();
    signal.addEventListener('abort', stop, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
  });
}
