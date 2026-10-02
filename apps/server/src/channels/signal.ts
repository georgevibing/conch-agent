import { readFile, stat } from 'node:fs/promises';

import type { ChannelBot } from '@conch/protocol';

import { safeJoin } from '../lib/fs';
import { fit } from './format';
import { CONCH_MARK, digitsOf, LinkError, Recent, STALE_MS, TextChoices } from './linked';
import type { ChannelLinker, LinkProgress } from './linked';
import { toSignal } from './linked-format';
import { type SignalDaemon, SignalRpcError, type SignalReceive } from './signal-cli';
import {
  type ChannelAdapter,
  type ChannelConnection,
  ChannelError,
  type ChannelEvents,
  type ChannelFile,
  type ChannelUser,
  type SendOptions,
  type SentRef,
} from './types';

export { CONCH_MARK } from './linked';

/** Signal shows up to 2,000 characters as a message; longer goes as a file, so parts stay under. */
const PART = 1900;
const FILE_LIMIT = 25 * 1024 * 1024;
/** How often to ask whether the account is still linked, while it's quiet. */
const CHECK_EVERY_MS = 10 * 60_000;

interface Attachment {
  id?: string;
  contentType?: string;
  filename?: string;
  size?: number;
  isVoiceNote?: boolean;
}

interface DataMessage {
  timestamp?: number;
  message?: string | null;
  attachments?: Attachment[];
  groupInfo?: { groupId?: string };
  quote?: { id?: number };
  reaction?: unknown;
  remoteDelete?: unknown;
  sticker?: unknown;
  destination?: string;
  destinationNumber?: string;
}

/** Errors that mean the phone (or Signal) took this device off the account. */
const UNLINKED =
  /authoriz|not registered|unregistered|deauthoriz|device.*(removed|unlinked)|\b(401|403)\b|User is not registered/i;

/** A uuid as Signal writes it, from Conch's id for a person (`u` and 32 hex digits). */
const uuidOf = (id: string) =>
  id
    .slice(1)
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5')
    .toLowerCase();

export function signalBot(account: string, name?: string): ChannelBot {
  return {
    id: digitsOf(account),
    name: name?.trim() || account,
    phone: account,
    chatUrl: `https://signal.me/#p/${account}`,
  };
}

/**
 * Signal, as a linked device of your own account (ADR 0043), through
 * signal-cli. You talk to your assistant in **Note to Self**; other chats
 * are never read unless the number is just for your assistant, and groups
 * are never answered.
 *
 * Healing: signal-cli is started again with backoff when it stops (and the
 * channel says reconnecting meanwhile); missing Java or signal-cli becomes
 * a need with an Install button; an account the phone unlinked stops this
 * channel only and asks to link again.
 */
export class SignalAdapter implements ChannelAdapter {
  readonly kind = 'signal' as const;

  constructor(
    private readonly account: string,
    private readonly daemon: SignalDaemon,
  ) {}

  async identify(signal?: AbortSignal): Promise<ChannelBot> {
    let accounts: { number?: string }[];
    try {
      accounts = await this.daemon.request<{ number?: string }[]>('listAccounts');
    } catch (error) {
      if (signal?.aborted) throw error;
      throw toChannelError(error);
    }
    if (!accounts.some((a) => a.number === this.account))
      throw new ChannelError(
        'auth',
        'Signal unlinked Conch. Link it again with the code on its page in Apps.',
      );
    const name = await this.#name().catch(() => undefined);
    return signalBot(this.account, name);
  }

