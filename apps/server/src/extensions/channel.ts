/**
 * A chat app a Conch app brings (ADR 0119), as one of Conch's channels: the
 * `ChannelAdapter` every built-in implements, answered by the app's own
 * `channel` functions in its sealed runtime. It plugs into `ChannelService`
 * unchanged, so the owner's hello, **Let in** and **Block**, groups off by
 * default, approvals (as buttons, or numbered replies), routine results,
 * `message_user` and the share bar's Send all work as they do for Telegram.
 *
 * What the sealed code may do is deliberately little: say who the bot is,
 * hand over the messages it was given (`poll` from this computer, or
 * `receive` from the public door), and send what Conch gives it. It can't
 * read a chat, call a tool or see any key but the ones typed for it, which
 * it gets per call (`app.keys`). Everything it hands back is checked here
 * first, and whatever it says is someone else's words: the service treats
 * every sender as a stranger until the owner's hello or a person's **Let in**.
 *
 * Conch owns the loop: it polls again and again, waits longer while it's
 * quiet, backs off when the app's servers fail, and stops at a refused key
 * (`needs-token`), so the code never needs a timer or a socket of its own.
 */
import type { AppChannelPart, ChannelBot, ChannelSecrets } from '@conch/protocol';
import { z } from 'zod';

import type { ChannelDoorService, HookRequest } from '../channels/door';
import { TextChoices } from '../channels/linked';
import {
  Backoff,
  ChannelError,
  pause,
  personId,
  type ChannelAdapter,
  type ChannelConnection,
  type ChannelEvents,
  type ChannelMessage,
  type ConnectOptions,
  type SentRef,
} from '../channels/types';
import type { AppCallOutcome, AppRuntime } from '../conchapps/types';
import type { PartName } from '../conchapps/runtime';

type AppSecrets = Extract<ChannelSecrets, { kind: 'app' }>;

/** One message the sealed code hands over, checked: anything else is dropped. */
const InMessage = z.object({
  chatId: z.union([z.string(), z.number()]).transform(String).pipe(z.string().min(1).max(300)),
  messageId: z
    .union([z.string(), z.number()])
    .transform(String)
    .pipe(z.string().min(1).max(300))
    .optional(),
  user: z.object({
    id: z.union([z.string(), z.number()]).transform(String).pipe(z.string().min(1).max(200)),
    name: z.string().trim().min(1).max(200),
    username: z.string().trim().max(100).optional(),
  }),
  text: z.string().max(20_000).default(''),
  direct: z.boolean().default(true),
  mentioned: z.boolean().optional(),
  group: z.string().trim().max(200).optional(),
});

const Messages = z.object({
  messages: z.array(z.unknown()).max(200).default([]),
  cursor: z.string().max(200).optional(),
  /** Its own reply to a delivery (`receive`): what the app's servers expect back. */
  reply: z
    .object({
      status: z.number().int().min(200).max(599).default(200),
      body: z.string().max(64_000).optional(),
      type: z.string().max(100).optional(),
    })
    .optional(),
});

