import { randomBytes } from 'node:crypto';

import type { ChannelBot } from '@conch/protocol';

import { fit } from './format';
import { LinkError, phoneOf, Recent, STALE_MS, TextChoices } from './linked';
import type { ChannelLinker, LinkProgress } from './linked';
import { toWhatsApp } from './linked-format';
import {
  Backoff,
  type ChannelAdapter,
  type ChannelConnection,
  ChannelError,
  type ChannelEvents,
  type ChannelFile,
  type SendOptions,
  type SentRef,
  dataUrl,
  pause,
} from './types';
import {
  memorySession,
  type WaIdentity,
  type WaSessionHandle,
  type WhatsAppSessions,
} from './whatsapp-sessions';
import { newId } from '../lib/ids';

/**
 * WhatsApp's own reasons for closing a connection (Baileys' `DisconnectReason`),
 * so the adapter can tell "link again" from "try again".
 */
export const WA_CLOSE = {
  connectionClosed: 428,
  connectionLost: 408,
  connectionReplaced: 440,
  loggedOut: 401,
  badSession: 500,
  restartRequired: 515,
  multideviceMismatch: 411,
  forbidden: 403,
  unavailable: 503,
} as const;

/** A message as the transport hands it over: already reduced to what Conch reads. */
export interface WaInbound {
  id: string;
  /** Where it was written (and where an answer goes). */
  chat: string;
  /** Sent from the linked account itself (the person's phone, or Conch). */
  fromMe: boolean;
  /** Who wrote it: the chat for a private chat, the participant in a group. */
  sender: string;
  /** The same person's other address (their number, when the chat uses their private id). */
  senderAlt?: string;
  /** The name they gave themselves. */
  name?: string;
  /** Epoch ms. */
  at: number;
  text: string;
  /** `ref` is the message id, for `download`. */
  files: ChannelFile[];
  group: boolean;
  /** The message this one replied to. */
  quoted?: string;
}

export interface WaHandlers {
  qr(code: string): void;
  open(me: WaIdentity): void;
  close(code: number | undefined, message: string): void;
  /** `live`: arrived now, not synced from the past. */
  messages(messages: WaInbound[], live: boolean): void;
}

/** One live connection to WhatsApp, as the adapter needs it. */
export interface WaSocket {
  /** `id`: the message's id, chosen beforehand so its echo is known as Conch's own. */
  send(chat: string, text: string, options?: { edit?: string; id?: string }): Promise<string>;
  react(chat: string, id: string, fromMe: boolean, emoji: string): Promise<void>;
  presence(chat: string, state: 'composing' | 'paused'): Promise<void>;
  read(chat: string, id: string, participant?: string): Promise<void>;
  download(id: string, maxBytes: number): Promise<{ bytes: Buffer; mimeType?: string }>;
  picture(jid: string): Promise<Buffer | undefined>;
  /** Take this device off the account. */
  logout(): Promise<void>;
  end(): void;
}

/**
 * Opens a connection with a session's keys (none yet: it shows QR codes).
 * The real one is Baileys (`whatsapp-baileys.ts`); tests and the mock engine
 * use a pretend one (`mock/whatsapp.ts`).
 */
export type WaConnect = (session: WaSessionHandle, handlers: WaHandlers) => Promise<WaSocket>;

/** Pictures, voice notes, files: what Conch takes at most. */
const FILE_LIMIT = 25 * 1024 * 1024;
/** WhatsApp takes 65,536 characters, but a phone screen reads better in parts this long. */
const PART = 4000;
/** How long to wait out another copy of the link, and the window in which two take-overs mean one. */
const REPLACED_WAIT_MS = 60_000;
const REPLACED_WINDOW_MS = 5 * 60_000;

/** `4915123456789:12@s.whatsapp.net` → `4915123456789`. */
const userOf = (jid: string | undefined) => (jid ?? '').split('@')[0]?.split(':')[0] ?? '';
const isLid = (jid: string | undefined) => Boolean(jid?.endsWith('@lid'));
const isPn = (jid: string | undefined) => Boolean(jid?.endsWith('@s.whatsapp.net'));
const sameUser = (a: string | undefined, b: string | undefined) =>
  Boolean(a && b) && userOf(a) === userOf(b) && a?.split('@')[1] === b?.split('@')[1];

/** A person's id in Conch: their number's digits, or `l` and their private id. */
export function personId(jid: string, alt?: string): string | undefined {
  const pn = isPn(jid) ? jid : isPn(alt) ? alt : undefined;
  if (pn) return userOf(pn).replace(/\D/g, '') || undefined;
  const lid = isLid(jid) ? jid : isLid(alt) ? alt : undefined;
  const id = lid ? userOf(lid).replace(/\D/g, '') : '';
  return id ? `l${id}` : undefined;
}

