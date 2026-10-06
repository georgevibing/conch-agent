/**
 * Gmail with an app password (ADR 0048): IMAP to imap.gmail.com, with
 * Gmail's own search (X-GM-RAW) and ids (X-GM-MSGID, which is the Gmail API's
 * message id in decimal), so the same tools work either way. Drafts are saved
 * with APPEND into the Drafts folder. Sending goes to smtp.gmail.com over TLS,
 * only when the account is allowed to write and the person said yes to that
 * one email; Gmail files it in Sent, where its Message-ID finds it again.
 */
import type { ImapFlow, MessageStructureObject } from 'imapflow';
import nodemailer from 'nodemailer';

import { MAIL_PRESETS } from '../channels/email';
import { imapClient, imapFailure, type ImapWhere } from '../channels/imap';
import { ChannelError } from '../channels/types';
import type { MailSummary } from './views';

/** Where Gmail is: always imap.gmail.com, except a pretend server on 127.0.0.1 in tests. */
export interface GmailEndpoint {
  imap: ImapWhere;
  /** Where mail is sent: smtp.gmail.com, or the pretend server's. */
  smtp?: { host: string; port: number };
  insecure?: true;
}
export const GMAIL_IMAP: GmailEndpoint = {
  imap: MAIL_PRESETS.gmail.imap,
  smtp: MAIL_PRESETS.gmail.smtp,
};

export interface GmailLogin {
  address: string;
  password: string;
}

export interface ImapMessage {
  /** Gmail's id, in hex, as the Gmail API writes it. */
  id: string;
  threadId?: string;
  /** `SENT`, `DRAFT`, `INBOX`, as the Gmail API names them. */
  labelIds: string[];
  source: Buffer;
}

/** Bigger than this isn't read here: Gmail itself shows it better. */
const MAX_SOURCE = 10 * 1024 * 1024;
const HEX_ID = /^[0-9a-f]{1,16}$/;
/** A read that hit a blip is tried again after these pauses; a write never is. */
const READ_RETRIES = [500, 2_000];

export const toHex = (decimal: string | undefined) =>
  decimal && /^\d{1,20}$/.test(decimal) ? BigInt(decimal).toString(16) : undefined;
const toDecimal = (hex: string) => {
  if (!HEX_ID.test(hex)) throw new ChannelError('refused', 'That isn’t a Gmail message id.');
  return BigInt(`0x${hex}`).toString();
};

/** A part someone attached: marked as one, or a mixed message with more than its text. */
function hasAttachment(part: MessageStructureObject | undefined, depth = 0): boolean {
  if (!part || depth > 20) return false;
  if (part.disposition === 'attachment') return true;
  return (part.childNodes ?? []).some((child) => hasAttachment(child, depth + 1));
}

const LABELS: Record<string, string> = { '\\Sent': 'SENT', '\\Draft': 'DRAFT', '\\Inbox': 'INBOX' };

/** A step of a draft save: before APPEND went out nothing was saved; after, nobody knows. */
export class DraftUncertain extends Error {}
/** A send that may have gone: the message was on its way when it failed. Never retried. */
export class SendUncertain extends Error {}
/** Failures that happen before a message is handed over: nothing was sent (nodemailer's codes). */
const NOT_SENT = new Set(['EAUTH', 'ECONNECTION', 'EDNS', 'ETLS', 'EENVELOPE', 'ENOAUTH']);