  /** Your own profile name, as Signal has it. */
  async #name(): Promise<string | undefined> {
    const contacts = await this.daemon.request<
      { number?: string; profile?: { givenName?: string; familyName?: string } }[]
    >('listContacts', { account: this.account, recipient: [this.account] }, { timeoutMs: 5000 });
    const profile = contacts.find((c) => c.number === this.account)?.profile;
    return [profile?.givenName, profile?.familyName].filter(Boolean).join(' ') || undefined;
  }

  async forget(): Promise<void> {
    await this.daemon
      .request('deleteLocalAccountData', { account: this.account, ignoreRegistered: true })
      .catch(() => undefined);
  }

  connect(events: ChannelEvents): ChannelConnection {
    const account = this.account;
    const owner = digitsOf(account);
    const choices = new TextChoices();
    const sent = new Recent(1000);
    const seen = new Recent(1000);
    let closed = false;
    let online = false;

    const probe = async () => {
      if (closed) return;
      try {
        const accounts = await this.daemon.request<{ number?: string }[]>('listAccounts');
        if (closed) return;
        if (!accounts.some((a) => a.number === account)) {
          stop();
          events.state('needs-token', {
            message:
              'Signal unlinked Conch (from Linked devices on your phone). Link it again to carry on.',
          });
          return;
        }
        if (!online) {
          online = true;
          events.state('online');
        }
      } catch (error) {
        if (!closed) unavailable(error);
      }
    };

    const unavailable = (error: unknown) => {
      online = false;
      const state = this.daemon.state;
      const message = error instanceof Error ? error.message : 'signal-cli isn’t running.';
      if (state.state === 'down' && state.need)
        events.state('error', { message: state.message, need: state.need });
      else
        events.state('reconnecting', {
          message: state.state === 'down' ? state.message : message,
          ...(state.state === 'down' && state.retryAt && { retryAt: state.retryAt }),
        });
    };

    const receive = (received: SignalReceive) => {
      if (received.exception?.message && UNLINKED.test(received.exception.message)) {
        stop();
        events.state('needs-token', {
          message:
            'Signal unlinked Conch (from Linked devices on your phone). Link it again to carry on.',
        });
        return;
      }
      const envelope = received.envelope;
      if (!envelope) return;
      const source = str(envelope.sourceNumber) ?? str(envelope.source);
      const sourceUuid = str(envelope.sourceUuid);
      const sync = (envelope.syncMessage as { sentMessage?: DataMessage } | undefined)?.sentMessage;
      const data = envelope.dataMessage as DataMessage | undefined;
      let message: DataMessage | undefined;
      let user: ChannelUser;
      let chatId: string;
      if (sync) {
        // Written on one of your own devices: only Note to Self is for your assistant.
        const to = sync.destinationNumber ?? sync.destination;
        if (to !== account || sync.groupInfo) return;
        message = sync;
        user = { id: owner, name: str(envelope.sourceName) || 'You' };
        chatId = account;
      } else if (data && source !== account) {
        message = data;
        const id = source ? digitsOf(source) : sourceUuid ? `u${sourceUuid.replace(/-/g, '')}` : '';
        if (!id) return;
        user = { id, name: str(envelope.sourceName) || source || 'Someone' };
        chatId = source ?? sourceUuid ?? '';
      } else return;
      if (message.reaction || message.remoteDelete || message.sticker) return;
      const timestamp = Number(message.timestamp ?? envelope.timestamp ?? 0);
      if (!timestamp || sent.has(String(timestamp)) || !seen.add(`${chatId}:${timestamp}`)) return;
      if (Date.now() - timestamp > STALE_MS) return;
      const files: ChannelFile[] = (message.attachments ?? []).flatMap((a) =>
        a.id && /^[\w.-]{1,200}$/.test(a.id)
          ? [
              {
                name: a.filename || (a.isVoiceNote ? 'voice-note.m4a' : a.id),
                ref: a.id,
                ...(a.contentType && { mimeType: a.contentType }),
                ...(a.size !== undefined && { size: a.size }),
              },
            ]
          : [],
      );
      const text = message.message ?? '';
      if (sync && text.endsWith(CONCH_MARK)) return;
      if (!text.trim() && !files.length) return;
      const answer = choices.match(
        chatId,
        text,
        message.quote?.id ? String(message.quote.id) : undefined,
      );
      if (answer && !files.length) {
        events.press({
          chatId,
          user,
          data: answer.data,
          message: answer.ref,
          ack: async () => {
            await this.#react(chatId, chatId === account ? account : chatId, timestamp, '👍').catch(
              () => undefined,
            );
          },
        });
        return;
      }
      events.message({
        chatId,
        messageId: String(timestamp),
        user,
        text,
        files,
        direct: !message.groupInfo,
      });
    };

    const off = this.daemon.onReceive(account, receive);
    const offState = this.daemon.onState((state) => {
      if (closed) return;
      if (state.state === 'running') void probe();
      else if (state.state === 'down') unavailable(new Error(state.message));
    });
    const timer = setInterval(() => void probe(), CHECK_EVERY_MS);
    timer.unref?.();
    const stop = () => {
      closed = true;
      off();
      offState();
      clearInterval(timer);
    };
    events.state('connecting');
    void this.daemon.ensure().then(probe, unavailable);

    const target = (chatId: string) =>
      chatId === account ? { noteToSelf: true } : { recipient: [chatId] };

    const send = async (chatId: string, markdown: string, options?: SendOptions) => {
      const parts = fit(markdown, PART, (part) => toSignal(part).text.length);
      const refs: SentRef[] = [];
      for (const [index, part] of parts.entries()) {
        const buttons = index === parts.length - 1 ? options?.buttons : undefined;
        const { text, styles } = toSignal(
          buttons?.length ? TextChoices.render(part, buttons) : part,
        );
        const result = await this.#call<{ timestamp?: number }>('send', {
          account,
          ...target(chatId),
          message: `${text}${CONCH_MARK}`,
          ...(styles.length && { textStyle: styles }),
        });
        const id = String(result.timestamp ?? Date.now());
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
        const first = fit(markdown, PART, (part) => toSignal(part).text.length)[0] ?? '…';
        const { text, styles } = toSignal(
          options?.buttons?.length ? TextChoices.render(first, options.buttons) : first,
        );
        const result = await this.#call<{ timestamp?: number }>('send', {
          account,
          ...target(ref.chatId),
          message: `${text}${CONCH_MARK}`,
          editTimestamp: Number(ref.messageId),
          ...(styles.length && { textStyle: styles }),
        });
        if (result.timestamp) sent.add(String(result.timestamp));
        if (options?.buttons?.length) choices.remember(ref, options.buttons);
      },
      typing: async (chatId) => {
        if (chatId !== account) await this.#call('sendTyping', { account, recipient: [chatId] });
      },
      seen: async (ref, working) => {
        if (working && ref.chatId !== account)
          await this.#call('sendReceipt', {
            account,
            recipient: ref.chatId,
            targetTimestamp: [Number(ref.messageId)],
            type: 'read',
          }).catch(() => undefined);
        await this.#react(ref.chatId, ref.chatId, Number(ref.messageId), '👀', !working);
      },
      download: async (file) => this.#download(file),
      directChat: (userId) =>
        Promise.resolve(
          userId === owner ? account : userId.startsWith('u') ? uuidOf(userId) : `+${userId}`,
        ),
      close: stop,
    };
  }

  async #react(chatId: string, author: string, timestamp: number, emoji: string, remove = false) {
    await this.#call('sendReaction', {
      account: this.account,
      ...(chatId === this.account ? { noteToSelf: true } : { recipient: [chatId] }),
      emoji,
      targetAuthor: author,
      targetTimestamp: timestamp,
      ...(remove && { remove: true }),
    });
  }

  async #call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    try {
      return await this.daemon.request<T>(method, params);
    } catch (error) {
      throw toChannelError(error);
    }
  }

  async #download(file: ChannelFile) {
    if (file.size && file.size > FILE_LIMIT)
      throw new ChannelError('refused', 'That’s bigger than the 25 MB Conch takes from Signal.');
    // Only the attachments folder, and only a plain file name in it.
    const path = safeJoin(this.daemon.attachments, file.ref);
    const info = await stat(path).catch(() => undefined);
    if (!info?.isFile())
      throw new ChannelError('refused', 'Signal didn’t keep that file. Send it again.');
    if (info.size > FILE_LIMIT)
      throw new ChannelError('refused', 'That’s bigger than the 25 MB Conch takes from Signal.');
    return {
      name: file.name,
      bytes: await readFile(path),
      ...(file.mimeType && { mimeType: file.mimeType }),
    };
  }
}

