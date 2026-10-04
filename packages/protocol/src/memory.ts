/** Long-term memory (ADR 0003, ADR 0032). */
import { z } from 'zod';

export const MemoryKind = z.enum(['fact', 'preference', 'project', 'person']);
export type MemoryKind = z.infer<typeof MemoryKind>;

/**
 * Why a memory looks off (ADR 0087): what kind of signal, and the sentence the
 * person reads. Words are Conch's own, never a model's or a page's.
 */
export const MemoryReasonCode = z.enum([
  /** A value in it (an address, a number) came from something the chat read, not from you. */
  'outside',
  /** It would change where money, invoices, files or replies go. */
  'redirect',
  /** It talks to the assistant: orders, "from now on", "don't tell them". */
  'instruction',
  /** It would have the assistant run, install, open, send or delete things later. */
  'directive',
  /** It claims to speak for you, or for whoever runs Conch. */
  'authority',
  /** It would send what you talk about somewhere else (an image, a link to fill in). */
  'exfiltration',
  /** A password, a key, a code. */
  'secret',
  /** Characters you can't see. */
  'hidden',
  /** A name made to look like another (letters from another alphabet). */
  'lookalike',
  /** A block of encoded text. */
  'encoded',
  /** Much longer than a memory usually is. */
  'long',
  /** With what it remembered just before, it adds up to one of the above. */
  'pieces',
  /** A second check by a model raised it (it can only raise, never clear). */
  'second-look',
  /** The check couldn't finish: it waits rather than going through. */
  'unchecked',
]);
export type MemoryReasonCode = z.infer<typeof MemoryReasonCode>;

export const MemoryReason = z.object({
  code: MemoryReasonCode,
  words: z.string().min(1).max(300),
});
export type MemoryReason = z.infer<typeof MemoryReason>;

/**
 * A memory the check held (ADR 0087): not saved for use, not in recall, until
 * you say. `ask` waits for Remember it; `refuse` (a secret, hidden characters)
 * needs Remember anyway.
 */
export const MemoryHold = z.object({
  verdict: z.enum(['ask', 'refuse']),
  reasons: z.array(MemoryReason).min(1).max(8),
  /** Where it came from, in a few words: “news.example, a page this chat read”. */
  from: z.string().max(200).optional(),
  /** Memories it adds up to a plant with, held with it. */
  pieces: z.array(z.string()).max(4).optional(),
});
export type MemoryHold = z.infer<typeof MemoryHold>;

/** Where a memory came from (ADR 0087), kept with it for good. */
export const MemoryProvenance = z.object({
  via: z.enum(['you', 'chat', 'tidy', 'import', 'app']),
  /** What the chat had read from outside when it was learned: “news.example”, “Gmail”. */
  read: z.array(z.string().max(120)).max(12).optional(),
  /** Its words, or the values in it, were the person's own. */
  yours: z.boolean().optional(),
});
export type MemoryProvenance = z.infer<typeof MemoryProvenance>;

export const Memory = z.object({
  id: z.string(),
  content: z.string().min(1).max(2000),
  kind: MemoryKind.default('fact'),
  /** Who wrote it: the user directly, the agent during a conversation, or a tidy-up (ADR 0032). */
  source: z.enum(['user', 'agent', 'tidy']),
  conversationId: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  /**
   * Waiting for your OK (ADR 0032): learned in a chat that read something
   * untrusted (ADR 0028), or by a tidy-up while “Remember things
   * automatically” is off. Never in the assistant's prompt or `recall`
   * until you keep it.
   */
  pending: z.boolean().optional(),
  /** Why it waits, in a sentence: “Learned in a chat that read news.example.” */
  untrusted: z.string().max(300).optional(),
  /** The memory check held it (ADR 0087): why, in plain words. Always with `pending`. */
  held: MemoryHold.optional(),
  /** Where it came from (ADR 0087). Older memories have none. */
  provenance: MemoryProvenance.optional(),
});
export type Memory = z.infer<typeof Memory>;

/**
 * `POST /api/memories/:id/keep`: keep a memory that waits. `content` keeps
 * your edited words instead (Edit first); `anyway` is the explicit override a
 * refused one needs (ADR 0087).
 */
export const KeepMemoryBody = z
  .object({
    content: z.string().trim().min(1).max(2000).optional(),
    /** The words you saw when you answered: kept only if they're still what's there. */
    seen: z.string().min(1).max(2000).optional(),
    anyway: z.boolean().optional(),
  })
  .strict();
export type KeepMemoryBody = z.infer<typeof KeepMemoryBody>;