/** Who the account is, as a channel shows it. */
export function waBot(me: WaIdentity, avatar?: string): ChannelBot {
  const digits = userOf(me.jid).replace(/\D/g, '');
  return {
    id: digits,
    name: me.name?.trim() || phoneOf(digits),
    phone: phoneOf(digits),
    // Your own number opens the chat with yourself, where you talk to your assistant.
    chatUrl: `https://wa.me/${digits}`,
    ...(avatar && { avatar }),
  };
}

/**
 * WhatsApp, as a linked device of your own account (ADR 0043), through an
 * unofficial client: WhatsApp's terms allow only its own apps, and it can
 * restrict a number it believes is automated. The setup says so.
 *
 * You talk to your assistant in **Message yourself**. Other chats are never
 * read unless the number is just for your assistant; groups never answered.
 *
 * Healing: WhatsApp's "restart" after linking reconnects at once; a dropped
 * or timed-out connection retries with backoff; another copy of this link
 * taking over (`440`) is waited out and named; a session WhatsApp ended
 * (unlinked on the phone, `401`) or can no longer read (`500`, `411`) stops
 * this channel only and asks to link again.
 */
export class WhatsAppAdapter implements ChannelAdapter {
  readonly kind = 'whatsapp' as const;

  constructor(
    private readonly sessionId: string,
    private readonly deps: { sessions: WhatsAppSessions; connect: WaConnect },
  ) {}

  async identify(): Promise<ChannelBot> {
    const session = await this.deps.sessions.get(this.sessionId);
    if (!session)
      throw new ChannelError(
        'auth',
        'Conch lost its WhatsApp link. Link it again with the code on its page in Apps.',
      );
    return waBot(session.me);
  }

  async forget(): Promise<void> {
    await this.deps.sessions.remove(this.sessionId);
  }