const str = (value: unknown) => (typeof value === 'string' && value ? value : undefined);

/** signal-cli's failures, as the channel acts on them. */
function toChannelError(error: unknown): ChannelError {
  if (error instanceof ChannelError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (UNLINKED.test(message))
    return new ChannelError(
      'auth',
      'Signal unlinked Conch. Link it again with the code on its page in Apps.',
    );
  if (/rate ?limit|429/i.test(message))
    return new ChannelError('rate-limit', 'Signal asked Conch to slow down.', {
      retryAfterMs: 30_000,
    });
  if (error instanceof SignalRpcError && error.code <= -32000)
    return new ChannelError('network', message);
  return new ChannelError('refused', `Signal said no: ${message.slice(0, 200)}`);
}

/** How many codes Signal shows before giving up (each lasts two minutes). */
const ROUNDS = 3;

/**
 * Linking Signal: signal-cli asks Signal for a link (`startLink`, an
 * `sgnl://linkdevice` address shown as a QR code), then waits for the phone
 * (`finishLink`, about two minutes). A code nobody scanned is replaced.
 */
export class SignalLinker implements ChannelLinker {
  readonly kind = 'signal' as const;

  constructor(private readonly daemon: SignalDaemon) {}

  async link(progress: LinkProgress, signal: AbortSignal) {
    try {
      await this.daemon.ensure();
    } catch (error) {
      const state = this.daemon.state;
      if (state.state === 'down' && state.need)
        throw new LinkError('install', state.message, state.need);
      throw new LinkError('failed', error instanceof Error ? error.message : String(error));
    }
    for (let round = 0; round < ROUNDS; round++) {
      if (signal.aborted) throw new LinkError('failed', 'Stopped.');
      const { deviceLinkUri } = await this.daemon
        .request<{ deviceLinkUri: string }>('startLink')
        .catch((error: unknown) => {
          throw new LinkError(
            'failed',
            `Couldn’t get a code from Signal (${error instanceof Error ? error.message : String(error)}). Check the internet connection, then try again.`,
          );
        });
      if (!/^sgnl:\/\/linkdevice\?/.test(deviceLinkUri))
        throw new LinkError('failed', 'Signal sent a code Conch doesn’t recognise. Try again.');
      progress.code(deviceLinkUri, Date.now() + 115_000);
      try {
        const done = await Promise.race([
          this.daemon.request<{ number?: string }>(
            'finishLink',
            { deviceLinkUri, deviceName: 'Conch' },
            { timeoutMs: 150_000 },
          ),
          new Promise<never>((_, reject) =>
            signal.addEventListener('abort', () => reject(new LinkError('failed', 'Stopped.')), {
              once: true,
            }),
          ),
        ]);
        const account = done.number;
        if (!account || !/^\+\d{6,15}$/.test(account))
          throw new LinkError('failed', 'Signal linked, but didn’t say which number. Try again.');
        progress.scanned();
        const name = await new SignalAdapter(account, this.daemon)
          .identify()
          .then((bot) => (bot.name === account ? undefined : bot.name))
          .catch(() => undefined);
        return { secrets: { kind: 'signal' as const, account }, bot: signalBot(account, name) };
      } catch (error) {
        if (error instanceof LinkError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        // Nobody scanned this one: the next round shows a new code.
        if (/timed out|timeout|took too long/i.test(message)) continue;
        throw new LinkError('failed', `Signal didn’t finish linking: ${message.slice(0, 200)}`);
      }
    }
    throw new LinkError('expired', 'Nobody scanned the code in time.');
  }
}
