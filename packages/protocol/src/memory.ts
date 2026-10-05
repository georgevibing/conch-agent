/** Long-term memory (ADR 0003, ADR 0032, ADR 0088). */
import { z } from 'zod';

/**
 * Never add a kind or a source: the version before reads them as strict enums
 * and drops a memory it can't read (ADR 0051). A new sort of memory is a kind
 * here plus `about`.
 */
export const MemoryKind = z.enum(['fact', 'preference', 'project', 'person']);
export type MemoryKind = z.infer<typeof MemoryKind>;

/**
 * What a learned `fact` is about (ADR 0088): this computer ("On this computer,
 * `python` isn't found; `py` works"), or a lesson a dead end taught.
 */
export const MemoryAbout = z.enum(['environment', 'pitfall']);
export type MemoryAbout = z.infer<typeof MemoryAbout>;

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
  /** What a learned fact is about (ADR 0088). */
  about: MemoryAbout.optional(),
  /** The record of how Conch learned it (`LearnedEntry.id`), for Why? and Undo (ADR 0088). */
  learned: z.string().max(40).optional(),
  /**
   * When it stopped being true: a superseded memory, kept under
   * `memory/superseded/` with its history, never in the prompt (ADR 0088).
   */
  invalidAt: z.number().optional(),
  /** The memory that replaced it. */
  supersededBy: z.string().optional(),
});
export type Memory = z.infer<typeof Memory>;
