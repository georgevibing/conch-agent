/**
 * Providers — where your assistant's intelligence comes from.
 *
 * A provider is one engine you can connect: a program already on this computer
 * (Claude Code, Codex) or a service you hold a key for (OpenRouter, the
 * Anthropic API). Every connected provider is available at once — the model
 * picker lists all of their models — and one is the default for new chats
 * (ADR 0012).
 *
 * Keys never appear in these schemas. The browser sends one once; afterwards it
 * only learns that a key is saved, where it's kept, and its last four
 * characters.
 */
import { z } from 'zod';

import { EngineId, ServerId } from './common';
import { EngineStatus, InstallHint } from './engine';

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
  /**
   * How a pasted key is known to be this provider's (ADR 0053): `distinct`
   * only this provider's keys look like (`gsk_`, `xai-`), `loose` other
   * providers' keys may look like too (plenty start `sk-`), so Conch asks.
   */
  recognise: z.object({ distinct: z.string().optional(), loose: z.string().optional() }).optional(),
});
export type KeyForm = z.infer<typeof KeyForm>;

/** Where a provider sits in the gallery, in the words a person would sort them by. */
export const ProviderGroup = z.enum([
  /** A program on this computer with your own sign-in: a plan you already pay for. */
  'subscription',
  /** A service you pay as you go, with a key. */
  'key',
  /** A model running on this computer. */
  'local',
  /** A server you run yourself. */
  'server',
]);
export type ProviderGroup = z.infer<typeof ProviderGroup>;

/** A server you added yourself (Settings → Providers → Another server). */
export const ServerConfig = z.object({
  id: ServerId,
  /** What you call it: "The GPU box", "llama.cpp". */
  name: z.string().trim().min(1).max(60),
  /** Everything before `/chat/completions`: `http://127.0.0.1:8080/v1`. */
  url: z.string().url().max(500),
  /** What Conch recognised it as, when it could tell: "llama.cpp", "vLLM". */
  kind: z.string().max(40).optional(),
  addedAt: z.number(),
});
export type ServerConfig = z.infer<typeof ServerConfig>;

/** Add a server: where it is, what to call it, and its key if it wants one. */
export const AddServerBody = z.object({
  url: z.string().trim().min(1).max(500),
  name: z.string().trim().max(60).optional(),
  key: z.string().trim().max(4096).optional(),
});
export type AddServerBody = z.infer<typeof AddServerBody>;

/** Rename a server, or point it somewhere else. */
export const UpdateServerBody = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  url: z.string().trim().min(1).max(500).optional(),
});
export type UpdateServerBody = z.infer<typeof UpdateServerBody>;

/** Look at an address before adding it. */
export const ProbeServerBody = z.object({
  url: z.string().trim().min(1).max(500),
  key: z.string().trim().max(4096).optional(),
});
export type ProbeServerBody = z.infer<typeof ProbeServerBody>;

/** What Conch found at an address, in words for the form. */
export const ServerProbe = z.object({
  /** It answers like a chat server, and Conch can list its models. */
  ok: z.boolean(),
  /** The address as Conch will use it (scheme added, `/v1` found). */
  url: z.string().optional(),
  /** "llama.cpp", "vLLM", "LM Studio"… */
  kind: z.string().optional(),
  /** How many models it offers. */
  models: z.number().optional(),
  /** It wants a key, and none (or a wrong one) was given. */
  needsKey: z.boolean().optional(),
  /** What went wrong, in one sentence. */
  message: z.string().optional(),
});
export type ServerProbe = z.infer<typeof ServerProbe>;

/** A server people commonly add, offered as a starting point. */
export const ServerPreset = z.object({
  id: z.string(),
  name: z.string(),
  /** A few words: "Open models, low prices". */
  tagline: z.string(),
  url: z.string(),
  /** It runs on your computer (or your network), rather than a company's. */
  local: z.boolean(),
  /** The page that makes a key, for services that need one. */
  keyUrl: z.string().optional(),
  color: z.string().optional(),
});
export type ServerPreset = z.infer<typeof ServerPreset>;

