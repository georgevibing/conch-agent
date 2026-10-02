/**
 * Channels — reaching your assistant from the chat apps on your phone (ADR 0018).
 *
 * A channel is a bot you own on Telegram, Discord or Slack. Conch connects to
 * it from this computer (no public address needed), and whatever you send it
 * becomes a Conch chat: it answers with everything it can do here, and asks
 * before it acts, with buttons, right in the app.
 *
 * - REST `/api/channels…` to list, check a key, connect, pair, allow people,
 *   repair and disconnect;
 * - `channel.changed` / `channel.deleted` on the main socket.
 *
 * Tokens never appear in these schemas after they're sent: the gateway only
 * ever says who the bot is.
 */
import { z } from 'zod';

import { Id } from './common';

/**
 * The apps Conch can talk through today. WhatsApp and Signal aren't bots:
 * Conch joins your own account as a linked device (ADR 0043).
 */
export const ChannelKind = z.enum(['telegram', 'discord', 'slack', 'whatsapp', 'signal']);
export type ChannelKind = z.infer<typeof ChannelKind>;

/**
 * How the connection is.
 *
 * - `connecting`: starting up, or checking the key;
 * - `online`: connected and listening;
 * - `reconnecting`: the app or the network had a blip; Conch retries by itself (`retryAt`);
 * - `needs-token`: the app stopped accepting the key (it was reset or the bot deleted);
 *   only a person can get a new one;
 * - `conflict`: another program is reading this bot's messages (Telegram allows one);
 * - `off`: you turned it off;
 * - `error`: anything else, with a message and Repair.
 */
export const ChannelState = z.enum([
  'connecting',
  'online',
  'reconnecting',
  'needs-token',
  'conflict',
  'off',
  'error',
]);
export type ChannelState = z.infer<typeof ChannelState>;

export const ChannelHealth = z.object({
  state: ChannelState,
  /** One plain sentence when it isn't simply fine. */
  message: z.string().optional(),
  /** When the next automatic try is (epoch ms), while reconnecting. */
  retryAt: z.number().optional(),
  /** Since when it has been in this state. */
  since: z.number().optional(),
  /** What has to be installed for it to work (a need id, ADR 0016): Signal needs signal-cli. */
  need: z.string().max(64).optional(),
});
export type ChannelHealth = z.infer<typeof ChannelHealth>;

/** Who the bot is, as the app says. */
export const ChannelBot = z.object({
  id: z.string().max(64),
  /** Display name: "Yiotis's Conch". */
  name: z.string().max(200),
  /** `@handle` without the @ (Telegram, Discord). */
  username: z.string().max(100).optional(),
  /** The bot's picture, as a small data: URL (remote images are blocked). */
  avatar: z.string().max(200_000).optional(),
  /** The Slack workspace it lives in. */
  workspace: z.string().max(200).optional(),
  /** Opens a chat with the bot (a t.me link, Slack's app_redirect, a Discord profile). */
  chatUrl: z.string().max(2000).optional(),
  /** Adds the bot to Discord (its invite link). */
  inviteUrl: z.string().max(2000).optional(),
  /** Discord: how many servers it's in (people can only message it from a server they share with it). */
  servers: z.number().int().nonnegative().optional(),
  /** WhatsApp, Signal: the number Conch is linked to, as `+4915123456789`. */
  phone: z.string().max(32).optional(),
});
export type ChannelBot = z.infer<typeof ChannelBot>;

/** Someone who may talk to your assistant here. The first is you. */
export const ChannelPerson = z.object({
  /** Their id in the app (a number on Telegram, a snowflake on Discord, U… on Slack). */
  id: Id,
  name: z.string().max(200),
  username: z.string().max(100).optional(),
  /** When they were let in. */
  since: z.number(),
  lastSeenAt: z.number().optional(),
});
export type ChannelPerson = z.infer<typeof ChannelPerson>;

/** Someone who messaged the bot and isn't let in (yet). */
export const ChannelRequest = z.object({
  id: Id,
  name: z.string().max(200),
  username: z.string().max(100).optional(),
  /** The start of what they said (at most 200 characters). */
  preview: z.string().max(200),
  at: z.number(),
  /** How many messages they sent while waiting. */
  count: z.number().int().positive().default(1),
});
export type ChannelRequest = z.infer<typeof ChannelRequest>;

/** A one-time way to say hello and be recognised as the owner (10 minutes). */
export const ChannelPairing = z.object({
  /** Telegram: a t.me link that carries the code, so pressing Start is enough. */
  link: z.string().max(2000).optional(),
  expiresAt: z.number(),
});
export type ChannelPairing = z.infer<typeof ChannelPairing>;

export const ChannelSettings = z.object({
  /** Send routine results (and their questions) to the people here. */
  notifyRoutines: z.boolean().default(true),
  /**
   * WhatsApp, Signal: what happens when someone else writes to the linked
   * number. `ignore` (the default: it's your own number, so your friends'
   * chats are never read) or `ask` (a number just for your assistant:
   * they get one polite reply and wait for you to let them in).
   */
  others: z.enum(['ignore', 'ask']).optional(),
});
export type ChannelSettings = z.infer<typeof ChannelSettings>;