  connect(events: ChannelEvents): ChannelConnection {
    const stop = new AbortController();
    const choices = new TextChoices();
    const sent = new Recent(1000);
    const seen = new Recent(1000);
    let socket: WaSocket | undefined;
    let me: WaIdentity | undefined;
    let since = 0;

    const live = () => {
      if (!socket) throw new ChannelError('network', 'WhatsApp isn’t connected right now.');
      return socket;
    };
    const self = () => (me ? `${userOf(me.jid)}@s.whatsapp.net` : '');
    const ownerId = () => (me ? userOf(me.jid).replace(/\D/g, '') : '');

    const deliver = (list: WaInbound[], fresh: boolean) => {
      if (!fresh || !me) return;
      for (const message of list) {
        if (!seen.add(message.id) || sent.has(message.id)) continue;
        if (message.fromMe && message.id.startsWith(CONCH_ID_PREFIX)) continue;
        // Written before the link, or while Conch was off for more than a day: left alone.
        if (message.at < since || Date.now() - message.at > STALE_MS) continue;
        if (/@(broadcast|newsletter)$/.test(message.chat)) continue;
        const toSelf =
          message.fromMe && (sameUser(message.chat, me.jid) || sameUser(message.chat, me.lid));
        // You, writing to someone else from your phone: none of Conch's business.
        if (message.fromMe && !toSelf) continue;
        const id = toSelf ? ownerId() : personId(message.sender, message.senderAlt);
        if (!id) continue;
        const user = toSelf
          ? { id, name: me.name?.trim() || 'You' }
          : { id, name: message.name?.trim() || phoneOf(id.replace(/^l/, '')) };
        const answer = choices.match(message.chat, message.text, message.quoted);
        if (answer && !message.files.length) {
          events.press({
            chatId: message.chat,
            user,
            data: answer.data,
            message: answer.ref,
            ack: async () => {
              await socket?.react(message.chat, message.id, message.fromMe, '👍').catch(() => {});
            },
          });
          continue;
        }
        events.message({
          chatId: message.chat,
          messageId: message.id,
          user,
          text: message.text,
          files: message.files,
          direct: !message.group,
        });
      }
    };

    void (async () => {
      const backoff = new Backoff();
      // Two copies of one link knock each other off in turn: twice in a few minutes is a pattern.
      let replaced: number[] = [];
      while (!stop.signal.aborted) {
        const session = await this.deps.sessions.get(this.sessionId).catch(() => undefined);
        if (!session) {
          events.state('needs-token', {
            message:
              'Conch lost its WhatsApp link. Link it again with the code on its page in Apps.',
          });
          return;
        }
        me = session.me;
        since = session.since;
        events.state('connecting');
        const closed = await new Promise<{ code?: number; message: string }>((resolve) => {
          const handlers: WaHandlers = {
            // A session that asks for a new QR code was unlinked: a person has to scan again.
            qr: () =>
              resolve({ code: WA_CLOSE.loggedOut, message: 'WhatsApp asked to link again.' }),
            open: (who) => {
              me = { ...who, name: who.name ?? me?.name };
              backoff.reset();
              events.state('online');
            },
            close: (code, message) => resolve({ ...(code !== undefined && { code }), message }),
            messages: deliver,
          };
          this.deps
            .connect(this.deps.sessions.handle(this.sessionId), handlers)
            .then((made) => {
              socket = made;
              if (stop.signal.aborted) made.end();
            })
            .catch((error: unknown) =>
              resolve({ message: error instanceof Error ? error.message : String(error) }),
            );
          stop.signal.addEventListener(
            'abort',
            () => resolve({ code: WA_CLOSE.connectionClosed, message: 'closed' }),
            { once: true },
          );
        });
        socket?.end();
        socket = undefined;
        await this.deps.sessions.flush().catch(() => undefined);
        if (stop.signal.aborted) return;

        const code = closed.code;
        if (
          code === WA_CLOSE.loggedOut ||
          code === WA_CLOSE.badSession ||
          code === WA_CLOSE.multideviceMismatch
        ) {
          events.state('needs-token', {
            message:
              code === WA_CLOSE.loggedOut
                ? 'WhatsApp unlinked Conch (from Linked devices on your phone, or by itself). Link it again to carry on.'
                : 'WhatsApp can’t read Conch’s link any more. Link it again to carry on.',
          });
          return;
        }
        if (code === WA_CLOSE.forbidden) {
          events.state('error', {
            message:
              'WhatsApp refused this number for linked devices. Open WhatsApp on your phone to see why.',
          });
          return;
        }
        // Right after linking, WhatsApp asks for a fresh connection: at once.
        if (code === WA_CLOSE.restartRequired) continue;
        if (code === WA_CLOSE.connectionReplaced)
          replaced = [...replaced.filter((at) => Date.now() - at < REPLACED_WINDOW_MS), Date.now()];
        if (code === WA_CLOSE.connectionReplaced && replaced.length >= 2) {
          replaced = [];
          events.state('conflict', {
            message:
              'Another copy of this link took over (another Conch with the same backup, perhaps). Stop it, or link WhatsApp again.',
            retryAt: Date.now() + REPLACED_WAIT_MS,
          });
          await pause(REPLACED_WAIT_MS, stop.signal);
          continue;
        }
        const wait = backoff.next();
        events.state('reconnecting', {
          message: 'Couldn’t reach WhatsApp. Conch keeps trying by itself.',
          retryAt: Date.now() + wait,
        });
        await pause(wait, stop.signal);
      }
    })();

    const send = async (chatId: string, markdown: string, options?: SendOptions) => {
      const parts = fit(markdown, PART, (part) => toWhatsApp(part).length);
      const refs: SentRef[] = [];
      for (const [index, part] of parts.entries()) {
        const buttons = index === parts.length - 1 ? options?.buttons : undefined;
        const text = toWhatsApp(buttons?.length ? TextChoices.render(part, buttons) : part);
        // Known as Conch's own before it goes, so its echo is never read as you writing.
        const chosen = messageId();
        sent.add(chosen);
        const id = await withRetry(() => live().send(chatId, text, { id: chosen }));
        sent.add(id);
        const ref = { chatId, messageId: id };
        if (buttons?.length) choices.remember(ref, buttons);
        refs.push(ref);
      }
      return refs;
    };

    return {
      send,
      edit: async (ref, markdown, options) => {
        choices.forget(ref);
        const first = fit(markdown, PART, (part) => toWhatsApp(part).length)[0] ?? '…';
        const text = options?.buttons?.length ? TextChoices.render(first, options.buttons) : first;
        await live().send(ref.chatId, toWhatsApp(text), { edit: ref.messageId });
        if (options?.buttons?.length) choices.remember(ref, options.buttons);
      },
      typing: async (chatId) => {
        // Nobody sees yourself typing to yourself.
        if (chatId !== self() && !sameUser(chatId, me?.lid))
          await live().presence(chatId, 'composing');
      },
      seen: async (ref, working) => {
        const s = live();
        const mine = sameUser(ref.chatId, me?.jid) || sameUser(ref.chatId, me?.lid);
        if (working && !mine) await s.read(ref.chatId, ref.messageId).catch(() => undefined);
        await s.react(ref.chatId, ref.messageId, mine, working ? '👀' : '');
      },
      download: async (file) => {
        if (file.size && file.size > FILE_LIMIT)
          throw new ChannelError(
            'refused',
            'That’s bigger than the 25 MB Conch takes from WhatsApp.',
          );
        const got = await live()
          .download(file.ref, FILE_LIMIT)
          .catch((error: unknown) => {
            throw error instanceof ChannelError
              ? error
              : new ChannelError(
                  'refused',
                  /too big/i.test(String(error))
                    ? 'That’s bigger than the 25 MB Conch takes from WhatsApp.'
                    : 'WhatsApp didn’t hand over that file. Send it again.',
                );
          });
        return { name: file.name, bytes: got.bytes, mimeType: got.mimeType ?? file.mimeType };
      },
      directChat: (userId) =>
        Promise.resolve(
          userId === ownerId()
            ? self()
            : userId.startsWith('l')
              ? `${userId.slice(1)}@lid`
              : `${userId}@s.whatsapp.net`,
        ),
      unlink: async () => {
        await socket?.logout();
      },
      close: () => {
        stop.abort();
        socket?.end();
      },
    };
  }
}

