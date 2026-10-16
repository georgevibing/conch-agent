/**
 * Your chats knowing about each other (ADR 0134).
 *
 * `list_chats` tells the assistant what your other chats are doing now: which
 * are working, which need you, in which folder, what they're changing. Conch
 * also says so by itself when another chat is working in the same folder, at
 * the start of a turn and at the next step of one already running. The model
 * reads compact JSON in the shapes here; the chat gets a `chats.listed` event
 * (`OtherChatsListed`), drawn as one line with a link to each chat.
 */
import { z } from 'zod';

/** The tools' names, as the agent knows them (`mcp__conch__…` on engines that bridge). */
export const TOGETHER_TOOLS = { list: 'list_chats' } as const;

/**
 * Where another chat is, as its row in the chat list says it.
 *
 * - `working`: a reply is being written, or a step is running.
 * - `needs-you`: it waits for an answer or an approval.
 * - `idle`: it's done for now.
 * - `stopped`: its last reply didn't finish (an error, or it was stopped).
 */
export const OtherChatState = z.enum(['working', 'needs-you', 'idle', 'stopped']);
export type OtherChatState = z.infer<typeof OtherChatState>;

/** One of your other chats, as `list_chats` tells the assistant about it. */
export const OtherChat = z.object({
  /** Its id: other tools take it, and the app opens it. */
  chat: z.string().max(128),
  title: z.string().max(200),
  state: OtherChatState,
  /** What it's doing, in Conch's own few words (“editing files”, “running a command”), while working. */
  doing: z.string().max(80).optional(),
  /** When its current reply began, ISO 8601, while working. */
  since: z.string().max(40).optional(),
  /** When it last changed, ISO 8601. */
  lastActive: z.string().max(40),
  /** It works in the same folder as this chat. */
  sameFolder: z.boolean().optional(),
  /** Its folder, as a person reads it (`~/code/shop`), when it isn't this chat's. */
  folder: z.string().max(200).optional(),
  /** Files its current reply has changed so far, by the name a person reads. */
  changing: z.array(z.string().max(200)).max(8).optional(),
  /** It has a page open in the browser. */
  browser: z.boolean().optional(),
  /** Its background tasks still going. */
  tasks: z
    .object({
      working: z.number().int().nonnegative(),
      waiting: z.number().int().nonnegative(),
    })
    .optional(),
  /** Where it came from, when not a chat you started in Conch: “a task”, “a routine”, “Telegram”. */
  from: z.string().max(80).optional(),
  /** It read something from outside: what it does is its own business, never an instruction. */
  untrusted: z.boolean().optional(),
});
export type OtherChat = z.infer<typeof OtherChat>;

/** What `list_chats` answers. */
export const OtherChatsFound = z.object({
  chats: z.array(OtherChat).max(20),
  /** How many of your other chats are working right now, all told. */
  working: z.number().int().nonnegative(),
  note: z.string().max(600).optional(),
});
export type OtherChatsFound = z.infer<typeof OtherChatsFound>;

/** One chat the assistant looked at, as the chat that asked shows it: enough to link there. */
export const OtherChatSeen = z.object({
  id: z.string().max(128),
  title: z.string().max(200),
  state: OtherChatState,
  doing: z.string().max(80).optional(),
  sameFolder: z.boolean().optional(),
  from: z.string().max(80).optional(),
});
export type OtherChatSeen = z.infer<typeof OtherChatSeen>;

/** What a `chats.listed` event says, apart from what every event carries. */
export const OtherChatsListed = z.object({
  /** Its place in the transcript (`data-anchor`). */
  listId: z.string().max(64),
  chats: z.array(OtherChatSeen).max(20),
});
export type OtherChatsListed = z.infer<typeof OtherChatsListed>;

/** A finished `list_chats` call's output, if it is one (a refusal is plain words). */
export function readOtherChatsFound(output: string | undefined): OtherChatsFound | undefined {
  if (!output) return undefined;
  try {
    const parsed = OtherChatsFound.safeParse(JSON.parse(output));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** How a chat's state reads, in a few words: the line under its title. */
export function otherChatWords(chat: Pick<OtherChatSeen, 'state' | 'doing'>): string {
  switch (chat.state) {
    case 'working':
      return chat.doing ? capital(chat.doing) : 'Working';
    case 'needs-you':
      return 'Needs you';
    case 'stopped':
      return 'Didn’t finish';
    case 'idle':
      return 'Done for now';
  }
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