export class GmailImap {
  constructor(
    private readonly endpoint: () => GmailEndpoint = () => GMAIL_IMAP,
    private readonly pause: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  /** Sign in and out again: whether Gmail takes this app password. */
  async verify(login: GmailLogin): Promise<void> {
    await this.#session(login, async () => undefined);
  }

  /**
   * Gmail's own search, newest first, as message ids (not contents). Each
   * carries a `summary` of its envelope for the person's view of the results
   * (ADR 0060) when the server describes it; the model is given only the ids.
   */
  async search(login: GmailLogin, query: string, limit: number) {
    return this.#session(login, async (client) => {
      await client.mailboxOpen(await this.#folder(client, '\\All'), { readOnly: true });
      const uids = ((await client.search({ gmraw: query }, { uid: true })) || []).sort(
        (a, b) => b - a,
      );
      const found: { uid: number; id: string; threadId?: string; summary?: MailSummary }[] = [];
      const picked = uids.slice(0, limit);
      if (picked.length)
        for await (const m of client.fetch(
          picked.join(','),
          { uid: true, threadId: true, envelope: true, flags: true, bodyStructure: true },
          { uid: true },
        )) {
          const id = toHex(m.emailId);
          const threadId = toHex(m.threadId);
          if (!id) continue;
          const envelope = m.envelope;
          found.push({
            uid: m.uid,
            id,
            ...(threadId && { threadId }),
            ...(envelope && {
              summary: {
                id,
                from: envelope.from?.[0],
                subject: envelope.subject,
                date: envelope.date,
                seen: Boolean(m.flags?.has('\\Seen')),
                attachments: hasAttachment(m.bodyStructure),
              },
            }),
          });
        }
      // Newest first, as Gmail lists them.
      const messages = found
        .sort((a, b) => b.uid - a.uid)
        .map(({ uid: _uid, ...message }) => message);
      return { messages, resultSizeEstimate: uids.length };
    });
  }

