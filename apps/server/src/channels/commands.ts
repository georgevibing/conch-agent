/**
 * Conch's commands in chat apps (ADR 0098): the protocol's one list
 * (`CHAT_COMMANDS`), how each app writes them, what the app's own `/` menu
 * shows, the words of `/help`, and the few one-tap answers that aren't
 * settings (Undo after `/clear`, "did you mean"). The service does the rest.
 */
import { randomBytes } from 'node:crypto';

import {
  CHAT_COMMANDS,
  COMMANDS,
  type ChannelKind,
  type CommandDef,
  similarCommands,
  slashIn,
} from '@conch/protocol';

import type { ChannelButton } from './types';

/** How a command is typed in this app (`/conch model` in Slack): the protocol's, for the web too. */
export { slashIn };

/** What a command says it does in a chat app. */
export const chatWords = (command: CommandDef) => command.chat?.description ?? command.description;

/** What a menu with room for only a few keeps, most wanted first. */
const FIRST = [
  'new',
  'stop',
  'model',
  'clear',
  'plan',
  'goal',
  'effort',
  'retry',
  'status',
  'help',
];

/**
 * The app's own `/` menu (Telegram's `setMyCommands`, Discord's application
 * commands, Teams' command list): every listed command, in the list's order,
 * each name as the apps allow (`a-z`, digits, `_`) and its words cut to fit.
 */
export function nativeMenu(
  options: {
    /** At most this many (Teams lists ten). */
    max?: number;
    /** Each description at most this long (Discord: 100). */
    words?: number;
    /** Only the ones that work in a group. */
    groups?: boolean;
  } = {},
): { command: string; description: string; argumentHint?: string; takes?: boolean }[] {
  const max = options.words ?? 256;
  const listed = CHAT_COMMANDS.filter(
    (c) => !c.chat.hidden && /^[a-z0-9_]{1,32}$/.test(c.name) && (!options.groups || c.chat.groups),
  );
  // A short menu (Teams' ten) keeps the ones people reach for most.
  const rank = (name: string) => {
    const at = FIRST.indexOf(name);
    return at === -1 ? FIRST.length : at;
  };
  const kept =
    options.max !== undefined && listed.length > options.max
      ? new Set(
          [...listed]
            .sort((a, b) => rank(a.name) - rank(b.name))
            .slice(0, options.max)
            .map((c) => c.name),
        )
      : undefined;
  return listed
    .filter((c) => !kept || kept.has(c.name))
    .map((c) => {
      const words = chatWords(c);
      const hint = c.chat.argumentHint ?? c.argumentHint;
      return {
        command: c.name,
        description: words.length > max ? `${words.slice(0, max - 1).trimEnd()}…` : words,
        ...(hint && { argumentHint: hint }),
        ...(Boolean(c.values || hint) && { takes: true }),
      };
    });
}

/**
 * `/help` in a chat app: what the person can do, from the same list. The
 * owner sees everything; someone else let in sees what's theirs to use; in a
 * group, only what works there.
 */
export function helpWords(input: {
  assistant: string;
  kind: ChannelKind;
  who: 'owner' | 'people' | 'guest';
}): string {
  const usable = CHAT_COMMANDS.filter(
    (c) =>
      !c.chat.hidden &&
      (input.who === 'owner' || (input.who === 'people' ? c.chat.who === 'people' : c.chat.groups)),
  );
  const lines = usable.map((c) => {
    const hint = c.chat.argumentHint ?? c.argumentHint;
    return `• ${slashIn(input.kind, c.name)}${hint ? ` ${hint}` : ''} — ${chatWords(c)}`;
  });
  const intro =
    input.who === 'guest'
      ? `I’m **${input.assistant}**. Mention me with a question and I’ll answer here, in words.`
      : `I’m **${input.assistant}**, your assistant on Conch. Ask me anything, or send a photo or a file.`;
  const skills =
    input.who === 'guest'
      ? []
      : [`• ${slashIn(input.kind, 'your-skill')} — use one of your skills or commands by name`];
  const outro =
    input.who === 'guest' ? [] : ['', 'Everything we say here is also in Conch on your computer.'];
  return [intro, '', ...lines, ...skills, ...outro].join('\n');
}

