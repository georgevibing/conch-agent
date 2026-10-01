/**
 * Conch in your pocket (ADR 0027): a secure address for your phone, Conch as
 * an installed app, notifications, and voice.
 */
import { z } from 'zod';

/**
 * Your phone's secure address, over Tailscale: where it stands, and the one
 * step only a person can take when there is one.
 */
export const PhoneAddress = z.object({
  state: z.enum([
    /** Tailscale isn't on this computer. */
    'missing',
    /** Installed, but not running (the app is closed). */
    'stopped',
    /** Running, and needs you to sign in. */
    'signed-out',
    /** Signed in; the secure address isn't on yet. */
    'off',
    /** `https://<name>` reaches Conch from your own devices. */
    'ready',
  ]),
  /** This computer's tailnet name: `mac.tail1234.ts.net`. */
  name: z.string().optional(),
  url: z.string().optional(),
  /** Turning on, waiting for something (an OK on Tailscale's page). */
  waiting: z.boolean().optional(),
  problem: z
    .object({
      kind: z.enum(['enable-https', 'permission', 'other']),
      message: z.string(),
      /** A page to open (Tailscale's own). */
      url: z.string().optional(),
      /** Something only a person can run. */
      command: z.string().optional(),
    })
    .optional(),
});
export type PhoneAddress = z.infer<typeof PhoneAddress>;

// ── Notifications (Web Push) ────────────────────────────────────────────────

/** What a device can be told about. */
export const PushTopic = z.enum([
  /** The assistant needs your OK to go on. */
  'approvals',
  /** An answer finished while you were away. */
  'replies',
  /** A routine ran, or needs you. */
  'routines',
  /** A new device is waiting to be approved (ADR 0024). */
  'devices',
]);
export type PushTopic = z.infer<typeof PushTopic>;

export const PushPrefs = z.object({
  approvals: z.boolean().default(true),
  replies: z.boolean().default(true),
  routines: z.boolean().default(true),
  devices: z.boolean().default(true),
  /** Say what it's about ("Run `npm test`"), or only that something needs you. */
  previews: z.boolean().default(true),
});
export type PushPrefs = z.infer<typeof PushPrefs>;

/** Some of a device's choices; what's left out stays as it was. */
export const PushPrefsPatch = z.object({
  approvals: z.boolean().optional(),
  replies: z.boolean().optional(),
  routines: z.boolean().optional(),
  devices: z.boolean().optional(),
  previews: z.boolean().optional(),
});
export type PushPrefsPatch = z.infer<typeof PushPrefsPatch>;

/** What a browser's `PushSubscription.toJSON()` gives. */
export const PushSubscriptionJson = z.object({
  endpoint: z.url().max(2048),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{16,32}$/),
  }),
});
export type PushSubscriptionJson = z.infer<typeof PushSubscriptionJson>;

export const PushDevice = z.object({
  id: z.string(),
  /** "iPhone · Safari", from the device it belongs to. */
  name: z.string(),
  /** It's the device asking. */
  current: z.boolean(),
  createdAt: z.number(),
  lastSentAt: z.number().optional(),
  /** The last push didn't arrive: one sentence. */
  problem: z.string().optional(),
  prefs: PushPrefs,
});
export type PushDevice = z.infer<typeof PushDevice>;

export const PushStatus = z.object({
  /** The `applicationServerKey` for `pushManager.subscribe`. */
  publicKey: z.string(),
  devices: z.array(PushDevice),
});
export type PushStatus = z.infer<typeof PushStatus>;

export const SubscribePushBody = z.object({
  subscription: PushSubscriptionJson,
  prefs: PushPrefsPatch.optional(),
});
export const RenewPushBody = z.object({
  old: z.string().max(2048).optional(),
  subscription: PushSubscriptionJson,
});
export const UpdatePushBody = z.object({ prefs: PushPrefsPatch });
export const PushAnswerBody = z.object({
  conversationId: z.string().max(128),
  permissionId: z.string().max(128),
});

// ── Voice ───────────────────────────────────────────────────────────────────

/** Private dictation: whisper.cpp on this computer, and its speech model. */
export const VoiceStatus = z.object({
  private: z.discriminatedUnion('state', [
    /** whisper.cpp isn't here (the `whisper` need gets it). */
    z.object({ state: z.literal('missing') }),
    /** It's here; its speech model isn't yet. */
    z.object({
      state: z.literal('model-missing'),
      bytes: z.number(),
      problem: z.string().optional(),
    }),
    z.object({ state: z.literal('downloading'), done: z.number(), total: z.number() }),
    z.object({ state: z.literal('ready') }),
  ]),
});
export type VoiceStatus = z.infer<typeof VoiceStatus>;

export const Transcript = z.object({ text: z.string() });
export type Transcript = z.infer<typeof Transcript>;
