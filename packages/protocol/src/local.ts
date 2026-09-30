/**
 * A model on this computer (ADR 0022).
 *
 * Conch runs an open model through Ollama, on this computer: private, free, and
 * it keeps working with the internet unplugged. Setting it up is three steps —
 * get Ollama, get a model, pick it — and Conch does the first two for you. What
 * it can't promise (a big model on a small computer, a download with no disk
 * space left) it says before it starts, not halfway through.
 *
 * Conch only ever talks to Ollama on this computer (loopback). A model name is
 * checked before it goes anywhere: it can't carry a path, a space or a query.
 */
import { z } from 'zod';

/**
 * An Ollama model name: `llama3.2:3b`, `qwen3:8b`, or a namespaced one someone
 * pulled by hand (`library/llama3.2`, `hf.co/user/repo:Q4_K_M`). Each part
 * starts with a letter or digit, so `.` and `..` can never be a part; there are
 * no backslashes, spaces, `%` or `?`, and at most three parts before the tag.
 */
export const LocalModelName = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(
    /^[A-Za-z0-9][\w.-]*(?:\/[A-Za-z0-9][\w.-]*){0,2}(?::[A-Za-z0-9][\w.-]{0,127})?$/,
    'That isn’t the name of a model.',
  );
export type LocalModelName = z.infer<typeof LocalModelName>;

/** Where Ollama stands on this computer. */
export const OllamaState = z.enum([
  /** Not installed. */
  'missing',
  /** Installed, not running. */
  'stopped',
  /** Conch is starting it. */
  'starting',
  /** Running and answering. */
  'running',
  /**
   * `OLLAMA_HOST` points at another computer. Conch only uses a model on this
   * one, so it doesn't follow it; `message` says what to change.
   */
  'elsewhere',
]);
export type OllamaState = z.infer<typeof OllamaState>;

/** A model that's on this computer, ready to chat. */
export const LocalModel = z.object({
  /** What Ollama calls it: `llama3.2:3b`. */
  name: z.string(),
  /** What a person calls it: "Llama 3.2". */
  label: z.string(),
  sizeBytes: z.number().nonnegative(),
  /** It can use tools: your apps, memory, routines, the browser. */
  tools: z.boolean(),
  /** It can look at pictures. */
  vision: z.boolean().default(false),
  /** It thinks before it answers (slower, better on hard questions). */
  thinking: z.boolean().default(false),
  /** "3.2B", as Ollama says it. */
  parameters: z.string().optional(),
});
export type LocalModel = z.infer<typeof LocalModel>;

/** A model Conch suggests getting — never one this computer can't run. */
export const LocalOffer = z.object({
  name: z.string(),
  label: z.string(),
  /** What the download weighs. */
  sizeBytes: z.number().nonnegative(),
  /** One plain sentence on why this one. */
  blurb: z.string(),
  /** Roughly how long the download takes on a typical home connection. */
  minutes: z.number().nonnegative(),
  /** It will run on this computer (memory) and there's room for it (disk). */
  fits: z.boolean(),
  /** Why it doesn't fit, in plain words. */
  reason: z.string().optional(),
  installed: z.boolean(),
  /** The one Conch suggests for this computer. */
  recommended: z.boolean(),
  /** It can use tools (apps, memory, the browser). */
  tools: z.boolean(),
});
export type LocalOffer = z.infer<typeof LocalOffer>;

/** A model download, as it goes. */
export const LocalPull = z.object({
  model: z.string(),
  label: z.string(),
  state: z.enum(['pulling', 'paused', 'failed', 'done']),
  /** What's happening now: "Downloading", "Checking the download", "Almost done". */
  phase: z.string(),
  completedBytes: z.number().nonnegative(),
  /** Unset until Ollama says how big it is. */
  totalBytes: z.number().nonnegative().optional(),
  /** Averaged over the last few seconds. */
  bytesPerSecond: z.number().nonnegative().optional(),
  secondsLeft: z.number().nonnegative().optional(),
  /** Why it stopped, when it failed. */
  message: z.string().optional(),
});
export type LocalPull = z.infer<typeof LocalPull>;

export const LocalStatus = z.object({
  ollama: z.object({
    state: OllamaState,
    version: z.string().optional(),
    /** Where the program is, when it's installed. */
    path: z.string().optional(),
    /** One plain sentence, when the state needs explaining. */
    message: z.string().optional(),
  }),
  /** Models on this computer that can chat. */
  models: z.array(LocalModel),
  /** The model local chats use unless one is picked. */
  chosen: z.string().optional(),
  /** Models worth getting, the recommended one first. */
  offers: z.array(LocalOffer),
  machine: z.object({
    memoryBytes: z.number().nonnegative(),
    /** Free space where Ollama keeps models, when Conch could tell. */
    freeDiskBytes: z.number().nonnegative().optional(),
  }),
  /** The download in progress, paused or just finished. */
  pull: LocalPull.optional(),
});
export type LocalStatus = z.infer<typeof LocalStatus>;

/** Get a model Conch suggests (sudo mode: it's a big download that stays on this computer). */
export const LocalPullBody = z.object({ model: LocalModelName });
export type LocalPullBody = z.infer<typeof LocalPullBody>;

/** Which model local chats use. */
export const LocalChooseBody = z.object({ model: LocalModelName });
export type LocalChooseBody = z.infer<typeof LocalChooseBody>;