  /** One message's source, wherever it's filed (All Mail, or Drafts). */
  async message(login: GmailLogin, id: string): Promise<ImapMessage> {
    const decimal = toDecimal(id);
    return this.#session(login, async (client) => {
      for (const use of ['\\All', '\\Drafts'] as const) {
        const found = await this.#find(client, await this.#folder(client, use), {
          emailId: decimal,
        });
        if (found[0]) return found[0];
      }
      throw new ChannelError('refused', 'That email isn’t in Gmail any more.');
    });
  }

  /** Drafts with this Message-ID header (Conch's drafts carry one of their own). */
  async drafts(login: GmailLogin, messageId: string): Promise<ImapMessage[]> {
    return this.#session(login, async (client) =>
      this.#find(client, await this.#folder(client, '\\Drafts'), {
        header: { 'message-id': messageId },
      }),
    );
  }

  /**
   * Who the newest messages matching a search went to, in one sign-in: the
   * people you write to, for picking whose mail starts a routine (ADR 0056).
   * Envelopes only, never a message's text.
   */
  async recipients(
    login: GmailLogin,
    query: string,
    limit: number,
  ): Promise<{ address: string; name?: string }[]> {
    return this.#session(login, async (client) => {
      await client.mailboxOpen(await this.#folder(client, '\\All'), { readOnly: true });
      const uids = ((await client.search({ gmraw: query }, { uid: true })) || [])
        .sort((a, b) => b - a)
        .slice(0, limit);
      const out: { address: string; name?: string }[] = [];
      if (uids.length)
        for await (const m of client.fetch(
          uids.join(','),
          { uid: true, envelope: true },
          { uid: true },
        ))
          for (const to of [...(m.envelope?.to ?? []), ...(m.envelope?.cc ?? [])])
            if (to.address) out.push({ address: to.address, ...(to.name && { name: to.name }) });
      return out;
    });
  }

  /**
   * Save a draft: APPEND into Drafts, marked as a draft. Never retried. A
   * failure before APPEND went out means nothing was saved; after, Gmail may
   * have it (`DraftUncertain`), and only reading the drafts back can say.
   */
  async saveDraft(login: GmailLogin, raw: string, signal?: AbortSignal): Promise<void> {
    let sent = false;
    try {
      await this.#session(
        login,
        async (client) => {
          const folder = await this.#folder(client, '\\Drafts');
          if (signal?.aborted) throw new ChannelError('refused', 'Stopped before saving.');
          sent = true;
          const done = await client.append(folder, raw, ['\\Draft', '\\Seen']);
          if (!done) throw new Error('Gmail didn’t confirm the draft.');
        },
        true,
      );
    } catch (error) {
      if (sent) throw new DraftUncertain('Gmail may have saved this draft.');
      throw error;
    }
  }

  /**
   * Send one email through Gmail's SMTP with the app password: TLS only (the
   * pretend server in tests aside), one try. A failure before the message
   * was handed over is "nothing was sent"; after, it may have gone
   * (`SendUncertain`), and only Sent can say.
   */
  async send(
    login: GmailLogin,
    raw: string,
    envelope: { from: string; to: string[] },
    signal?: AbortSignal,
  ): Promise<void> {
    const endpoint = this.endpoint();
    const where = endpoint.smtp ?? MAIL_PRESETS.gmail.smtp;
    if (signal?.aborted) throw new ChannelError('refused', 'Stopped before sending.');
    const smtp = nodemailer.createTransport({
      host: where.host,
      port: where.port,
      secure: !endpoint.insecure && where.port === 465,
      // Never send a password without TLS, except to the pretend server.
      requireTLS: !endpoint.insecure,
      ...(endpoint.insecure && { ignoreTLS: true }),
      auth: { user: login.address, pass: login.password.replace(/\s+/g, '') },
      connectionTimeout: 20_000,
      greetingTimeout: 15_000,
      socketTimeout: 60_000,
    });
    try {
      await smtp.sendMail({ envelope, raw });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'EAUTH')
        throw new ChannelError(
          'auth',
          'Gmail won’t let Conch send with that app password. Make a new one and paste it.',
        );
      if (code && NOT_SENT.has(code))
        throw new ChannelError('network', 'Couldn’t reach Gmail to send. Nothing was sent.');
      throw new SendUncertain('Gmail may have sent this email.');
    } finally {
      smtp.close();
    }
  }

  /** Mail with this Message-ID anywhere in Gmail (All Mail holds Sent too). */
  async sent(login: GmailLogin, messageId: string): Promise<ImapMessage[]> {
    return this.#session(login, async (client) =>
      this.#find(client, await this.#folder(client, '\\All'), {
        header: { 'message-id': messageId },
      }),
    );
  }

  async #find(
    client: ImapFlow,
    folder: string,
    query: { emailId?: string; header?: Record<string, string> },
  ): Promise<ImapMessage[]> {
    await client.mailboxOpen(folder, { readOnly: true });
    const uids = (await client.search(query, { uid: true })) || [];
    const out: ImapMessage[] = [];
    if (!uids.length) return out;
    for await (const m of client.fetch(
      uids.slice(0, 20).join(','),
      { uid: true, size: true, source: true, threadId: true, labels: true, flags: true },
      { uid: true },
    )) {
      const id = toHex(m.emailId);
      if (!id || !m.source) continue;
      if ((m.size ?? m.source.length) > MAX_SOURCE)
        throw new ChannelError('refused', 'That email is too big to read here. Open it in Gmail.');
      const labels = [...(m.labels ?? [])].flatMap((l) => (LABELS[l] ? [LABELS[l]] : []));
      if (m.flags?.has('\\Draft') && !labels.includes('DRAFT')) labels.push('DRAFT');
      out.push({
        id,
        ...(toHex(m.threadId) && { threadId: toHex(m.threadId) }),
        labelIds: labels,
        source: m.source,
      });
    }
    return out;
  }

  /** Gmail names its folders in your language ("[Google Mail]/Alle Nachrichten"): find them by use. */
  async #folder(client: ImapFlow, use: '\\All' | '\\Drafts'): Promise<string> {
    const folders = await client.list();
    const found = folders.find((f) => f.specialUse === use)?.path;
    if (found) return found;
    throw new ChannelError(
      'setup',
      use === '\\All'
        ? 'Gmail isn’t showing All Mail to IMAP. In Gmail’s settings → Labels, tick “Show in IMAP” for All Mail.'
        : 'Gmail isn’t showing Drafts to IMAP. In Gmail’s settings → Labels, tick “Show in IMAP” for Drafts.',
    );
  }

  /**
   * Sign in, do one thing, sign out. A blip (Gmail restarting, the network
   * dropping) is tried again with a pause, unless it's a write.
   */
  async #session<T>(
    login: GmailLogin,
    run: (client: ImapFlow) => Promise<T>,
    once = false,
  ): Promise<T> {
    const password = login.password.replace(/\s+/g, '');
    for (let attempt = 0; ; attempt++) {
      const endpoint = this.endpoint();
      const client = imapClient(
        endpoint.imap,
        { user: login.address, pass: password },
        { insecure: endpoint.insecure },
      );
      try {
        await client.connect();
        const result = await run(client);
        await client.logout().catch(() => client.close());
        return result;
      } catch (error) {
        client.close();
        const failure =
          error instanceof DraftUncertain
            ? error
            : imapFailure(error, 'Gmail', password, login.password);
        const delay = READ_RETRIES[attempt];
        if (
          once ||
          delay === undefined ||
          !(failure instanceof ChannelError) ||
          failure.code !== 'network'
        )
          throw failure;
        await this.pause(delay);
      }
    }
  }
}
