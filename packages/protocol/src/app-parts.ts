/**
 * What a Conch app can be besides tools and pages (ADR 0122): a **provider**
 * (what answers a chat: a model API, a server, a vendor's plan) and a
 * **chat app** to talk to your assistant on ("Talk to me here"). Both are
 * declared in `conch-app.json` and come with everything a Conch app has —
 * the maker, the seal, signing, sharing, Go back and the Apps gallery.
 *
 * - A provider is **declared first**: an address that speaks OpenAI's or
 *   Anthropic's chat, how its key is sent, and its models (or read live).
 *   That covers most companies with no code. For the rest, `speaks: 'code'`
 *   runs `provider.chat` from the app's tools module, sealed.
 * - A chat app is code (`channel.identify`, `poll` or `receive`, `send`),
 *   sealed the same way, delivering only into Conch's channel service.
 *
 * Keys are never in the app's files: the person types them into Conch, which
 * keeps them with its own (a provider's with every provider key, a chat
 * app's with every channel's), and hands them to the sealed code per call.
 */
import { z } from 'zod';

/** A web address a part declares: https only, no sign-in, query or fragment in it. */
const PartAddress = z
  .string()
  .trim()
  .max(300)
  .regex(
    /^https:\/\/[^\s/?#@]+(?:\/[^\s?#]*)?$/i,
    'Use an https:// address, like https://api.example.com/v1.',
  )
  .transform((url) => url.replace(/\/+$/, ''));

/** A header a key may travel in: a token, never one of the connection's own. */
export const KeyHeader = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9-]{1,40}$/, 'Use a header’s name, like x-api-key.')
  .refine(
    (name) =>
      !/^(?:host|cookie|content-length|content-type|connection|transfer-encoding|proxy-.*|x-forwarded-.*|sec-.*|forwarded|via|te|upgrade)$/.test(
        name,
      ),
    'That header belongs to the connection: send the key in another one.',
  );

const WebLink = z
  .string()
  .max(2000)
  .regex(/^https:\/\//i, 'Use an https:// address.');

/** What the person types for a provider: its key, said the way its company says it. */
export const AppProviderKey = z
  .object({
    /** "Fireworks API key". */
    label: z.string().trim().min(1).max(60),
    /** One sentence: where to find it. */
    help: z.string().trim().max(200).optional(),
    /** The page that makes one, opened beside the box. */
    link: WebLink.optional(),
    /** The shape a key has (a regular expression), checked as it's pasted. */
    pattern: z.string().max(200).optional(),
    /** Some servers want one, some don't. */
    optional: z.boolean().default(false),
  })
  .strict();
export type AppProviderKey = z.infer<typeof AppProviderKey>;

/** One model a provider offers, when it says so itself rather than listing them live. */
export const AppProviderModel = z
  .object({
    id: z.string().trim().min(1).max(200),
    /** "Llama 4 Maverick". */
    name: z.string().trim().max(80).optional(),
    /** How much it reads at once, in tokens. */
    context: z.number().int().positive().max(20_000_000).optional(),
    /** It can call tools (unset: yes). */
    tools: z.boolean().optional(),
    /** It looks at pictures. */
    images: z.boolean().optional(),
    /** It thinks before it answers. */
    thinking: z.boolean().optional(),
    /** What it costs, in US dollars per million tokens: what Conch counts a chat's spend with. */
    price: z
      .object({ input: z.number().min(0).max(10_000), output: z.number().min(0).max(10_000) })
      .strict()
      .optional(),
  })
  .strict();
export type AppProviderModel = z.infer<typeof AppProviderModel>;

/** How a provider speaks: one of the two chat shapes nearly everyone uses, or its own code. */
export const ProviderSpeaks = z.enum(['openai', 'anthropic', 'code']);
export type ProviderSpeaks = z.infer<typeof ProviderSpeaks>;

export const AppProviderPart = z
  .object({
    /** What it's called in the picker and Settings → Providers; the app's name when unset. */
    name: z.string().trim().min(1).max(40).optional(),
    speaks: ProviderSpeaks,
    /**
     * Everything before `/chat/completions` (OpenAI's shape) or `/v1/messages`
     * (Anthropic's): `https://api.fireworks.ai/inference/v1`. Its host must be
     * in `reaches`. Not for `code`, which reaches with `app.fetch`.
     */
    address: PartAddress.optional(),
    /** How the key travels: `Authorization: Bearer`, a header of its own (`header`), or none at all. */
    auth: z.enum(['bearer', 'header', 'none']).default('bearer'),
    header: KeyHeader.optional(),
    /** What the person types. Unset with `auth: 'none'`. */
    key: AppProviderKey.optional(),
    /** Its models. Empty: read live from the address's own list. */
    models: z.array(AppProviderModel).max(60).default([]),
    /** A small, cheap one of them, for naming chats and other small jobs. */
    small: z.string().trim().max(200).optional(),
  })
  .strict()
  .superRefine((part, ctx) => {
    if (part.speaks !== 'code' && !part.address)
      ctx.addIssue({
        code: 'custom',
        path: ['address'],
        message: 'Say where it answers: its https address, like https://api.example.com/v1.',
      });
    if (part.speaks === 'code' && part.address)
      ctx.addIssue({
        code: 'custom',
        path: ['address'],
        message: 'A provider in code reaches with app.fetch: leave out “address”.',
      });
    if (part.auth === 'header' && !part.header)
      ctx.addIssue({
        code: 'custom',
        path: ['header'],
        message: 'Name the header the key goes in, like "header": "x-api-key".',
      });
    if (part.auth !== 'none' && !part.key)
      ctx.addIssue({
        code: 'custom',
        path: ['key'],
        message: 'Say what the person types: "key": { "label": "… API key", "link": "https://…" }.',
      });
    if (part.speaks === 'code' && !part.models.length)
      ctx.addIssue({
        code: 'custom',
        path: ['models'],
        message: 'A provider in code lists its models in conch-app.json.',
      });
    if (part.small && part.models.length && !part.models.some((m) => m.id === part.small))
      ctx.addIssue({
        code: 'custom',
        path: ['small'],
        message: '“small” is one of its models’ ids.',
      });
  });
export type AppProviderPart = z.infer<typeof AppProviderPart>;

/** One thing the person types to connect a chat app: a bot's token, a server's address. */
export const AppChannelField = z
  .object({
    key: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,31}$/),
    label: z.string().trim().min(1).max(60),
    /** One sentence: where to find it. */
    help: z.string().trim().max(200).optional(),
    link: WebLink.optional(),
    placeholder: z.string().max(80).optional(),
    /** A token or a password: kept sealed, never shown again (the default). An address isn't. */
    secret: z.boolean().default(true),
    optional: z.boolean().default(false),
  })
  .strict();
