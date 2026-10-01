/** Long-term memory (ADR 0003, ADR 0032). */
import { z } from 'zod';

export const MemoryKind = z.enum(['fact', 'preference', 'project', 'person']);
export type MemoryKind = z.infer<typeof MemoryKind>;

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
});
export type Memory = z.infer<typeof Memory>;
