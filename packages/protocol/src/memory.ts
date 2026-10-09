/** Long-term memory (ADR 0003, ADR 0032, ADR 0088). */
import { z } from 'zod';

/** The longest a headline is: about twelve words, one line on a phone (ADR 0003 § Headlines). */
export const MEMORY_HEADLINE_MAX = 80;

/** Where a clause ends: a sentence, a semicolon, a colon or dash before more, an aside in brackets. */
const CLAUSE_END = /[.!?;:](?=\s)|\s[–—-]\s|\s\(/u;

/**
 * Words in a few, without a model: the first clause, and if that's still too
 * long, cut at the last whole word with “…”. Words already short enough come
 * back as they are. Used until a small model's headline is there, and
 * wherever none may be asked.
 */
export function clipHeadline(text: string, max = MEMORY_HEADLINE_MAX): string {
  const words = text.replace(/\s+/g, ' ').trim();
  if (words.length <= max) return words;
  const end = CLAUSE_END.exec(words);
  const clause = (end ? words.slice(0, end.index) : words).replace(/[\s,.;:–—-]+$/u, '');
  if (clause.length >= 12 && clause.length <= max) return clause;
  // A clause too short to say anything (“Rule:”) runs on into the next.
  const room = (clause.length >= 12 ? clause : words).slice(0, max - 1);
  const cut = room.lastIndexOf(' ');
  return `${(cut > max / 2 ? room.slice(0, cut) : room).replace(/[\s,.;:–—-]+$/u, '')}…`;
}

/** What to show where a memory (or a skill's description) is summed up: its headline, else its words in a few. */
export function headlineOf(item: { content: string; headline?: string | undefined }): string {
  return item.headline ?? clipHeadline(item.content);
}

/** Longer than a headline: a small model is asked for one. */
export function needsHeadline(text: string): boolean {
  return text.replace(/\s+/g, ' ').trim().length > MEMORY_HEADLINE_MAX;
}

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
  /**
   * What a learned fact is about (ADR 0088). One this version doesn't know
   * (from a later one) is left out, never the whole memory.
   */
  about: MemoryAbout.optional().catch(undefined),
  /** The record of how Conch learned it (`LearnedEntry.id`), for Why? and Undo (ADR 0088). */
  learned: z.string().max(40).optional(),
  /**
   * When it stopped being true: a superseded memory, kept under
   * `memory/superseded/` with its history, never in the prompt (ADR 0088).
   */
  invalidAt: z.number().optional(),
  /** The memory that replaced it. */
  supersededBy: z.string().optional(),
  /** The memory check held it (ADR 0087): why, in plain words. Always with `pending`. */
  held: MemoryHold.optional(),
  /** Where it came from (ADR 0087). Older memories have none. */
  provenance: MemoryProvenance.optional(),
  /**
   * What it says in a few words, for the places that sum it up (ADR 0003 §
   * Headlines): written once by a small model, for exactly these words. Only
   * the person reads it: never a model, never the check. One that's too long
   * (from a later version) is left out, never the whole memory.
   */
  headline: z.string().min(1).max(MEMORY_HEADLINE_MAX).optional().catch(undefined),
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
