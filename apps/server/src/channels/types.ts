import type {
  ChannelBot,
  ChannelField,
  ChannelHook,
  ChannelHookSecrets,
  ChannelKind,
  ChannelSecrets,
  ChannelState,
} from '@conch/protocol';

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
  /**
   * What's in it came from someone else, even when the owner sent it (a
   * forwarded email): it's read like a web page (ADR 0028), named like this.
   */
  outside?: string;
  /** It starts something new (an email in a new thread): a fresh conversation, as `/new` would. */
  fresh?: boolean;
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
  state(state: ChannelState, detail?: StateDetail): void;
  /** The person pressed the app's own Stop button (Telegram drafts). */
  stop?(chatId: string): void;
  /** A repair the connection made by itself, for "Fixed on its own". */
  healed(message: string): void;
  /** Discord: the bot joined a server (so people there can now message it). */
  joined?(): void;
  /** Teams, WeChat: the app delivered something to the channel's address that checked out. */
  heard?(): void;
  /** Something the page shows changed (the public address), though the state didn't. */
  changed?(): void;
  /**
   * How far it has read (iMessage's last row, email's last UID), kept with the
   * channel so a restart carries on from there instead of answering twice.
   */
  cursor?(value: string): void;
}

export interface StateDetail {
  message?: string;
  retryAt?: number;
  /** What has to be installed for it to work (a need id, ADR 0016): Signal needs signal-cli. */
  need?: string;
  /** A macOS switch only a person can turn on (iMessage). */
  access?: 'full-disk-access' | 'automation';
}

/** Where a connection picks up from. */
export interface ConnectOptions {
  /** The last `cursor` it reported, if any. */
  cursor?: string;
}

/** A live connection to one bot. It reconnects by itself until closed. */
export interface ChannelConnection {
  /** Send Markdown; long answers go as several messages. Returns each one sent. */
  send(chatId: string, markdown: string, options?: SendOptions): Promise<SentRef[]>;
  /** Replace a message's text (and buttons; none removes them). */
  edit(ref: SentRef, markdown: string, options?: SendOptions): Promise<void>;
  /** Show "typing…" for a few seconds. */
  typing(chatId: string): Promise<void>;
  /**
   * Stream an answer while it's written (Telegram drafts): an empty text shows
   * "Thinking…". Resolves false when the app won't, and typing… is used instead.
   */
  draft?(chatId: string, draftId: number, markdown: string): Promise<boolean>;
  /** Mark a message as seen and being worked on (Slack, which has no typing indicator for bots). */
  seen?(ref: SentRef, working: boolean): Promise<void>;
  download(file: ChannelFile): Promise<{ name: string; bytes: Buffer; mimeType?: string }>;
  /** The private chat with someone, opening it if needed (for messages Conch starts). */
  directChat(userId: string): Promise<string>;
  /** Disconnecting for good: take this computer off the account's linked devices (WhatsApp). */
  unlink?(): Promise<void>;
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
  connect(events: ChannelEvents, options?: ConnectOptions): ChannelConnection;
  /** Disconnecting for good: delete what it keeps on this computer besides the key (a linked device's keys). */
  forget?(): Promise<void>;
  /**
   * Who the owner already is, when the account is theirs (an email address's
   * own mail, iMessage to yourself): they're let in on connecting, with no hello.
   */
  owner?(): ChannelUser | undefined;
  /**
   * Turn what the person typed into what Conch keeps (Matrix: sign in with
   * the password once, and keep only the session's access token).
   */
  settle?(signal?: AbortSignal): Promise<ChannelSecrets>;
  /** Teams, WeChat: the address their servers deliver to (ADR 0045). */
  hook?(): ChannelHook | undefined;
  /** WeChat: what to paste in its server settings, with the token and key Conch made. */
  hookSecrets?(): ChannelHookSecrets | undefined;
}

/** Which box on the connect page was wrong (the protocol's list). */
export type { ChannelField };

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
    readonly detail?: { retryAfterMs?: number; field?: ChannelField },
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

/**
 * A person's id in the app as a Conch `Id` (letters, digits, `_` and `-`):
 * kept as it is when it already is one, otherwise written in base64url
 * behind an `X` (Matrix's `@ada:matrix.org`, a WeCom id with a dot). It
 * always reads back with `appId`.
 */
export function personId(raw: string): string {
  if (/^[A-WYZa-z0-9][A-Za-z0-9_-]{0,127}$/.test(raw)) return raw;
  const encoded = `X${Buffer.from(raw, 'utf8').toString('base64url')}`;
  if (encoded.length > 128) throw new ChannelError('refused', 'That account’s name is too long.');
  return encoded;
}

/** The app's own id for someone, from `personId`. */
export function appId(id: string): string {
  return id.startsWith('X') ? Buffer.from(id.slice(1), 'base64url').toString('utf8') : id;
}
