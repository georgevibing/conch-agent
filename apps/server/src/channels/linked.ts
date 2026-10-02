/**
 * What WhatsApp and Signal have in common (ADR 0043): neither has bots you
 * can make, so Conch joins your own account as a linked device, like
 * WhatsApp Web or Signal Desktop. That changes three things from a bot:
 *
 * - **You are the account.** You talk to your assistant in the chat with
 *   yourself ("Message yourself", "Note to Self"), and linking by QR code is
 *   your hello: only someone holding your phone can scan it.
 * - **Everyone else is writing to you, not to it.** Their chats are never
 *   read unless you said the number is just for your assistant
 *   (`settings.others: 'ask'`); groups are never answered at all.
 * - **No buttons.** A question lists its answers as numbers, and replying
 *   with one presses it (`TextChoices`).
 */
import type { ChannelBot, ChannelKind, ChannelSecrets, LinkableKind } from '@conch/protocol';

import type { ChannelButton, SentRef } from './types';

/** The kinds that link by QR code instead of a bot key. */
export const LINKED_KINDS: ReadonlySet<ChannelKind> = new Set<ChannelKind>(['whatsapp', 'signal']);

export const isLinked = (kind: ChannelKind): kind is LinkableKind => LINKED_KINDS.has(kind);

/** Messages older than this when they arrive (Conch was off) are left unanswered. */
export const STALE_MS = 24 * 60 * 60_000;

/** `+4915123456789` → `4915123456789`, the person's id (ids are letters and digits). */
export const digitsOf = (phone: string) => phone.replace(/\D/g, '');

/** A number as people read it, from its digits. */
export const phoneOf = (digits: string) => `+${digits}`;

/** What a linker reports while it waits for the phone. */
export interface LinkProgress {
  /** A new code to show; `refreshAt` is when the app replaces it. */
  code(qr: string, refreshAt: number): void;
  /** Scanned: the phone and Conch are finishing. */
  scanned(): void;
}

/** Linking failed in a way the page explains: `expired` (nobody scanned), `install` (needs a program). */
export class LinkError extends Error {
  constructor(
    readonly code: 'expired' | 'install' | 'failed',
    message: string,
    readonly need?: string,
  ) {
    super(message);
  }
}

/** Shows codes until the phone scans one, then hands back what the channel keeps. */
export interface ChannelLinker {
  readonly kind: LinkableKind;
  link(
    progress: LinkProgress,
    signal: AbortSignal,
  ): Promise<{ secrets: ChannelSecrets; bot: ChannelBot }>;
}

/** A bounded set of recent keys: a message delivered twice is handled once. */
export class Recent {
  #keys = new Set<string>();

  constructor(private readonly max = 500) {}

  /** True the first time a key is seen. */
  add(key: string): boolean {
    if (this.#keys.has(key)) return false;
    this.#keys.add(key);
    if (this.#keys.size > this.max) this.#keys.delete(this.#keys.values().next().value ?? '');
    return true;
  }

  has(key: string): boolean {
    return this.#keys.has(key);
  }
}

const normal = (text: string) =>
  text
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const YES = new Set(['yes', 'y', 'ok', 'okay', 'sure', 'allow', 'go', 'go ahead', '👍']);
const NO = new Set(['no', 'n', 'nope', "don't", 'dont', 'deny']);

/**
 * Buttons for apps without them. The question says "Reply 1 to allow…", and
 * a reply of `1` (or the button's words, or a plain yes or no) presses it.
 * A reply quoting a question answers that one; otherwise the newest open one
 * in the chat. An answered question (its message edited) stops listening.
 */
export class TextChoices {
  #open = new Map<string, { ref: SentRef; buttons: ChannelButton[] }[]>();

  /** The question's text with its answers written under it. */
  static render(markdown: string, buttons: ChannelButton[]): string {
    const choices = buttons.map((b, i) => `**${i + 1}** ${b.label}`).join(' · ');
    return `${markdown}\n\nReply with a number: ${choices}`;
  }

  remember(ref: SentRef, buttons: ChannelButton[]) {
    const list = (this.#open.get(ref.chatId) ?? []).filter(
      (q) => q.ref.messageId !== ref.messageId,
    );
    // A handful per chat is plenty: older questions are answered in Conch.
    this.#open.set(ref.chatId, [...list, { ref, buttons }].slice(-5));
  }

  forget(ref: SentRef) {
    const list = this.#open.get(ref.chatId)?.filter((q) => q.ref.messageId !== ref.messageId);
    if (list?.length) this.#open.set(ref.chatId, list);
    else this.#open.delete(ref.chatId);
  }

  /** The button a reply presses, if it's an answer to an open question. */
  match(chatId: string, text: string, quoted?: string): { data: string; ref: SentRef } | undefined {
    const list = this.#open.get(chatId);
    // A command (/stop, /new) is never an answer.
    if (!list?.length || text.trim().startsWith('/')) return undefined;
    const question = (quoted && list.find((q) => q.ref.messageId === quoted)) || list.at(-1);
    if (!question) return undefined;
    const said = normal(text);
    if (!said || said.length > 40) return undefined;
    const { buttons } = question;
    const number = /^(\d)$/.exec(said)?.[1];
    const button =
      (number ? buttons[Number(number) - 1] : undefined) ??
      buttons.find((b) => normal(b.label) === said) ??
      (YES.has(said) ? (buttons.find((b) => b.style === 'primary') ?? buttons[0]) : undefined) ??
      (NO.has(said) ? buttons.find((b) => b.style === 'danger') : undefined);
    return button ? { data: button.data, ref: question.ref } : undefined;
  }
}
