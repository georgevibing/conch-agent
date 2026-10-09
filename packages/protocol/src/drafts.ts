/**
 * What you were writing in a chat and hadn't sent yet (ADR 0124): the words,
 * the files, pictures and long pastes already on the message, and for a new
 * chat the model and mode chosen for it. One per chat, and one for the new
 * chat page, kept by the gateway so it follows you to a reload, a restart,
 * another browser and your phone.
 *
 * Attachments travel as ids: the gateway looks each one up itself, keeps it
 * while a draft holds it (an unsent upload is otherwise swept after a day),
 * and says which are no longer there.
 */
import { z } from 'zod';

import { ATTACHMENT_LIMITS, Attachment } from './attachments';
import { Id, TurnOptions } from './common';

/** The new chat page's draft is kept under this name instead of a chat's id. */
export const NEW_CHAT_DRAFT = 'new';

/** Whose draft: a conversation's id, or the new chat page's. */
export const DraftKey = Id;
export type DraftKey = z.infer<typeof DraftKey>;

export const DRAFT_LIMITS = {
  /** Words kept: far more than anyone types, small enough to stay quick. */
  maxText: 100_000,
  /** A draft nobody touched for this long is let go, and its files with it. */
  maxAgeMs: 30 * 24 * 60 * 60 * 1000,
} as const;

/** `PUT /api/conversations/:id/draft`: the draft as it is now. Empty words and no files clear it. */
export const PutDraftBody = z
  .object({
    text: z.string().max(DRAFT_LIMITS.maxText),
    /** Ids from `POST /api/attachments`, in the order they sit on the message. */
    attachments: z.array(Id).max(ATTACHMENT_LIMITS.maxCount).default([]),
    /** A new chat's choices (model, mode…); a chat's own are kept with the chat. */
    options: TurnOptions.optional(),
  })
  .strict();
export type PutDraftBody = z.input<typeof PutDraftBody>;

/** A draft as the gateway keeps it. */
export const ChatDraft = z.object({
  text: z.string().max(DRAFT_LIMITS.maxText),
  attachments: z.array(Attachment).max(ATTACHMENT_LIMITS.maxCount),
  options: TurnOptions.optional(),
  updatedAt: z.number(),
});
export type ChatDraft = z.infer<typeof ChatDraft>;

/**
 * The answer to reading or writing a draft. `missing`: attachment ids the
 * draft had that are no longer on this computer, so the message can say so
 * on their cards instead of failing when it's sent.
 */
export const DraftReply = z.object({
  draft: ChatDraft.nullable(),
  missing: z.array(Id),
});
export type DraftReply = z.infer<typeof DraftReply>;

/** `GET /api/drafts`: which chats have something unsent, for the chat list's Draft mark. */
export const DraftList = z.object({
  drafts: z.array(z.object({ key: DraftKey, updatedAt: z.number() })),
});
export type DraftList = z.infer<typeof DraftList>;

/** Whether a draft has anything in it worth keeping. */
export function draftIsEmpty(draft: { text: string; attachments: readonly unknown[] }): boolean {
  return !draft.text.trim() && draft.attachments.length === 0;
}
