import type { ChannelBot } from '@conch/protocol';

import { botAvatar } from './assets';
import { fit, plain, toTelegramHtml } from './format';
import {
  Backoff,
  type ChannelAdapter,
  ChannelError,
  type ChannelEvents,
  type ChannelConnection,
  type ChannelFile,
  type ChannelMessage,
  type ChannelProfile,
  type ChannelUser,
  type SendOptions,
  type SentRef,
  dataUrl,
  pause,
  redact,
} from './types';

export const TELEGRAM_API = 'https://api.telegram.org';

/** Telegram counts 4096 characters after formatting; Markdown parts this long stay under it. */
const PART = 3800;
/** Drafts show the end of a long answer; tables can make this much text longer once padded. */
const DRAFT_PART = 2500;
/** How long one getUpdates waits for news before answering empty (seconds). */
const POLL_SECONDS = 30;
/** Conflicts in a row before saying another program has the bot (each is a 409). */
const CONFLICTS_BEFORE_TELLING = 3;
const FILE_LIMIT = 20 * 1024 * 1024;

interface TgUser {
  id: number;
  is_bot?: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

interface TgFile {
  file_id: string;
  file_size?: number;
  file_name?: string;
  mime_type?: string;
  width?: number;
}

interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: { id: number; type: string };
  text?: string;
  caption?: string;
  photo?: TgFile[];
  document?: TgFile;
  audio?: TgFile;
  voice?: TgFile;
  video?: TgFile;
}

interface TgUpdate {
  update_id: number;
  /** The person pressed Stop under a streaming draft (Bot API 10.3). */
  stopped_message_generation?: { chat: { id: number }; draft_id: number };
  message?: TgMessage;
  callback_query?: {
    id: string;
    from: TgUser;
    data?: string;
    message?: { message_id: number; chat: { id: number } };
  };
}

interface TgResponse<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
}

const person = (user: TgUser): ChannelUser => ({
  id: String(user.id),
  name: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || 'Someone',
  ...(user.username && { username: user.username }),
});

/**
 * Telegram, through the Bot API. Conch asks for news with long polling
 * (`getUpdates`), so it works from any computer without a public address.
 *
 * Healing: a webhook left by another tool is removed (it blocks polling);
 * another program polling the same bot is waited out and named; a refused
 * key stops and asks for a new one; anything else is retried with backoff.
 * Formatted text Telegram won't take is re-sent plain.
 */
export class TelegramAdapter implements ChannelAdapter {
  readonly kind = 'telegram' as const;

  constructor(
    private readonly token: string,
    private readonly base = TELEGRAM_API,
  ) {}

