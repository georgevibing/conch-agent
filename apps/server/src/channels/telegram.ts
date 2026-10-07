import { nativeMenu } from './commands';
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
  type VoiceNote,
  capOf,
  dataUrl,
  readCapped,
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

interface TgEntity {
  type: string;
  offset: number;
  length: number;
  user?: TgUser;
}

interface TgMessage {
  forward_origin?: unknown;
  forward_date?: number;
  message_id: number;
  from?: TgUser;
  chat: { id: number; type: string; title?: string };
  text?: string;
  caption?: string;
  entities?: TgEntity[];
  caption_entities?: TgEntity[];
  /** The message this one replies to (groups: a reply to the bot counts as mentioning it). */
  reply_to_message?: TgMessage;
  /** The part of it that was quoted, when only a part was. */
  quote?: { text: string };
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
  /** The bot was added to a group, or removed (ADR 0075: the group shows on its page). */
  my_chat_member?: {
    chat: { id: number; type: string; title?: string };
    from: TgUser;
    new_chat_member: { status: string };
  };
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
  /** Mentions and replies in groups are told apart (ADR 0075). */
  readonly groups = true;
  /** Who the bot is, to know when a group mentions it. */
  #me?: TgUser;

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
      // Conch's commands in Telegram's own "/" menu, from the list the web app uses too (ADR 0098).
      this.call('setMyCommands', {
        commands: nativeMenu().map(({ command, description }) => ({ command, description })),
      }),
      // In groups, only what works there: everyone else's words go nowhere else.
      this.call('setMyCommands', {
        commands: nativeMenu({ groups: true }).map(({ command, description }) => ({
          command,
          description,
        })),
        scope: { type: 'all_group_chats' },
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

  /** A voice note: Opus in Ogg, which Telegram shows with its waveform. */
  async #sendVoice(chatId: string, note: VoiceNote) {
    const form = new FormData();
    form.set('chat_id', chatId);
    form.set('duration', String(note.seconds));
    form.set('voice', new Blob([new Uint8Array(note.bytes)], { type: note.mimeType }), 'voice.ogg');
    let response: Response;
    try {
      response = await fetch(`${this.base}/bot${this.token}/sendVoice`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      throw new ChannelError(
        'network',
        redact(`Couldn’t reach Telegram (${(error as Error).message}).`, this.token),
      );
    }
    const body = (await response.json().catch(() => undefined)) as TgResponse<unknown> | undefined;
    if (!body?.ok)
      throw new ChannelError(
        response.status === 429 ? 'rate-limit' : 'refused',
        redact(body?.description ?? 'Telegram didn’t take the voice note.', this.token),
      );
  }

  connect(events: ChannelEvents): ChannelConnection {
    const stop = new AbortController();
    void this.#poll(events, stop.signal);
    // Drafts stream the answer as it's written (Bot API 9.5+). If this Telegram
    // refuses them, typing… is used instead for the rest of the connection.
    let drafts = true;
    return {
      // A list's buttons go one under the other: eight still fit on a phone without scrolling.
      buttonLimit: 8,
      send: (chatId, markdown, options) => this.#send(chatId, markdown, options),
      voiceNotes: { format: 'ogg', send: (chatId, note) => this.#sendVoice(chatId, note) },
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
      download: (file, options) => this.#download(file, options),
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
            allowed_updates: [
              'message',
              'callback_query',
              'stopped_message_generation',
              'my_chat_member',
            ],
            ...(offset !== undefined && { offset }),
          },
          { signal, timeoutMs: (POLL_SECONDS + 15) * 1000 },
        );
        // Who the bot is, once per connection, to know when a group mentions it.
        this.#me ??= await this.call<TgUser>('getMe', {}, { signal });
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
              events.healed('Took your Telegram bot’s messages back');
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
    // Added to a group: it shows on the channel's page (off) before anyone mentions it.
    const joined = update.my_chat_member;
    if (
      joined &&
      joined.chat.type !== 'private' &&
      ['member', 'administrator'].includes(joined.new_chat_member.status)
    ) {
      events.message({
        chatId: String(joined.chat.id),
        messageId: '0',
        user: person(joined.from),
        text: '',
        files: [],
        direct: false,
        mentioned: false,
        ...(joined.chat.title && { group: joined.chat.title }),
      });
      return;
    }
    const message = update.message;
    if (!message?.from || message.from.is_bot) return;
    events.message(this.#message(message, message.from));
  }

  /**
   * In a group, whether the bot is being asked: an @mention of it, a command
   * addressed to it (`/help@its_name`), or a reply to one of its messages. The
   * text is given back without the mention.
   */
  #addressed(message: TgMessage): { mentioned: boolean; text: string } {
    const text = message.text ?? message.caption ?? '';
    const me = this.#me;
    if (!me) return { mentioned: false, text };
    const handle = me.username ? `@${me.username}`.toLowerCase() : undefined;
    const entities = message.entities ?? message.caption_entities ?? [];
    const mentioned =
      message.reply_to_message?.from?.id === me.id ||
      entities.some((e) => {
        if (e.type === 'text_mention') return e.user?.id === me.id;
        const said = text.slice(e.offset, e.offset + e.length).toLowerCase();
        if (e.type === 'mention') return handle !== undefined && said === handle;
        if (e.type === 'bot_command') return handle !== undefined && said.endsWith(handle);
        return false;
      });
    if (!mentioned || !handle) return { mentioned, text };
    // "@its_name what's on?" reads as "what's on?": each mention of it is cut out, last first.
    let cleaned = text;
    for (const e of [...entities].sort((a, b) => b.offset - a.offset))
      if (
        e.type === 'mention' &&
        text.slice(e.offset, e.offset + e.length).toLowerCase() === handle
      )
        cleaned = cleaned.slice(0, e.offset) + cleaned.slice(e.offset + e.length);
    return {
      mentioned,
      text: cleaned
        .replace(/^[\s,:]+/, '')
        .replace(/ {2,}/g, ' ')
        .trim(),
    };
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
          ...(file === message.voice && { voice: true }),
        });
    }
    const direct = message.chat.type === 'private';
    if (direct)
      return {
        chatId: String(message.chat.id),
        messageId: String(message.message_id),
        user: person(from),
        text: message.text ?? message.caption ?? '',
        files,
        direct,
        ...((message.forward_origin || message.forward_date) && {
          outside: 'a forwarded Telegram message',
        }),
      };
    const { mentioned, text } = this.#addressed(message);
    // Replying to someone else's message: what they said comes along, as theirs.
    const replied = message.reply_to_message;
    const quoted = message.quote?.text ?? replied?.text ?? replied?.caption;
    return {
      chatId: String(message.chat.id),
      messageId: String(message.message_id),
      user: person(from),
      text,
      files,
      direct,
      mentioned,
      ...(message.chat.title && { group: message.chat.title }),
      ...(replied?.from &&
        replied.from.id !== this.#me?.id &&
        quoted && { quote: { name: person(replied.from).name, text: quoted } }),
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

  async #download(file: ChannelFile, options?: { maxBytes?: number }) {
    const cap = capOf(FILE_LIMIT, options);
    if (file.size && file.size > cap)
      throw new ChannelError('refused', 'That file is too big for Conch to take from Telegram.');
    const { bytes } = await this.#fetchFile(file.ref, 60_000, cap);
    return { name: file.name, bytes, mimeType: file.mimeType };
  }

  async #fetchFile(
    fileId: string,
    timeoutMs: number,
    maxBytes = FILE_LIMIT,
  ): Promise<{ bytes: Buffer }> {
    const info = await this.call<{ file_path?: string }>('getFile', { file_id: fileId });
    if (!info.file_path) throw new ChannelError('refused', 'Telegram didn’t hand over that file.');
    try {
      const response = await fetch(`${this.base}/file/bot${this.token}/${info.file_path}`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return { bytes: await readCapped(response, maxBytes) };
    } catch (error) {
      if (error instanceof ChannelError) throw error;
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
  const buttons = (options.buttons ?? []).map((button) => ({
    text: button.label,
    callback_data: button.data,
    ...(button.style && { style: button.style }),
  }));
  return {
    inline_keyboard: options.buttons?.some((b) => b.data.startsWith('s:'))
      ? buttons.map((button) => [button])
      : [buttons],
  };
}

/** The newest part of a long answer, for a draft (the whole answer is sent at the end). */
function tail(markdown: string, max: number): string {
  if (markdown.length <= max) return markdown;
  const cut = markdown.slice(-max);
  const start = cut.indexOf('\n');
  return `…${start > 0 && start < 400 ? cut.slice(start) : cut}`;
}