export const Channel = z.object({
  id: Id,
  kind: ChannelKind,
  enabled: z.boolean(),
  createdAt: z.number(),
  bot: ChannelBot,
  people: z.array(ChannelPerson).default([]),
  requests: z.array(ChannelRequest).default([]),
  /** How many people you turned away (they get no answer). */
  blocked: z.number().int().nonnegative().default(0),
  settings: ChannelSettings.default({ notifyRoutines: true }),
  health: ChannelHealth,
  /** Set while a hello link is waiting to be used. */
  pairing: ChannelPairing.optional(),
  lastMessageAt: z.number().optional(),
});
export type Channel = z.infer<typeof Channel>;

/** A kind of channel, as the page offers it. */
export const ChannelCatalogEntry = z.object({
  id: z.string(),
  name: z.string(),
  /** One plain line: "The easiest: about two minutes." */
  tagline: z.string(),
  /** Brand colour (hex), for the tile. */
  color: z.string(),
  /** Roughly how long setting it up takes, in minutes. */
  minutes: z.number().int().positive().optional(),
  /** False for ones that are coming. */
  available: z.boolean(),
});
export type ChannelCatalogEntry = z.infer<typeof ChannelCatalogEntry>;

export const ChannelList = z.object({
  channels: z.array(Channel),
  catalog: z.array(ChannelCatalogEntry),
});
export type ChannelList = z.infer<typeof ChannelList>;

// Credential shapes, checked on both sides. Pasting more than the key (the whole
// message BotFather sent) is fine: the web app and the gateway both find the key in it.
export const TELEGRAM_TOKEN = /\b(\d{5,16}:[A-Za-z0-9_-]{30,60})\b/;
export const SLACK_BOT_TOKEN = /\b(xoxb-[A-Za-z0-9-]{20,250})\b/;
export const SLACK_APP_TOKEN = /\b(xapp-[A-Za-z0-9-]{20,250})\b/;
// Discord tokens are three base64url parts; the first is the bot's id.
export const DISCORD_TOKEN =
  /\b([A-Za-z0-9_-]{20,40}\.[A-Za-z0-9_-]{4,10}\.[A-Za-z0-9_-]{20,80})\b/;

const secret = z.string().trim().min(1).max(4000);

export const ChannelSecrets = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('telegram'), token: secret }),
  z.object({ kind: z.literal('discord'), token: secret }),
  z.object({ kind: z.literal('slack'), botToken: secret, appToken: secret }),
  // Linked devices: what's kept is where their keys are, not a key (ADR 0043).
  z.object({ kind: z.literal('whatsapp'), session: Id }),
  z.object({ kind: z.literal('signal'), account: z.string().regex(/^\+\d{6,15}$/) }),
]);
export type ChannelSecrets = z.infer<typeof ChannelSecrets>;

/** `POST /api/channels/check`: is this key good, and whose bot is it? Nothing is saved. */
export const CheckChannelBody = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('telegram'), token: secret }),
  z.object({ kind: z.literal('discord'), token: secret }),
  // Either Slack token can be checked on its own while the other is still being fetched.
  z.object({
    kind: z.literal('slack'),
    botToken: secret.optional(),
    appToken: secret.optional(),
  }),
]);
export type CheckChannelBody = z.infer<typeof CheckChannelBody>;

export const ChannelCheck = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    bot: ChannelBot,
    /** Slack: which of the two keys were checked and good. */
    checked: z.array(z.enum(['token', 'botToken', 'appToken'])).default([]),
    /** Slack: the app's id, for links straight to its settings pages. */
    appId: z
      .string()
      .regex(/^A[A-Z0-9]{6,20}$/)
      .optional(),
  }),
  z.object({
    ok: z.literal(false),
    /** Which key is wrong, when there are two. */
    field: z.enum(['token', 'botToken', 'appToken']).optional(),
    /** Plain words: what's wrong and what to do. */
    message: z.string(),
  }),
]);
export type ChannelCheck = z.infer<typeof ChannelCheck>;

export const CreateChannelBody = ChannelSecrets;
export type CreateChannelBody = z.infer<typeof CreateChannelBody>;

export const UpdateChannelBody = z
  .object({ enabled: z.boolean(), settings: ChannelSettings.partial() })
  .partial();
export type UpdateChannelBody = z.infer<typeof UpdateChannelBody>;

/** `PUT /api/channels/:id/token`: a new key for the same bot (after it was reset). */
export const ReplaceChannelTokenBody = ChannelSecrets;
export type ReplaceChannelTokenBody = z.infer<typeof ReplaceChannelTokenBody>;

/** A request answered from the page: let them in, or turn them away for good. */
export const AnswerChannelRequestBody = z.object({ answer: z.enum(['allow', 'block', 'dismiss']) });
export type AnswerChannelRequestBody = z.infer<typeof AnswerChannelRequestBody>;

/** Where a conversation came from, when it started in a channel. */
export const ChannelOrigin = z.object({
  kind: z.literal('channel'),
  channelId: z.string(),
  channel: ChannelKind,
});
export type ChannelOrigin = z.infer<typeof ChannelOrigin>;
