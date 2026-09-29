/**
 * Providers — where your assistant's intelligence comes from.
 *
 * A provider is one engine you can connect: a program already on this computer
 * (Claude Code, Codex) or a service you hold a key for (OpenRouter, the
 * Anthropic API). Conch uses one at a time and remembers the others, so
 * switching is one click and nothing has to be set up twice.
 *
 * Keys never appear in these schemas. The browser sends one once; afterwards it
 * only learns that a key is saved, where it's kept, and its last four
 * characters.
 */
import { z } from 'zod';

import { EngineId, EngineStatus, InstallHint } from './engine';

/** How you connect a provider. */
export const ProviderConnect = z.enum([
  /** A program on this computer that signs itself in. */
  'program',
  /** A service you paste a key for (or sign in to, to make one). */
  'key',
]);
export type ProviderConnect = z.infer<typeof ProviderConnect>;

/** Where a saved secret is kept. */
export const SecretSource = z.enum([
  /** In `~/.conch/secrets.json`, readable only by you. */
  'conch',
  /** In 1Password. Conch keeps the reference and asks for the value when it needs it. */
  '1password',
]);
export type SecretSource = z.infer<typeof SecretSource>;

/** A secret that's saved, described without revealing it. */
export const SavedSecret = z.object({
  source: SecretSource,
  /** `…4f2c` for a key Conch holds, or the `op://…` reference for 1Password. */
  hint: z.string(),
  savedAt: z.number(),
  /** Set when the value can't be read right now (1Password locked, item renamed). */
  problem: z.string().optional(),
});
export type SavedSecret = z.infer<typeof SavedSecret>;

/** What to show when asking for a provider's key. */
export const KeyForm = z.object({
  /** "OpenRouter key" */
  label: z.string(),
  placeholder: z.string().default(''),
  /** One plain sentence on where to find it. */
  help: z.string().default(''),
  /** The page that creates one. */
  url: z.string().optional(),
  /** Shape the value must have, checked on both sides. */
  pattern: z.string().optional(),
  patternHint: z.string().optional(),
  /** This provider can make a key for you when you sign in (one click, no copy-paste). */
  canSignIn: z.boolean().default(false),
});
export type KeyForm = z.infer<typeof KeyForm>;

/**
 * One provider, ready for a card: what it is, whether it's connected, and what
 * connecting it would take.
 */
export const Provider = z.object({
  id: EngineId,
  /** "Claude Code", "OpenRouter". */
  name: z.string(),
  /** Four or five words: "Claude, on this computer". */
  tagline: z.string(),
  /** A sentence on what you get. */
  description: z.string(),
  connect: ProviderConnect,
  /** Live detection: installed? signed in? which account? */
  status: EngineStatus,
  /** In use for new conversations. Exactly one provider is. */
  active: z.boolean(),
  /** Ready to be used or switched to right now. */
  ready: z.boolean(),
  /** Two or three things this provider is good at, for the card. */
  highlights: z.array(z.string()).default([]),
  /**
   * What this provider can't do, in plain words. Shown where you'd otherwise
   * find out the hard way — one sentence each, said before you connect.
   */
  limits: z.array(z.string()).default([]),
  /** How to install it, when it isn't here yet. */
  install: z.array(InstallHint).default([]),
  /** The key that's saved, if any. */
  key: SavedSecret.optional(),
  /** Absent for providers that sign themselves in. */
  keyForm: KeyForm.optional(),
  /** Early support — say so rather than pretend. */
  experimental: z.boolean().default(false),
  /** Brand colour for the logo tile. */
  color: z.string().optional(),
  homepage: z.string().optional(),
  /** Why this provider can't be used at all on this machine (e.g. it's a test double). */
  hidden: z.boolean().default(false),
});
export type Provider = z.infer<typeof Provider>;

/** Whether Conch can reach 1Password on this computer. */
export const OnePasswordStatus = z.object({
  /** The `op` command is installed. */
  available: z.boolean(),
  version: z.string().optional(),
  /** What to do about it, when it isn't available. */
  message: z.string().optional(),
  installCommand: z.string().optional(),
  docsUrl: z.string().optional(),
});
export type OnePasswordStatus = z.infer<typeof OnePasswordStatus>;

export const ProvidersList = z.object({
  /** The provider new conversations use. */
  active: EngineId,
  providers: z.array(Provider),
  onePassword: OnePasswordStatus,
  /** Set when the choice is pinned by `CONCH_ENGINE` and can't be changed here. */
  pinned: z.string().optional(),
});
export type ProvidersList = z.infer<typeof ProvidersList>;

/**
 * A 1Password secret reference: `op://vault/item/field`, optionally with a
 * section (`op://vault/item/section/field`).
 *
 * 1Password's own rule is that names may only contain letters, numbers,
 * `-`, `_`, `.` and spaces — anything else has to be given as an id. We hold
 * references to the same rule: it's the shape people are told to use, and it
 * keeps quoting and shell characters out of a value we hand to another program.
 */
export const SecretReference = z
  .string()
  .trim()
  .max(512)
  .regex(
    /^op:\/\/[\w .-]+(\/[\w .-]+){2,3}$/,
    'A 1Password reference looks like op://Vault/Item/field.',
  );

/** A key, or a 1Password reference to one. Conch tells them apart by the `op://` prefix. */
export const ProviderKeyBody = z.object({
  value: z.string().trim().min(8).max(4096).regex(/^\S+$/, 'A key has no spaces in it.'),
});
export type ProviderKeyBody = z.infer<typeof ProviderKeyBody>;

/** Where to send the browser so the provider can make a key for you. */
export const ProviderSignIn = z.object({ authorizeUrl: z.string() });
export type ProviderSignIn = z.infer<typeof ProviderSignIn>;

/** Which provider new conversations should use. */
export const UseProviderBody = z.object({ id: EngineId });
export type UseProviderBody = z.infer<typeof UseProviderBody>;