const Bot = z.object({
  id: z.union([z.string(), z.number()]).transform(String).pipe(z.string().min(1).max(64)),
  name: z.string().trim().min(1).max(200),
  username: z.string().trim().max(100).optional(),
  chatUrl: z
    .string()
    .max(2000)
    .regex(/^https:\/\//)
    .optional(),
});

const Sent = z
  .object({
    messageId: z.union([z.string(), z.number()]).transform(String).pipe(z.string().max(300)),
  })
  .partial()
  .passthrough();

/** A message's length the sealed `send` is handed at most, in characters; longer ones go in parts. */
const PART_CHARS = 8000;
/** While it's quiet, the wait between polls grows to this. */
const QUIET_MS = 5_000;

/** What a sealed function's failure means for the connection. */
export function channelError(said: string): ChannelError {
  const words = said.toLowerCase();
  if (
    /\b(401|403)\b|unauthori[sz]ed|invalid (api )?(key|token)|refused (the|your) (key|token)|forbidden|revoked/.test(
      words,
    )
  )
    return new ChannelError('auth', said.slice(0, 300));
  if (/\b429\b|rate.?limit|too many requests/.test(words))
    return new ChannelError('rate-limit', said.slice(0, 300));
  if (
    /couldn’t reach|could not reach|network|took too long|timed? ?out|stopped answering|\b5\d\d\b/.test(
      words,
    )
  )
    return new ChannelError('network', said.slice(0, 300));
  return new ChannelError('refused', said.slice(0, 300));
}

/** Markdown cut where a person would, for a sealed `send` that takes so much at once. */
function partsOf(markdown: string): string[] {
  const out: string[] = [];
  let rest = markdown;
  while (rest.length > PART_CHARS) {
    const at = Math.max(rest.lastIndexOf('\n\n', PART_CHARS), rest.lastIndexOf('\n', PART_CHARS));
    const cut = at > PART_CHARS / 2 ? at : PART_CHARS;
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest || !out.length) out.push(rest);
  return out;
}

export interface AppChannelDeps {
  /** What the chat app is called ("Zulip"). */
  name: string;
  part: AppChannelPart;
  /** The app's sealed runtime, started when first needed. */
  runtime: () => Promise<AppRuntime>;
  /** The public door, for a chat app that delivers to a web address. */
  door?: ChannelDoorService;
  /** Tests: no real waiting. */
  random?: () => number;
}

export class AppChannelAdapter implements ChannelAdapter {
  readonly kind = 'app' as const;
  readonly groups = false;

  constructor(
    private readonly secrets: AppSecrets,
    private readonly deps: AppChannelDeps,
  ) {}

  /** One of its functions, with the fields typed for it. */
  async #call(
    part: PartName,
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<AppCallOutcome> {
    const runtime = await this.deps.runtime();
    if (!runtime.callPart) throw new ChannelError('refused', `${this.deps.name} can’t run here.`);
    return runtime.callPart(part, input, {
      keys: { ...this.secrets.fields },
      ...(signal && { signal }),
    });
  }

  async identify(signal?: AbortSignal): Promise<ChannelBot> {
    const outcome = await this.#call('channel.identify', {}, signal);
    if (!outcome.ok) throw channelError(outcome.text);
    const bot = Bot.safeParse(outcome.json);
    if (!bot.success)
      throw new ChannelError(
        'refused',
        `${this.deps.name} said who the bot is in a shape Conch can’t read: identify() returns { id, name }.`,
      );
    return {
      id: bot.data.id,
      name: bot.data.name,
      ...(bot.data.username && { username: bot.data.username }),
      ...(bot.data.chatUrl && { chatUrl: bot.data.chatUrl }),
    };
  }

  hook() {
    if (this.deps.part.receives !== 'webhook') return undefined;
    const url = this.deps.door?.hookUrl(this.secrets.hookId ?? '');
    return url ? { url } : {};
  }

  connect(events: ChannelEvents, options: ConnectOptions = {}): ChannelConnection {
    const stop = new AbortController();
    const choices = new TextChoices();
    let cursor = options.cursor;

    /** What the sealed code handed over, as messages (or presses of a numbered answer). */
    const take = (raw: readonly unknown[]) => {
      for (const item of raw) {
        const read = InMessage.safeParse(item);
        if (!read.success) continue;
        const m = read.data;
        let userId: string;
        try {
          userId = personId(m.user.id);
        } catch {
          continue;
        }
        const user = {
          id: userId,
          name: m.user.name,
          ...(m.user.username && { username: m.user.username }),
        };
        const answer = this.deps.part.buttons ? undefined : choices.match(m.chatId, m.text);
        if (answer) {
          events.press({
            chatId: m.chatId,
            user,
            data: answer.data,
            message: answer.ref,
            ack: () => Promise.resolve(),
          });
          continue;
        }
        const message: ChannelMessage = {
          chatId: m.chatId,
          messageId: m.messageId ?? `${m.chatId}:${Date.now()}`,
          user,
          text: m.text,
          files: [],
          direct: m.direct,
          ...(m.mentioned !== undefined && { mentioned: m.mentioned }),
          ...(m.group && { group: m.group }),
        };
        if (message.text.trim()) events.message(message);
      }
    };

    const loop = async () => {
      const backoff = new Backoff(this.deps.random);
      let quiet = 0;
      events.state('connecting');
      while (!stop.signal.aborted) {
        const started = Date.now();
        let outcome: AppCallOutcome;
        try {
          outcome = await this.#call('channel.poll', { cursor: cursor ?? null }, stop.signal);
        } catch (error) {
          outcome = { ok: false, text: error instanceof Error ? error.message : String(error) };
        }
        if (stop.signal.aborted) return;
        if (!outcome.ok) {
          const failure = channelError(outcome.text);
          if (failure.code === 'auth') {
            events.state('needs-token', {
              message: `${this.deps.name} stopped accepting what you typed for it. Paste it again on its page.`,
            });
            return;
          }
          const wait = backoff.next();
          events.state('reconnecting', {
            message: `${this.deps.name}: ${failure.message}`.slice(0, 300),
            retryAt: Date.now() + wait,
          });
          if (!(await pause(wait, stop.signal))) return;
          continue;
        }
        const read = Messages.safeParse(outcome.json ?? {});
        if (!read.success) {
          const wait = backoff.next();
          events.state('error', {
            message: `${this.deps.name}’s poll() returned something Conch can’t read: { messages: […], cursor }.`,
            retryAt: Date.now() + wait,
          });
          if (!(await pause(wait, stop.signal))) return;
          continue;
        }
        if (backoff.attempts) events.healed(`Reconnected ${this.deps.name}`);
        backoff.reset();
        events.state('online');
        if (read.data.cursor && read.data.cursor !== cursor) {
          cursor = read.data.cursor;
          events.cursor?.(cursor);
        }
        take(read.data.messages);
        // Busy: straight back. Quiet: a little longer each time, unless it waited itself (a long poll).
        quiet = read.data.messages.length ? 0 : Math.min(quiet + 1_000, QUIET_MS);
        const waited = Date.now() - started;
        if (quiet && waited < QUIET_MS && !(await pause(quiet, stop.signal))) return;
      }
    };

    let unmount: (() => void) | undefined;
    if (this.deps.part.receives === 'webhook') {
      const door = this.deps.door;
      if (!door || !this.secrets.hookId) {
        events.state('error', {
          message: 'Turn on Conch’s public address first (Apps → Talk to me here).',
        });
      } else {
        unmount = door.mount(this.secrets.hookId, 'app', async (request: HookRequest) => {
          const outcome = await this.#call('channel.receive', {
            method: request.method,
            headers: request.headers,
            query: request.query,
            body: request.body,
          }).catch((error: unknown): AppCallOutcome => ({
            ok: false,
            text: error instanceof Error ? error.message : String(error),
          }));
          if (!outcome.ok) return { status: 400, body: 'Refused.' };
          const read = Messages.safeParse(outcome.json ?? {});
          if (!read.success) return { status: 500, body: 'Conch couldn’t read that.' };
          events.heard?.();
          take(read.data.messages);
          const reply = read.data.reply;
          return {
            status: reply?.status ?? 200,
            ...(reply?.body !== undefined && { body: reply.body }),
            ...(reply?.type && { type: reply.type }),
          };
        });
        events.state('online');
      }
    } else void loop();

    const send = async (
      chatId: string,
      markdown: string,
      sendOptions?: { buttons?: { label: string; data: string; style?: 'primary' | 'danger' }[] },
    ): Promise<SentRef[]> => {
      const buttons = sendOptions?.buttons ?? [];
      const native = this.deps.part.buttons && buttons.length > 0;
      const body = buttons.length && !native ? TextChoices.render(markdown, buttons) : markdown;
      const refs: SentRef[] = [];
      const pieces = partsOf(body);
      for (const [index, text] of pieces.entries()) {
        const last = index === pieces.length - 1;
        const outcome = await this.#call('channel.send', {
          chatId,
          text,
          ...(native &&
            last && {
              buttons: buttons.map(({ label, data, style }) => ({
                label,
                data,
                ...(style && { style }),
              })),
            }),
        });
        if (!outcome.ok) throw channelError(outcome.text);
        const sent = Sent.safeParse(outcome.json ?? {});
        refs.push({
          chatId,
          messageId: (sent.success && sent.data.messageId) || `${chatId}:${Date.now()}:${index}`,
        });
      }
      const ref = refs.at(-1);
      if (ref && buttons.length && !native) choices.remember(ref, buttons);
      return refs;
    };

    return {
      send,
      // A message that's gone out stays as it was; a question's numbered answers just stop working.
      edit: async (ref) => {
        choices.forget(ref);
      },
      typing: () => Promise.resolve(),
      download: () =>
        Promise.reject(
          new ChannelError('refused', `${this.deps.name} doesn’t bring files to Conch.`),
        ),
      directChat: async (userId) => {
        const runtime = await this.deps.runtime();
        const parts = (await runtime.parts?.().catch(() => [])) ?? [];
        if (!parts.includes('channel.directChat')) return userId;
        const outcome = await this.#call('channel.directChat', { userId });
        if (!outcome.ok) throw channelError(outcome.text);
        const chat = z
          .union([z.string(), z.number(), z.object({ chatId: z.union([z.string(), z.number()]) })])
          .safeParse(outcome.json ?? outcome.text);
        if (!chat.success) return userId;
        return String(typeof chat.data === 'object' ? chat.data.chatId : chat.data).slice(0, 300);
      },
      close: () => {
        stop.abort();
        unmount?.();
      },
    };
  }
}