  async call<T>(
    method: string,
    params: Record<string, unknown> = {},
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<T> {
    // The key goes into the address, so it must be only a key.
    if (!/^\d{3,20}:[\w-]{20,80}$/.test(this.token))
      throw new ChannelError(
        'auth',
        'That doesn’t look like a Telegram bot key. It looks like 123456789:ABC… — copy it from BotFather’s message.',
        { field: 'token' },
      );
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 15_000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await fetch(`${this.base}/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params),
        signal,
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new ChannelError(
        'network',
        redact(`Couldn’t reach Telegram (${(error as Error).message}).`, this.token),
      );
    }
    const body = (await response.json().catch(() => undefined)) as TgResponse<T> | undefined;
    if (body?.ok) return body.result as T;
    const code = body?.error_code ?? response.status;
    const description = redact(body?.description ?? response.statusText, this.token);
    if (code === 401 || code === 404)
      throw new ChannelError(
        'auth',
        'Telegram doesn’t recognise this key. Copy it again from BotFather (it looks like 123456:ABC…).',
        { field: 'token' },
      );
    if (code === 409) throw new ChannelError('conflict', description);
    if (code === 429)
      throw new ChannelError('rate-limit', 'Telegram asked Conch to slow down.', {
        retryAfterMs: (body?.parameters?.retry_after ?? 3) * 1000,
      });
    if (code >= 500) throw new ChannelError('network', `Telegram had a problem (${code}).`);
    throw new ChannelError('refused', description);
  }

  async identify(signal?: AbortSignal): Promise<ChannelBot> {
    const me = await this.call<TgUser>('getMe', {}, { signal });
    if (!me.is_bot)
      throw new ChannelError('auth', 'That key isn’t a bot’s key.', { field: 'token' });
    return {
      id: String(me.id),
      name: me.first_name,
      ...(me.username && { username: me.username, chatUrl: `https://t.me/${me.username}` }),
      ...(await this.#avatar(me.id).catch(() => undefined)),
    };
  }

  /** The bot's profile picture, small, if it has one. */
  async #avatar(id: number): Promise<{ avatar: string } | undefined> {
    const photos = await this.call<{ photos: TgFile[][] }>(
      'getUserProfilePhotos',
      { user_id: id, limit: 1 },
      { timeoutMs: 5000 },
    );
    const smallest = photos.photos[0]?.[0];
    if (!smallest) return undefined;
    const { bytes } = await this.#fetchFile(smallest.file_id, 5000);
    const avatar = dataUrl(bytes, 'image/jpeg');
    return avatar ? { avatar } : undefined;
  }

  async prepare(profile: ChannelProfile): Promise<void> {
    const who = profile.owner ? `${profile.owner}’s` : 'your';
    await Promise.allSettled([
      this.call('setMyCommands', {
        commands: [
          { command: 'new', description: 'Start a fresh conversation' },
          { command: 'stop', description: 'Stop what I’m doing' },
          { command: 'help', description: 'What I can do here' },
        ],
      }),
      this.call('setMyShortDescription', {
        short_description: `${profile.assistant}, ${who} assistant on Conch. Private.`.slice(
          0,
          120,
        ),
      }),
      this.call('setMyDescription', {
        description:
          `I’m ${profile.assistant}, ${who} assistant. I run on ${profile.owner ? `${profile.owner}’s` : 'your'} ` +
          'computer through Conch and can do everything there: files, the web, your apps. ' +
          'I’m private: only people who were let in can talk to me.',
      }),
      this.#pictureIfNone(),
    ]);
  }

  /** A bot without a picture gets Conch's pearl (Bot API 9.4); one you chose is left alone. */
  async #pictureIfNone() {
    const me = await this.call<TgUser>('getMe');
    const photos = await this.call<{ total_count: number }>('getUserProfilePhotos', {
      user_id: me.id,
      limit: 1,
    });
    if (photos.total_count > 0) return;
    const form = new FormData();
    form.set('photo', JSON.stringify({ type: 'static', photo: 'attach://avatar' }));
    form.set(
      'avatar',
      new Blob([new Uint8Array(await botAvatar())], { type: 'image/jpeg' }),
      'avatar.jpg',
    );
    const response = await fetch(`${this.base}/bot${this.token}/setMyProfilePhoto`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await response.json().catch(() => undefined)) as TgResponse<boolean> | undefined;
    if (!body?.ok) throw new ChannelError('refused', 'Telegram didn’t take the picture.');
  }

