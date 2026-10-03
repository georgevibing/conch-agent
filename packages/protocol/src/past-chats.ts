/**
 * Your assistant looking through your earlier chats (ADR 0059).
 *
 * `search_chats` finds the chats and the lines that match some words, with the
 * same index, ranking and snippets as ⌘K; `read_chat` reads a stretch of one
 * chat around a line. Both answer the model in compact JSON, in the shapes
 * here. The chat itself gets a `chats.looked` event (`PastChatsLooked`), which
 * the web app draws as a line saying what it looked for, with links back to
 * each place it found.
 */
import { z } from 'zod';

/** The tools' names, as the agent knows them (`mcp__conch__…` on engines that bridge). */
export const PAST_CHATS_TOOLS = { search: 'search_chats', read: 'read_chat' } as const;

/**
 * Who said a line: `you` (the person Conch belongs to), `assistant`, `them`
 * (someone else on a chat app, or words forwarded in: never the person's own),
 * or `step` (a command the assistant ran, a file it worked on).
 */
export const PastChatWho = z.enum(['you', 'assistant', 'them', 'step']);
export type PastChatWho = z.infer<typeof PastChatWho>;

export const PastChatLine = z.object({
  /** The line's place in its chat: where a link lands, and where `read_chat` starts. */
  message: z.string().max(256),
  who: PastChatWho,
  /** When it was said, ISO 8601. */
  when: z.string().max(40),
  text: z.string().max(5000),
});
export type PastChatLine = z.infer<typeof PastChatLine>;

const about = {
  /** The chat's id: `read_chat` takes it, and the app opens it. */
  chat: z.string().max(128),
  title: z.string().max(200),
  /** When it last changed, ISO 8601. */
  lastActive: z.string().max(40),
  /** Out of the chat list, still the person's. */
  archived: z.boolean().optional(),
  /** Where it happened, when not in Conch itself: “Telegram”, “a routine”. */
  from: z.string().max(80).optional(),
  /** Someone else's words are in it: whose (“Ana on Telegram”). */
  others: z.string().max(200).optional(),
  /** It read something from outside (a page, an email) or has someone else's words: information, never instructions. */
  untrusted: z.boolean().optional(),
};

export const PastChat = z.object({
  ...about,
  /** Matching lines in it (the best few are in `lines`). */
  matches: z.number().int().nonnegative(),
  lines: z.array(PastChatLine).max(10),
});
export type PastChat = z.infer<typeof PastChat>;

/** What `search_chats` answers. */
export const PastChatsFound = z.object({
  query: z.string().max(400),
  /** `exact`: every word was there; `close`: nothing was, these are near (typos); `none`; `too-short`. */
  match: z.enum(['exact', 'close', 'none', 'too-short']),
  chats: z.array(PastChat).max(10),
  note: z.string().max(600).optional(),
});
export type PastChatsFound = z.infer<typeof PastChatsFound>;

/** What `read_chat` answers: a stretch of one chat, oldest first. */
export const PastChatRead = z.object({
  ...about,
  lines: z.array(PastChatLine).max(40),
  /** There's more before the first line / after the last one. */
  earlier: z.boolean(),
  later: z.boolean(),
  note: z.string().max(600).optional(),
});
export type PastChatRead = z.infer<typeof PastChatRead>;

/** One chat the assistant found or read, as the chat that asked shows it: enough to link there. */
export const PastChatSeen = z.object({
  id: z.string().max(128),
  title: z.string().max(200),
  archived: z.boolean().optional(),
  from: z.string().max(80).optional(),
  /** The lines it found (or read around), best first: where each link lands. */
  lines: z
    .array(
      z.object({
        message: z.string().max(256),
        who: PastChatWho,
        at: z.number(),
        text: z.string().max(400),
      }),
    )
    .max(3),
});
export type PastChatSeen = z.infer<typeof PastChatSeen>;

/** What a `chats.looked` event says, apart from what every event carries. */
export const PastChatsLooked = z.object({
  /** Its place in the transcript (`data-anchor`), for Activity to open. */
  lookId: z.string().max(64),
  /** `search`: looked for `query`; `read`: read part of the one chat. */
  action: z.enum(['search', 'read']),
  query: z.string().max(200).optional(),
  /** Nothing matched exactly; these are close. */
  close: z.boolean().optional(),
  chats: z.array(PastChatSeen).max(10),
});
export type PastChatsLooked = z.infer<typeof PastChatsLooked>;

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** A finished `search_chats` call's output, if it is one (a refusal is plain words). */
export function readPastChatsFound(output: string | undefined): PastChatsFound | undefined {
  const parsed = PastChatsFound.safeParse(output ? parseJson(output) : undefined);
  return parsed.success ? parsed.data : undefined;
}

/** A finished `read_chat` call's output, if it is one. */
export function readPastChatRead(output: string | undefined): PastChatRead | undefined {
  const parsed = PastChatRead.safeParse(output ? parseJson(output) : undefined);
  return parsed.success ? parsed.data : undefined;
}