/**
 * Every message Conch sends has an id that starts like this, so one Conch
 * never reads another's answers as you writing (two computers linked to the
 * same account would otherwise answer each other forever).
 */
export const CONCH_ID_PREFIX = 'C0C4';
const messageId = () => `${CONCH_ID_PREFIX}${randomBytes(8).toString('hex').toUpperCase()}`;

/** One retry for a send that hit a blip. */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ChannelError && error.code !== 'network') throw error;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    try {
      return await fn();
    } catch (again) {
      throw again instanceof ChannelError
        ? again
        : new ChannelError(
            'network',
            'WhatsApp didn’t take that message. It’ll work again once it reconnects.',
          );
    }
  }
}

/** How long WhatsApp shows codes before giving up (it sends six, about three minutes). */
const LINK_MS = 5 * 60_000;

/**
 * Linking WhatsApp: codes until the phone scans one, then WhatsApp's own
 * "restart", then a connection that says who the account is. Only then are
 * its keys kept (`sessions.put`): a link left half-way leaves nothing behind.
 */
export class WhatsAppLinker implements ChannelLinker {
  readonly kind = 'whatsapp' as const;

  constructor(private readonly deps: { sessions: WhatsAppSessions; connect: WaConnect }) {}

  async link(progress: LinkProgress, signal: AbortSignal) {
    const session = memorySession();
    const deadline = Date.now() + LINK_MS;
    let codes = 0;
    let scanned = false;
    for (let restarts = 0; restarts < 3; restarts++) {
      if (signal.aborted) throw new LinkError('failed', 'Stopped.');
      let socket: WaSocket | undefined;
      const result = await new Promise<{ me?: WaIdentity; code?: number; message?: string }>(
        (resolve) => {
          const done = (value: { me?: WaIdentity; code?: number; message?: string }) => {
            clearTimeout(timer);
            resolve(value);
          };
          const timer = setTimeout(
            () => done({ code: WA_CLOSE.connectionLost, message: 'timeout' }),
            Math.max(1000, deadline - Date.now()),
          );
          signal.addEventListener('abort', () => done({ message: 'stopped' }), { once: true });
          this.deps
            .connect(session, {
              qr: (code) => {
                codes++;
                // WhatsApp's first code lasts a minute, the ones after about twenty seconds.
                progress.code(code, Date.now() + (codes === 1 ? 60_000 : 20_000));
              },
              open: (me) => done({ me }),
              close: (code, message) => {
                if (code === WA_CLOSE.restartRequired && !scanned) {
                  scanned = true;
                  progress.scanned();
                }
                done({ ...(code !== undefined && { code }), message });
              },
              messages: () => undefined,
            })
            .then((made) => {
              socket = made;
            })
            .catch((error: unknown) =>
              done({ message: error instanceof Error ? error.message : String(error) }),
            );
        },
      );
      if (result.me) {
        const picture = await socket?.picture(result.me.jid).catch(() => undefined);
        // The linking connection ends here; the channel opens its own.
        socket?.end();
        const state = session.current();
        if (!state) throw new LinkError('failed', 'WhatsApp linked, but sent no keys. Try again.');
        const id = newId('wa');
        await this.deps.sessions.put(id, { me: result.me, since: Date.now(), state });
        return {
          secrets: { kind: 'whatsapp' as const, session: id },
          bot: waBot(result.me, picture ? dataUrl(picture) : undefined),
        };
      }
      socket?.end();
      if (signal.aborted) throw new LinkError('failed', 'Stopped.');
      if (result.code === WA_CLOSE.restartRequired) continue;
      if (result.code === WA_CLOSE.connectionLost && codes > 0 && !scanned)
        throw new LinkError('expired', 'Nobody scanned the code in time.');
      if (result.code === WA_CLOSE.forbidden)
        throw new LinkError('failed', 'WhatsApp refused to link this number.');
      throw new LinkError(
        'failed',
        codes === 0
          ? 'Couldn’t reach WhatsApp. Check this computer’s internet connection, then try again.'
          : 'WhatsApp stopped the link before it finished. Try again.',
      );
    }
    throw new LinkError('failed', 'WhatsApp didn’t finish linking. Try again.');
  }
}