  connect(events: ChannelEvents): ChannelConnection {
    const stop = new AbortController();
    void this.#poll(events, stop.signal);
    // Drafts stream the answer as it's written (Bot API 9.5+). If this Telegram
    // refuses them, typing… is used instead for the rest of the connection.
    let drafts = true;
    return {
      send: (chatId, markdown, options) => this.#send(chatId, markdown, options),
      draft: async (chatId, draftId, markdown) => {
        if (!drafts) return false;
        try {
          await this.#formatted('sendMessageDraft', tail(markdown, DRAFT_PART), {
            chat_id: chatId,
            draft_id: draftId,
            can_stop: true,
          });
          return true;
        } catch (error) {
          // An older Telegram without drafts answers "not found": stop trying. Anything else
          // (a preview that was too long, a blip) only skips this one.
          if (
            error instanceof ChannelError &&
            (error.code === 'auth' || /method/i.test(error.message))
          )
            drafts = false;
          return false;
        }
      },
      edit: (ref, markdown, options) => this.#edit(ref, markdown, options),
      typing: async (chatId) => {
        await this.call('sendChatAction', { chat_id: chatId, action: 'typing' });
      },
      download: (file) => this.#download(file),
      // A private chat's id is the person's id.
      directChat: (userId) => Promise.resolve(userId),
      close: () => stop.abort(),
    };
  }

  async #poll(events: ChannelEvents, signal: AbortSignal) {
    const backoff = new Backoff();
    let offset: number | undefined;
    let conflicts = 0;
    let online = false;
    events.state('connecting');
    while (!signal.aborted) {
      try {
        const updates = await this.call<TgUpdate[]>(
          'getUpdates',
          {
            timeout: POLL_SECONDS,
            allowed_updates: ['message', 'callback_query', 'stopped_message_generation'],
            ...(offset !== undefined && { offset }),
          },
          { signal, timeoutMs: (POLL_SECONDS + 15) * 1000 },
        );
        if (!online) {
          online = true;
          events.state('online');
        }
        backoff.reset();
        conflicts = 0;
        for (const update of updates) {
          offset = update.update_id + 1;
          this.#dispatch(update, events);
        }
      } catch (error) {
        if (signal.aborted) return;
        online = false;
        const failure =
          error instanceof ChannelError ? error : new ChannelError('network', String(error));
        if (failure.code === 'auth') {
          events.state('needs-token', {
            message:
              'Telegram stopped accepting this bot’s key. It was probably reset in BotFather.',
          });
          return;
        }
        if (failure.code === 'conflict') {
          if (/webhook/i.test(failure.message)) {
            // Another tool told Telegram to deliver this bot's messages to a web address.
            const removed = await this.call('deleteWebhook', { drop_pending_updates: false }).then(
              () => true,
              () => false,
            );
            if (removed) {
              events.healed(
                'Telegram was sending your bot’s messages to another program, so Conch took them back.',
              );
              continue;
            }
          } else if (++conflicts >= CONFLICTS_BEFORE_TELLING) {
            const retryAt = Date.now() + 60_000;
            events.state('conflict', {
              message:
                'Another program is reading this bot’s messages (another Conch, or an app like OpenClaw). Stop it, or connect a new bot.',
              retryAt,
            });
            await pause(60_000, signal);
            continue;
          }
        }
        const wait = failure.detail?.retryAfterMs ?? backoff.next();
        events.state('reconnecting', { message: failure.message, retryAt: Date.now() + wait });
        await pause(wait, signal);
      }
    }
  }

  #dispatch(update: TgUpdate, events: ChannelEvents) {
    if (update.stopped_message_generation) {
      events.stop?.(String(update.stopped_message_generation.chat.id));
      return;
    }
    const query = update.callback_query;
    if (query?.data && query.message) {
      events.press({
        chatId: String(query.message.chat.id),
        user: person(query.from),
        data: query.data,
        message: {
          chatId: String(query.message.chat.id),
          messageId: String(query.message.message_id),
        },
        ack: async (note) => {
          await this.call('answerCallbackQuery', {
            callback_query_id: query.id,
            ...(note && { text: note.slice(0, 200) }),
          }).catch(() => undefined);
        },
      });
      return;
    }
    const message = update.message;
    if (!message?.from || message.from.is_bot) return;
    events.message(this.#message(message, message.from));
  }

  #message(message: TgMessage, from: TgUser): ChannelMessage {
    const files: ChannelFile[] = [];
    // Photos come in several sizes; the largest is last.
    const photo = message.photo?.at(-1);
    if (photo)
      files.push({
        name: `photo-${message.message_id}.jpg`,
        mimeType: 'image/jpeg',
        size: photo.file_size,
        ref: photo.file_id,
      });
    for (const [file, fallback] of [
      [message.document, 'file'],
      [message.audio, 'audio'],
      [message.voice, 'voice.ogg'],
      [message.video, 'video.mp4'],
    ] as const) {
      if (file)
        files.push({
          name: file.file_name ?? fallback,
          mimeType: file.mime_type,
          size: file.file_size,
          ref: file.file_id,
        });
    }
    return {
      chatId: String(message.chat.id),
      messageId: String(message.message_id),
      user: person(from),
      text: message.text ?? message.caption ?? '',
      files,
      direct: message.chat.type === 'private',
    };
  }

  async #send(chatId: string, markdown: string, options?: SendOptions): Promise<SentRef[]> {
    const parts = fit(markdown, PART, (part) => plain(part).length);
    const sent: SentRef[] = [];
    for (const [index, part] of parts.entries()) {
      const last = index === parts.length - 1;
      const message = await this.#withRetry(() =>
        this.#formatted<{ message_id: number }>('sendMessage', part, {
          chat_id: chatId,
          link_preview_options: { is_disabled: true },
          ...(last && options?.buttons && { reply_markup: keyboard(options) }),
        }),
      );
      sent.push({ chatId, messageId: String(message.message_id) });
    }
    return sent;
  }

  async #edit(ref: SentRef, markdown: string, options?: SendOptions): Promise<void> {
    try {
      await this.#formatted(
        'editMessageText',
        fit(markdown, PART, (part) => plain(part).length)[0] ?? '…',
        {
          chat_id: ref.chatId,
          message_id: Number(ref.messageId),
          link_preview_options: { is_disabled: true },
          reply_markup: options?.buttons ? keyboard(options) : { inline_keyboard: [] },
        },
      );
    } catch (error) {
      // Pressing a button twice asks for the same text again: that's fine.
      if (error instanceof ChannelError && /not modified/i.test(error.message)) return;
      throw error;
    }
  }

  /** Send as HTML; if Telegram can't read the markup, send the words plain instead. */
  async #formatted<T>(method: string, markdown: string, params: Record<string, unknown>) {
    // An empty draft shows Telegram's own "Thinking…".
    if (!markdown) return this.call<T>(method, { ...params, text: '' });
    try {
      return await this.call<T>(method, {
        ...params,
        text: toTelegramHtml(markdown),
        parse_mode: 'HTML',
      });
    } catch (error) {
      if (!(error instanceof ChannelError) || error.code !== 'refused') throw error;
      if (!/parse|entit|tag/i.test(error.message)) throw error;
      return this.call<T>(method, { ...params, text: plain(markdown) || '…' });
    }
  }

  /** One retry after Telegram's own wait, for sends (a rate limit, a blip). */
  async #withRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (!(error instanceof ChannelError)) throw error;
      if (error.code !== 'rate-limit' && error.code !== 'network') throw error;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(error.detail?.retryAfterMs ?? 1500, 30_000)),
      );
      return fn();
    }
  }

  async #download(file: ChannelFile) {
    if (file.size && file.size > FILE_LIMIT)
      throw new ChannelError('refused', 'Telegram only lets bots download files up to 20 MB.');
    const { bytes } = await this.#fetchFile(file.ref, 60_000);
    return { name: file.name, bytes, mimeType: file.mimeType };
  }

  async #fetchFile(fileId: string, timeoutMs: number): Promise<{ bytes: Buffer }> {
    const info = await this.call<{ file_path?: string }>('getFile', { file_id: fileId });
    if (!info.file_path) throw new ChannelError('refused', 'Telegram didn’t hand over that file.');
    try {
      const response = await fetch(`${this.base}/file/bot${this.token}/${info.file_path}`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return { bytes: Buffer.from(await response.arrayBuffer()) };
    } catch (error) {
      throw new ChannelError(
        'network',
        redact(
          `Couldn’t download that file from Telegram (${(error as Error).message}).`,
          this.token,
        ),
      );
    }
  }
}

function keyboard(options: SendOptions) {
  return {
    inline_keyboard: [
      (options.buttons ?? []).map((button) => ({
        text: button.label,
        callback_data: button.data,
        ...(button.style && { style: button.style }),
      })),
    ],
  };
}

/** The newest part of a long answer, for a draft (the whole answer is sent at the end). */
function tail(markdown: string, max: number): string {
  if (markdown.length <= max) return markdown;
  const cut = markdown.slice(-max);
  const start = cut.indexOf('\n');
  return `…${start > 0 && start < 400 ? cut.slice(start) : cut}`;
}
