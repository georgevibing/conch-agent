/**
 * Your past chats from other apps (ADR 0111): the conversations you had with
 * Claude Code, Codex, Gemini CLI, OpenCode, Copilot, OpenClaw and Hermes,
 * found on this computer and brought into Conch as past chats you can read,
 * search (⌘K, `search_chats`, `read_chat`) and carry on. Nothing in the other
 * app changes; what's brought in is read-only, with secrets taken out.
 */
import { z } from 'zod';

/** The apps whose chats Conch can find and bring in. */
export const ChatSourceId = z.enum([
  'claude-code',
  'codex',
  'gemini-cli',
  'opencode',
  'copilot',
  'openclaw',
  'hermes',
]);
export type ChatSourceId = z.infer<typeof ChatSourceId>;

/** Each app's name, as people know it. */
export const CHAT_SOURCE_LABELS: Record<ChatSourceId, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  'gemini-cli': 'Gemini CLI',
  opencode: 'OpenCode',
  copilot: 'Copilot',
  openclaw: 'OpenClaw',
  hermes: 'Hermes',
};

/** A past chat's id: `pc_` and sixteen letters or digits, the same every time it's brought in. */
export const PastChatId = z.string().regex(/^pc_[a-f0-9]{16}$/, 'Not a past chat.');
export type PastChatId = z.infer<typeof PastChatId>;

/** Whether an id (a search hit's, a link's) is a past chat rather than one of Conch's own. */
export const isPastChatId = (id: string | undefined): id is PastChatId =>
  typeof id === 'string' && PastChatId.safeParse(id).success;

/** One project the chats were about: the folder's name, and how many. */
export const ChatProject = z.object({
  name: z.string().max(120),
  count: z.number().int().nonnegative(),
});
export type ChatProject = z.infer<typeof ChatProject>;

/** What Conch found from one app. */
export const ChatSourceFound = z.object({
  id: ChatSourceId,
  /** "Claude Code". */
  label: z.string().max(60),
  /** Conversations on this computer. */
  found: z.number().int().nonnegative(),
  /** Of those, how many aren't in Conch yet, or have grown since. */
  fresh: z.number().int().nonnegative(),
  /** The projects with the most chats, most first. */
  projects: z.array(ChatProject).max(12),
  /** The oldest and newest, when the files say. */
  from: z.number().optional(),
  to: z.number().optional(),
});
export type ChatSourceFound = z.infer<typeof ChatSourceFound>;

/** Where bringing them in is. */
export const ChatImportProgress = z.object({
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  /** The app it's reading now. */
  current: z.string().max(60).optional(),
});
export type ChatImportProgress = z.infer<typeof ChatImportProgress>;

/** What the last time brought. */
export const ChatImportRun = z.object({
  at: z.number(),
  /** New past chats. */
  added: z.number().int().nonnegative(),
  /** Ones that had grown, brought up to date. */
  updated: z.number().int().nonnegative(),
  /** Files that couldn't be read (damaged, or a shape Conch doesn't know yet). */
  skipped: z.number().int().nonnegative(),
  /** Secrets taken out on the way in. */
  redacted: z.number().int().nonnegative(),
});
export type ChatImportRun = z.infer<typeof ChatImportRun>;

/** `GET /api/import/chats`: what's on this computer, and what's in Conch already. */
export const ChatImportStatus = z.object({
  sources: z.array(ChatSourceFound),
  /** Past chats in Conch now. */
  brought: z.number().int().nonnegative(),
  /** Bringing them in now. */
  running: ChatImportProgress.optional(),
  last: ChatImportRun.optional(),
});
export type ChatImportStatus = z.infer<typeof ChatImportStatus>;

/** `POST /api/import/chats`: bring them in (only what's new); every app found when left out. */
export const RunChatImportBody = z
  .object({ sources: z.array(ChatSourceId).min(1).max(7).optional() })
  .strict();
export type RunChatImportBody = z.infer<typeof RunChatImportBody>;

/** A past chat, as a list and a search show it. */
export const PastChatSummary = z.object({
  id: PastChatId,
  source: ChatSourceId,
  title: z.string().max(200),
  /** The project's folder name, when the app kept it. */
  project: z.string().max(120).optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  /** Messages in it, yours and the assistant's. */
  messages: z.number().int().nonnegative(),
  /** The model that answered there, as it said. */
  model: z.string().max(120).optional(),
});
export type PastChatSummary = z.infer<typeof PastChatSummary>;

export const PastChatMessage = z.object({
  id: z.string().max(80),
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  at: z.number(),
});
export type PastChatMessage = z.infer<typeof PastChatMessage>;

/** `GET /api/past-chats/:id`: one past chat to read. */
export const PastChatDetail = z.object({
  chat: PastChatSummary,
  messages: z.array(PastChatMessage),
});
export type PastChatDetail = z.infer<typeof PastChatDetail>;

/** `POST /api/past-chats/:id/continue`: a chat of Conch's own that carries it on. */
export const ContinuePastChatResult = z.object({ conversationId: z.string() });
export type ContinuePastChatResult = z.infer<typeof ContinuePastChatResult>;

/** `DELETE /api/import/chats`: every past chat taken out of Conch (the other apps keep theirs). */
export const RemovePastChatsResult = z.object({ removed: z.number().int().nonnegative() });
export type RemovePastChatsResult = z.infer<typeof RemovePastChatsResult>;
