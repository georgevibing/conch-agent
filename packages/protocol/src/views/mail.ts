/**
 * An email Conch sent or saved for the person, drawn as what it is (ADR 0060):
 * a letter that went, or one waiting in Drafts, never a row in an inbox. And
 * the change a person may make to an email before approving it: what they
 * approve is exactly what goes, checked again by the tool that sends it.
 */
import { z } from 'zod';

/** An ISO 8601 date-time. */
const When = z.string().min(4).max(40);
/** Only web links leave the chat. */
const WebUrl = z
  .string()
  .max(2000)
  .regex(/^https?:\/\//i, 'Only web links.');

/** Someone an email went to: their address, and their name when it was known. */
export const MailPerson = z.object({
  address: z.string().max(254),
  /** As the thread named them (outside words: drawn as plain text, beside the address). */
  name: z.string().max(200).optional(),
});
export type MailPerson = z.infer<typeof MailPerson>;

/** A file that went with it. */
export const MailFile = z.object({
  name: z.string().max(300),
  mime: z.string().max(120).optional(),
  size: z.number().int().nonnegative().optional(),
});
export type MailFile = z.infer<typeof MailFile>;

/** The longest preview of the words a view carries; the rest is in Gmail. */
export const MAIL_PREVIEW_MAX = 4000;

/**
 * An email that went (`sent`: Gmail took it), or one saved in Drafts and not
 * sent (`draft`). `url` opens it in Gmail. `edited` when the person changed
 * the assistant's words before approving them.
 */
export const MailSentView = z.object({
  kind: z.literal('mail-sent'),
  state: z.enum(['sent', 'draft']),
  /** The account it went from. */
  from: z.string().max(254),
  to: z.array(MailPerson).min(1).max(20),
  cc: z.array(MailPerson).max(20).optional(),
  subject: z.string().max(300),
  body: z.string().max(MAIL_PREVIEW_MAX),
  /** More was written than `body` holds. */
  clipped: z.boolean().optional(),
  at: When,
  url: WebUrl.optional(),
  /** A reply in a thread. */
  reply: z.boolean().optional(),
  edited: z.boolean().optional(),
  files: z.array(MailFile).max(10).optional(),
});
export type MailSentView = z.infer<typeof MailSentView>;

const Address = z.email().max(254);

/**
 * An email as the person changed it on the approval card
 * (`permission.respond` `edit`). Only the words and who they go to; never the
 * account, the thread or anything else the call carried.
 */
export const MailEdit = z
  .object({
    to: z.array(Address).min(1).max(20),
    cc: z.array(Address).max(20).optional(),
    subject: z
      .string()
      .max(500)
      .refine((s) => !/[\r\n]/.test(s), { error: 'Keep the subject on one line.' }),
    body: z.string().max(100_000),
  })
  .strict();
export type MailEdit = z.infer<typeof MailEdit>;
