import type { ChannelBot, ChannelKind, ChannelSecrets, ChannelState } from '@conch/protocol';

/** Someone writing to the bot, as the app describes them. */
export interface ChannelUser {
  /** Their id in the app; always a valid `Id` (digits, or Slack's `U…`). */
  id: string;
  name: string;
  username?: string;
}

/** A file someone sent with a message; `ref` is whatever the app needs to fetch it. */
export interface ChannelFile {
  name: string;
  mimeType?: string;
  size?: number;
  ref: string;
}

/** Where a message Conch sent lives, so it can be changed later (a button pressed). */
export interface SentRef {
  chatId: string;
  messageId: string;
}

export interface ChannelMessage {
  /** Where to answer. */
  chatId: string;
  messageId: string;
  user: ChannelUser;
  text: string;
  files: ChannelFile[];
  /** A private chat with the bot. Only these are answered: groups are ignored. */
  direct: boolean;
}

/** Someone pressed one of Conch's buttons. */
export interface ChannelPress {
  chatId: string;
  user: ChannelUser;
  /** The `data` of the button. */
  data: string;
  message: SentRef;
  /** Tell the app the press was handled (with a short note, where the app shows one). */
  ack: (note?: string) => Promise<void>;
}

export interface ChannelButton {
  label: string;
  data: string;
  style?: 'primary' | 'danger';
}

export interface SendOptions {
  /** Shown under the (last part of the) message. */
  buttons?: ChannelButton[];
}

/** What a running connection tells the service. */
export interface ChannelEvents {
  message(message: ChannelMessage): void;
  press(press: ChannelPress): void;
  state(state: ChannelState, detail?: { message?: string; retryAt?: number }): void;
  /** A repair the connection made by itself, for "Fixed on its own". */
  healed(message: string): void;
  /** Discord: the bot joined a server (so people there can now message it). */
  joined?(): void;
}

/** A live connection to one bot. It reconnects by itself until closed. */
export interface ChannelConnection {
  /** Send Markdown; long answers go as several messages. Returns each one sent. */
  send(chatId: string, markdown: string, options?: SendOptions): Promise<SentRef[]>;
  /** Replace a message's text (and buttons; none removes them). */
  edit(ref: SentRef, markdown: string, options?: SendOptions): Promise<void>;
  /** Show "typing…" for a few seconds. */
  typing(chatId: string): Promise<void>;
  /** Mark a message as seen and being worked on (Slack, which has no typing indicator for bots). */
  seen?(ref: SentRef, working: boolean): Promise<void>;
  download(file: ChannelFile): Promise<{ name: string; bytes: Buffer; mimeType?: string }>;
  /** The private chat with someone, opening it if needed (for messages Conch starts). */
  directChat(userId: string): Promise<string>;
  close(): void;
}

/** Tidy the bot's own profile after connecting: its commands and description. */
export interface ChannelProfile {
  assistant: string;
  owner?: string;
}

/** One kind of chat app. */
export interface ChannelAdapter {
  readonly kind: ChannelKind;
  /** Check the keys and say who the bot is. Throws `ChannelError`. */
  identify(signal?: AbortSignal): Promise<ChannelBot>;
  /** Best effort: set the bot's commands and description so it explains itself. */
  prepare?(profile: ChannelProfile): Promise<void>;
  connect(events: ChannelEvents): ChannelConnection;
}

export type AdapterFactory = (secrets: ChannelSecrets) => ChannelAdapter;

/**
 * Why a call to the app failed, in terms the service can act on:
 *
 * - `auth`: the key was refused (a person has to get a new one);
 * - `conflict`: another program has this bot (Telegram);
 * - `network`: couldn't reach the app, or it had a hiccup (retry);
 * - `rate-limit`: too fast (`retryAfterMs`);
 * - `refused`: the app said no to this one request (a bad message, a blocked user);
 * - `setup`: something in the app's own settings needs changing (named in the message).
 */
export class ChannelError extends Error {
  constructor(
    readonly code: 'auth' | 'conflict' | 'network' | 'rate-limit' | 'refused' | 'setup',
    message: string,
    readonly detail?: { retryAfterMs?: number; field?: 'token' | 'botToken' | 'appToken' },
  ) {
    super(message);
  }
}

/**
 * Retry delays that grow (1 s, 2 s, 5 s, 10 s, 30 s, then every minute) with a
 * little jitter, so a flaky network is retried lightly and many channels
 * don't all knock at once.
 */
export class Backoff {
  static readonly STEPS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000];
  #attempt = 0;

  constructor(private readonly random: () => number = Math.random) {}

  get attempts() {
    return this.#attempt;
  }

  next(): number {
    const base = Backoff.STEPS[Math.min(this.#attempt, Backoff.STEPS.length - 1)] ?? 60_000;
    this.#attempt++;
    return Math.round(base * (0.85 + this.random() * 0.3));
  }

  reset() {
    this.#attempt = 0;
  }
}

/** Resolves after `ms`, or at once (with false) when `signal` aborts. */
export function pause(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(false);
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', stop);
      resolve(true);
    }, ms);
    const stop = () => {
      clearTimeout(timer);
      resolve(false);
    };
    signal.addEventListener('abort', stop, { once: true });
  });
}

/** Removes a key from any text before it's shown or logged (Telegram puts it in URLs). */
export function redact(text: string, ...secrets: (string | undefined)[]): string {
  let out = text;
  for (const secret of secrets) if (secret) out = out.replaceAll(secret, '•••');
  return out;
}

/** A small picture as a data: URL, or undefined if it's not a picture or too big. */
export function dataUrl(bytes: Buffer, mimeType = 'image/jpeg'): string | undefined {
  if (!bytes.length || bytes.length > 120_000 || !mimeType.startsWith('image/')) return undefined;
  return `data:${mimeType};base64,${bytes.toString('base64')}`;
}