/** Every name people may type, other names too, mapped to the one to suggest. */
function chatNames(who: 'owner' | 'people'): Map<string, string> {
  const names = new Map<string, string>();
  for (const c of CHAT_COMMANDS) {
    if (c.chat.hidden || (who === 'people' && c.chat.who === 'owner')) continue;
    names.set(c.name, c.name);
    for (const alias of c.aliases ?? []) names.set(alias, c.name);
  }
  return names;
}

/**
 * What to say to a `/name` nobody knows: the command, skill or prompt of yours
 * it probably meant (`/modle` → `/model`), or where to look.
 */
export function unknownWords(input: {
  typed: string;
  kind: ChannelKind;
  who: 'owner' | 'people';
  yours?: readonly string[];
}): { text: string; meant: string[] } {
  const names = chatNames(input.who);
  for (const name of input.yours ?? []) names.set(name.toLowerCase(), name.toLowerCase());
  const meant = similarCommands(input.typed, names);
  const help = slashIn(input.kind, 'help');
  if (!meant.length)
    return {
      text: `I don’t know ${slashIn(input.kind, input.typed)}. Send ${help} to see what I understand here.`,
      meant,
    };
  const list = meant.map((m) => slashIn(input.kind, m)).join(' or ');
  return {
    text: `I don’t know ${slashIn(input.kind, input.typed)}. Did you mean ${list}?`,
    meant,
  };
}

/** A command that only works in Conch itself (`/export`, `/folder`): where to find it. */
export function onlyInConch(kind: ChannelKind, command: CommandDef): string {
  return `${slashIn(kind, command.name)} works in Conch itself (${command.description.charAt(0).toLowerCase()}${command.description.slice(1)}). Open this chat there to use it.`;
}

/** Names Conch's own commands answer to in a chat app, besides the chat-only ones. */
export function isConchName(name: string): boolean {
  const q = name.toLowerCase();
  return COMMANDS.some((c) => c.name === q || c.aliases?.includes(q));
}

interface Offer {
  channelId: string;
  chatId: string;
  userId: string;
  expires: number;
  runs: (() => Promise<void>)[];
}

/** Single-use buttons that aren't settings, bound to the chat and the person they were offered to. */
export class ChatActions {
  #offers = new Map<string, Offer>();

  constructor(private readonly now = () => Date.now()) {}

  /** Buttons for these actions: `c:<token>:<n>`, well under Telegram's 64 bytes. */
  offer(
    bound: { channelId: string; chatId: string; userId: string },
    actions: { label: string; style?: ChannelButton['style']; run: () => Promise<void> }[],
  ): ChannelButton[] {
    for (const [key, offer] of this.#offers)
      if (offer.expires <= this.now()) this.#offers.delete(key);
    while (this.#offers.size >= 200) this.#offers.delete(this.#offers.keys().next().value ?? '');
    const id = randomBytes(9).toString('base64url');
    this.#offers.set(id, {
      ...bound,
      expires: this.now() + 10 * 60_000,
      runs: actions.map((a) => a.run),
    });
    return actions.map((a, i) => ({
      label: a.label,
      data: `c:${id}:${i}`,
      ...(a.style && { style: a.style }),
    }));
  }

  /**
   * The action a press means, claimed at once so it can't run twice, or why
   * not: someone else's, or gone (used, expired, Conch restarted).
   */
  take(
    data: string,
    by: { channelId: string; chatId: string; userId: string },
  ): (() => Promise<void>) | 'not-yours' | 'gone' {
    const match = /^c:([\w-]+):(\d)$/.exec(data);
    const offer = match?.[1] ? this.#offers.get(match[1]) : undefined;
    const run = offer?.runs[Number(match?.[2])];
    if (!match?.[1] || !offer || !run || offer.expires <= this.now()) return 'gone';
    if (
      offer.channelId !== by.channelId ||
      offer.chatId !== by.chatId ||
      offer.userId !== by.userId
    )
      return 'not-yours';
    this.#offers.delete(match[1]);
    return run;
  }

  /** Everything offered on a channel (or to one person there) stops working. */
  clear(channelId: string, userId?: string) {
    for (const [key, offer] of this.#offers)
      if (offer.channelId === channelId && (!userId || offer.userId === userId))
        this.#offers.delete(key);
  }
}