/**
 * Something Conch noticed on this computer that would connect a provider in
 * one press: a key in the environment, a model server already running.
 */
export const Found = z.object({
  /** Stable, for the button that uses it. */
  id: z.string(),
  kind: z.enum(['key', 'server']),
  /** The provider it connects (a key), or `undefined` for a server to add. */
  provider: EngineId.optional(),
  /** "OpenAI", "llama.cpp" */
  name: z.string(),
  /** "OPENAI_API_KEY in this computer's settings · ends 4f2c", "Running at localhost:8080" */
  detail: z.string(),
  /** For a server: where it is. */
  url: z.string().optional(),
  brand: z.string().optional(),
  color: z.string().optional(),
});
export type Found = z.infer<typeof Found>;

/**
 * One provider, ready for a card: what it is, whether it's connected, and what
 * connecting it would take.
 */
export const Provider = z.object({
  signInLabel: z.string().optional(),
  signInHelp: z.string().optional(),
  disconnectable: z.boolean().optional(),
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
  /** The default for new chats. Exactly one provider is; every ready one can be picked. */
  active: z.boolean(),
  /** Runs on this computer: works with no internet, spends nothing. */
  local: z.boolean().default(false),
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
  /** Where it sits in the gallery. */
  group: ProviderGroup.default('key'),
  /** Offered first in the gallery, before "More providers". */
  featured: z.boolean().default(false),
  /** A few honest words when it costs nothing to start: "Free tier", "Free with a Google account". */
  free: z.string().optional(),
  /** Its logo, when it isn't its id (a server you added wears a server). */
  brand: z.string().optional(),
  /** For a server you added: where it is and what it is. */
  server: ServerConfig.optional(),
  /** It has worked on this computer and you haven't removed it: it belongs with your providers, even while it needs you. */
  connectedBefore: z.boolean().default(false),
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
  /** Conch can install (or repair) the `op` command itself: the need to offer. */
  fix: z.object({ need: z.string(), kind: z.enum(['install', 'update']) }).optional(),
});
export type OnePasswordStatus = z.infer<typeof OnePasswordStatus>;

export const ProvidersList = z.object({
  /** The provider new chats start with. */
  active: EngineId,
  providers: z.array(Provider),
  onePassword: OnePasswordStatus,
  /** Set when the choice is pinned by `CONCH_ENGINE` and can't be changed here. */
  pinned: z.string().optional(),
  /** What Conch noticed on this computer that would connect a provider in one press. */
  found: z.array(Found).default([]),
  /** Servers people commonly add, for the Another server page. */
  serverPresets: z.array(ServerPreset).default([]),
});
export type ProvidersList = z.infer<typeof ProvidersList>;

/**
 * Whose a pasted key could be, from its shape alone (ADR 0053): the providers
 * only it could belong to if any match, else every provider whose keys could
 * look like it. Never a guess sent anywhere — the person picks when it's more
 * than one.
 */
export function recogniseKey(
  value: string,
  providers: readonly Pick<Provider, 'id' | 'keyForm'>[],
): EngineId[] {
  const key = value.trim();
  const test = (pattern: string | undefined) => {
    if (!pattern) return false;
    try {
      return new RegExp(pattern).test(key);
    } catch {
      return false;
    }
  };
  const distinct = providers.filter((p) => test(p.keyForm?.recognise?.distinct)).map((p) => p.id);
  if (distinct.length) return distinct;
  return providers.filter((p) => test(p.keyForm?.recognise?.loose)).map((p) => p.id);
}

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

/** Which provider new chats should start with. */
export const UseProviderBody = z.object({ id: EngineId });
export type UseProviderBody = z.infer<typeof UseProviderBody>;
