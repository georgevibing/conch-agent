/**
 * Files and long pastes that travel with a message (ADR 0017).
 *
 * The browser uploads each file to the gateway first (`POST /api/attachments`,
 * raw bytes), gets an `Attachment` back, and sends only its id with the
 * message. Long pastes take the same road as a `text/plain` file marked
 * `pasted`, so the transcript can show them as a card instead of a wall of
 * text, and every provider gets them the same way.
 */
import { z } from 'zod';

import { Id } from './common';

/**
 * How the gateway treats an attachment. The gateway decides, from the bytes and
 * the name, never from what the browser claimed:
 * - `text`: readable text (a paste, code, CSV, Markdown…), given to the model as text;
 * - `image`: a PNG, JPEG, GIF or WebP whose bytes say so, given to models that can see;
 * - `file`: anything else (PDF, a spreadsheet, a zip), saved for agents that can open files.
 */
export const AttachmentKind = z.enum(['text', 'image', 'file']);
export type AttachmentKind = z.infer<typeof AttachmentKind>;

export const Attachment = z.object({
  id: Id,
  /** File name as shown (no folders). Pastes are called "Pasted text". */
  name: z.string().min(1).max(255),
  /** The type the gateway settled on (sniffed for images; `text/plain` for pastes). */
  mimeType: z.string().min(1).max(255),
  size: z.number().int().nonnegative(),
  kind: AttachmentKind,
  /** It was pasted into the composer, not picked or dropped as a file. */
  pasted: z.boolean().optional(),
  /** Line count, for text. */
  lines: z.number().int().nonnegative().optional(),
  /** Pixel size, for images, so the transcript can lay them out before they load. */
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  /**
   * A voice note's words, turned into text on this computer (ADR 0077). The
   * message carries them too; this says the recording and the words are one.
   */
  transcript: z.string().max(20_000).optional(),
  createdAt: z.number(),
});
export type Attachment = z.infer<typeof Attachment>;

/** The limits both sides enforce. The browser checks first so nobody waits for a refusal. */
export const ATTACHMENT_LIMITS = {
  /** Per file. Big enough for a long PDF or a phone photo, small enough to stay quick. */
  maxBytes: 30 * 1024 * 1024,
  /** Per message. */
  maxCount: 20,
  /** Longest name kept; longer ones are shortened, keeping the extension. */
  maxName: 255,
} as const;

/**
 * When a paste becomes a card instead of text in the box: more than 1 000
 * characters (Codex CLI's `LARGE_PASTE_CHAR_THRESHOLD` and Open WebUI's
 * `PASTED_TEXT_CHARACTER_LIMIT`; Claude Code folds past 800) or more than 20
 * lines, so a short snippet stays inline but a page of logs doesn't bury the
 * box. Shift+paste always pastes inline. See ADR 0017.
 */
export const PASTE_FOLD = { chars: 1000, lines: 20 } as const;

/** Whether pasted text is long enough to become a card. */
export function shouldFoldPaste(text: string): boolean {
  return text.length > PASTE_FOLD.chars || countLines(text) > PASTE_FOLD.lines;
}

/** Lines in a text, counting a last line without a newline. */
export function countLines(text: string): number {
  if (!text) return 0;
  let lines = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lines++;
  return text.endsWith('\n') ? lines - 1 : lines;
}

/** The upload answer: the stored attachment. */
export const UploadedAttachment = z.object({ attachment: Attachment });
export type UploadedAttachment = z.infer<typeof UploadedAttachment>;