export type AppChannelField = z.infer<typeof AppChannelField>;

export const AppChannelPart = z
  .object({
    /** What the chat app is called ("Zulip"); the app's name when unset. */
    name: z.string().trim().min(1).max(40).optional(),
    /** Its brand colour, for its tile. */
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    /**
     * How messages come in: `poll`, Conch asks the app's servers from this
     * computer (`channel.poll`, no public address needed), or `webhook`, the
     * app delivers to Conch's public door (`channel.receive`).
     */
    receives: z.enum(['poll', 'webhook']).default('poll'),
    /** What the person types to connect it, at most six. */
    fields: z.array(AppChannelField).max(6).default([]),
    /** The steps in the app itself, one sentence each, naming the buttons to press. */
    steps: z.array(z.string().trim().min(1).max(240)).max(6).default([]),
    /** `channel.send` takes buttons (approvals as buttons); otherwise they're numbered replies. */
    buttons: z.boolean().default(false),
  })
  .strict();
export type AppChannelPart = z.infer<typeof AppChannelPart>;

// ── Ids ────────────────────────────────────────────────────────────────────

/** A provider a Conch app brings: `app-` and the app's id (`app-fireworks`). */
export const appProviderId = (appId: string) => `app-${appId}` as const;

/** The app a provider id belongs to, or nothing when it isn't one an app brings. */
export function appOfProvider(id: string): string | undefined {
  return /^app-([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(id)?.[1];
}

// ── The live test (the review card's **Test it**) ─────────────────────────

/** **Test it**, from the card: what the person typed, used for the test and nothing else. */
export const TestAppPartBody = z
  .object({
    conversationId: z.string().max(128).optional(),
    /** Which part, for an app that brings both. */
    part: z.enum(['provider', 'channel']).optional(),
    /** A provider's key. */
    key: z.string().trim().max(4096).optional(),
    /** A chat app's fields. */
    fields: z.record(z.string(), z.string().max(12_000)).default({}),
  })
  .strict();
export type TestAppPartBody = z.infer<typeof TestAppPartBody>;

/** How the live test went, in words for the card. */
export const AppPartTest = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    part: z.enum(['provider', 'channel']),
    /** A provider: its one-line answer, and the model that gave it. A chat app: who the bot is. */
    said: z.string().max(400),
    model: z.string().max(200).optional(),
    /** How long it took, in milliseconds. */
    ms: z.number().int().nonnegative(),
  }),
  z.object({
    ok: z.literal(false),
    part: z.enum(['provider', 'channel']),
    /** What went wrong, and what to do. */
    message: z.string().max(500),
    /** Which box was wrong, for a chat app. */
    field: z.string().max(40).optional(),
  }),
]);
export type AppPartTest = z.infer<typeof AppPartTest>;

/** What the person types into the card for a part, when they press **Add**. */
export const AppPartValues = z
  .object({
    key: z.string().trim().max(4096).optional(),
    fields: z.record(z.string(), z.string().max(12_000)).default({}),
  })
  .strict();
export type AppPartValues = z.infer<typeof AppPartValues>;
