/**
 * Safe hands (ADR 0028): checking before acting on what the assistant read,
 * the sealed box for commands, everything it did in one place, and skills
 * read before they steer anything.
 */
import { z } from 'zod';

export const SafetyStatus = z.object({
  /** Commands can be sealed on this computer. */
  sandbox: z.object({
    available: z.boolean(),
    /** Why not, in a sentence. */
    reason: z.string().optional(),
    /** What a person can run to make it possible (Linux). */
    command: z.string().optional(),
    /** What a sealed command can't read, in words: "SSH keys", "your keychains"… */
    protects: z.array(z.string()),
  }),
  /**
   * What sealing means for each provider you use (ADR 0031), honestly: never
   * a protection that isn't there.
   */
  providers: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        /** `partly`: sealed, but something is still reachable (`note` says what). */
        state: z.enum(['sealed', 'partly', 'not-sealed', 'no-commands']),
        note: z.string(),
      }),
    )
    .default([]),
});
export type SafetyStatus = z.infer<typeof SafetyStatus>;

// ── Activity: everything the assistant did, in one place ────────────────────

export const ActivityKind = z.enum([
  /** A command it ran. */
  'command',
  /** A file it created or changed. */
  'file',
  /** The web: a page fetched, a search, the browser. */
  'web',
  /** An app it used (an integration's tool). */
  'app',
  /** Something it asked you, and what you said. */
  'approval',
  /** It read something untrusted (ADR 0028). */
  'read',
  /** Something it remembered or forgot. */
  'memory',
  /** Something it made for you to see and use (ADR 0034). */
  'artifact',
  /** A skill's list the chat was held to, and when you stopped holding it (ADR 0047). */
  'skill',
]);
export type ActivityKind = z.infer<typeof ActivityKind>;

export const ActivityEntry = z.object({
  /** `<conversation>:<seq>`: stable, and where to open it. */
  id: z.string(),
  at: z.number(),
  kind: ActivityKind,
  /** "Ran `npm test`", "Changed src/app.ts", "Allowed: run `git push`". */
  title: z.string(),
  status: z.enum(['done', 'failed', 'allowed', 'denied', 'waiting', 'noted']),
  conversation: z.object({ id: z.string(), title: z.string(), routine: z.boolean().optional() }),
  /** Where in the chat: the `data-anchor` to open at. */
  anchor: z.string().optional(),
  /** Files it changed can be put back (ADR 0030): which change set, and where it stands. */
  undo: z
    .object({ changeSetId: z.string(), state: z.enum(['applied', 'undone', 'expired']) })
    .optional(),
  /** A memory it saved or forgot, so Activity can take it back. */
  memory: z
    .object({ id: z.string(), content: z.string(), action: z.enum(['saved', 'forgotten']) })
    .optional(),
});
export type ActivityEntry = z.infer<typeof ActivityEntry>;

export const ActivityPage = z.object({
  entries: z.array(ActivityEntry),
  /** Pass as `before` for the next, older page; unset when there's no more. */
  next: z.number().optional(),
});
export type ActivityPage = z.infer<typeof ActivityPage>;
