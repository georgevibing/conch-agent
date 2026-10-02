/**
 * Channels — reaching your assistant from the chat apps on your phone (ADR 0018).
 *
 * A channel is a bot you own on Telegram, Discord, Slack, Microsoft Teams,
 * Matrix or WeChat. Conch connects to it from this computer (no public
 * address needed), except for Teams and WeChat, which only deliver to a web
 * address: those come in through the public door (ADR 0045). Whatever you send it
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
 * Conch joins your own account as a linked device (ADR 0043). iMessage and
 * email answer through accounts that are already yours, too (ADR 0044).
 * Microsoft Teams, Matrix and WeChat are bots again (ADR 0045).
 */
export const ChannelKind = z.enum([
  'telegram',
  'discord',
  'slack',
  'whatsapp',
  'signal',
  'imessage',
  'email',
  'microsoftteams',
  'matrix',
  'wechat',
]);
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
  /**
   * A switch only you can turn on in System Settings (iMessage): reading
   * Messages needs Full Disk Access, and sending needs Automation. Conch
   * notices by itself when it's on.
   */
  access: z.enum(['full-disk-access', 'automation']).optional(),
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
  /** iMessage and email: the address you write to (`you+conch@gmail.com`, your own Apple ID). */
  address: z.string().max(320).optional(),
  /** WeChat: which kind of account it is (an Official Account, or a WeCom bot). */
  account: z.enum(['official', 'wecom']).optional(),
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

/**
 * Teams and WeChat only deliver messages to a public web address (ADR 0045).
 * Conch serves one for each such channel through its public door; this says
 * what to paste in the app's settings, and whether the app has been heard
 * from there yet. The WeChat token and key are not here: they're read once,
 * with `GET /api/channels/:id/hook`.
 */
export const ChannelHook = z.object({
  /** The full address to paste (unset while the door has no public address). */
  url: z.string().max(2000).optional(),
  /** When the app last delivered something here that checked out. */
  heardAt: z.number().optional(),
});
export type ChannelHook = z.infer<typeof ChannelHook>;

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
  /** Teams and WeChat: the web address their servers deliver messages to (ADR 0045). */
  hook: ChannelHook.optional(),
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
const short = z.string().trim().max(300);
/** Made by Conch (never sent by the page): the unguessable part of a channel's web address. */
const hookId = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);

/** Which box a problem is about, when a channel has several. */
export const ChannelField = z.enum([
  'token',
  'botToken',
  'appToken',
  'appId',
  'appPassword',
  'tenantId',
  'homeserver',
  'user',
  'password',
  'address',
  'server',
  'accessToken',
  'secret',
]);
export type ChannelField = z.infer<typeof ChannelField>;

// A Teams bot's id is a GUID; an Official Account's AppID is `wx` and 16 hex digits.
export const TEAMS_APP_ID = /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i;
export const WECHAT_APP_ID = /\b(wx[0-9a-f]{16})\b/;

const teams = {
  kind: z.literal('microsoftteams'),
  /** The bot's Microsoft App ID. */
  appId: secret,
  /** A client secret of the bot's app registration. */
  appPassword: secret,
  /** The directory (tenant) id, for a single-tenant bot. */
  tenantId: short.optional(),
  hookId: hookId.optional(),
};

/**
 * A Matrix account for the assistant. The person gives a password or an
 * access token; Conch keeps only an access token of its own session (a
 * password is used once, to sign in, and never stored).
 */
const matrix = {
  kind: z.literal('matrix'),
  /** The homeserver (`matrix.org`), or empty when the user id names it. */
  homeserver: short,
  /** `@assistant:matrix.org`, or just `assistant`. */
  user: short.optional(),
  password: secret.optional(),
  accessToken: secret.optional(),
  /** Kept by Conch: its own session, and the key to its encryption store. */
  deviceId: short.optional(),
  storeKey: short.optional(),
};

/**
 * WeChat, two official ways (ADR 0045):
 *
 * - `wecom`: a WeCom (企业微信) AI bot, over its long connection: Conch
 *   dials out, so no public address is needed. `appId` is its Bot ID.
 * - `official`: an Official Account (公众号, or its free test account 测试号)
 *   through the public door. `token` and `aesKey` are what WeChat signs and
 *   encrypts messages with; Conch makes them, and the person pastes them in.
 */
const wechat = {
  kind: z.literal('wechat'),
  mode: z.enum(['wecom', 'official']),
  /** The Bot ID (WeCom), or the AppID (`wx…`). */
  appId: secret,
  /** The bot's Secret, or the account's AppSecret. */
  secret,
  token: short.optional(),
  aesKey: short.optional(),
  hookId: hookId.optional(),
};

/**
 * Mail services Conch knows the settings of (ADR 0044). `other` takes the
 * server names by hand.
 */
export const MailProvider = z.enum(['gmail', 'icloud', 'fastmail', 'outlook', 'other']);
export type MailProvider = z.infer<typeof MailProvider>;

const host = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]([a-z0-9-]{0,62}\.)+[a-z]{2,63}$/, 'That isn’t a server name.');

/** An email account Conch reads (IMAP) and answers from (SMTP). */
const EmailSecrets = z.object({
  kind: z.literal('email'),
  provider: MailProvider,
  address: z.email().max(254),
  /** An app password, never your account's own password. */
  password: secret,
  /** Only for `other`: where its mail lives. Both always use TLS. */
  server: z
    .object({
      imapHost: host,
      imapPort: z.number().int().min(1).max(65_535).default(993),
      smtpHost: host,
      smtpPort: z.number().int().min(1).max(65_535).default(465),
    })
    .optional(),
});

/**
 * iMessage on this Mac (ADR 0044): `self` is you texting yourself (the Mac
 * shares your Apple ID); `account` is the Mac signed in to an Apple ID of its
 * own that people text. Nothing in it is secret: the Mac already has the account.
 */
const ImessageSecrets = z.object({
  kind: z.literal('imessage'),
  mode: z.enum(['self', 'account']),
  /** The address Messages uses on this Mac: a phone number or an Apple ID email. */
  handle: z.string().trim().min(3).max(254),
});

export const ChannelSecrets = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('telegram'), token: secret }),
  z.object({ kind: z.literal('discord'), token: secret }),
  z.object({ kind: z.literal('slack'), botToken: secret, appToken: secret }),
  // Linked devices: what's kept is where their keys are, not a key (ADR 0043).
  z.object({ kind: z.literal('whatsapp'), session: Id }),
  z.object({ kind: z.literal('signal'), account: z.string().regex(/^\+\d{6,15}$/) }),
  ImessageSecrets,
  EmailSecrets,
  z.object(teams),
  z.object(matrix),
  z.object(wechat),
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
  ImessageSecrets,
  EmailSecrets,
  // The others are checked as far as what's there so far allows.
  z.object({ ...teams, appId: secret.optional(), appPassword: secret.optional() }),
  z.object(matrix),
  z.object({ ...wechat, appId: secret.optional(), secret: secret.optional() }),
]);
export type CheckChannelBody = z.infer<typeof CheckChannelBody>;

export const ChannelCheck = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    bot: ChannelBot,
    /** Slack: which of the two keys were checked and good. */
    checked: z.array(ChannelField).default([]),
    /** Slack: the app's id, for links straight to its settings pages. */
    appId: z
      .string()
      .regex(/^A[A-Z0-9]{6,20}$/)
      .optional(),
  }),
  z.object({
    ok: z.literal(false),
    /** Which key is wrong, when there are several. */
    field: ChannelField.optional(),
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

/**
 * `PUT /api/channels/:id/token`: a new key for the same bot (after it was
 * reset). Email can send only the new app password: the rest stays as it was.
 */
export const ReplaceChannelTokenBody = z.union([
  ChannelSecrets,
  z.object({ kind: z.literal('email'), password: secret }),
]);
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

/**
 * `GET /api/channels/imessage`: what connecting iMessage on this Mac would
 * use, read from Messages itself so nobody types an address.
 *
 * - `access`: `ready` (Conch can read Messages), `full-disk-access` (macOS
 *   hides it until you turn that on for `app`), `no-messages` (Messages was
 *   never set up here), `not-mac`.
 * - `handles`: the addresses this Mac's Messages sends from, most used first.
 */
export const ImessageSetup = z.object({
  access: z.enum(['ready', 'full-disk-access', 'no-messages', 'not-mac']),
  handles: z.array(z.string().max(254)).max(20).default([]),
  /** The app that needs Full Disk Access: Terminal, iTerm, Conch, node… */
  app: z.string().max(100).optional(),
});
export type ImessageSetup = z.infer<typeof ImessageSetup>;

/** `POST /api/channels/imessage/open`: open the System Settings page (or Messages) to fix it. */
export const OpenImessageBody = z.object({
  place: z.enum(['full-disk-access', 'automation', 'messages', 'show-app']),
});
export type OpenImessageBody = z.infer<typeof OpenImessageBody>;

/**
 * The public door (ADR 0045): the one way in from the internet, for the apps
 * that only deliver messages to a web address (Teams, WeChat). It serves those
 * channels' addresses and nothing else, on its own port, and every delivery
 * must carry the app's own signature.
 *
 * - `off`: no public address (nothing from the internet reaches Conch);
 * - `starting`: turning on (Tailscale may be waiting for an OK on its page);
 * - `ready`: `url` reaches the door from the internet;
 * - `needs-you`: one step only a person can take (`problem`);
 * - `error`: it was on and stopped working (Repair tries again).
 */
export const ChannelDoor = z.object({
  state: z.enum(['off', 'starting', 'ready', 'needs-you', 'error']),
  /** How the internet reaches it: Tailscale Funnel, or an address of your own (a proxy you run). */
  via: z.enum(['tailscale', 'own']).optional(),
  /** The public base address, `https://mac.tail1234.ts.net:8443/conch`. */
  url: z.string().max(2000).optional(),
  /** Which channels use it. */
  apps: z.array(ChannelKind).default([]),
  /** When it last answered a check from the outside. */
  checkedAt: z.number().optional(),
  message: z.string().optional(),
  problem: z
    .object({
      kind: z.enum(['need', 'open', 'command', 'other']),
      message: z.string(),
      /** `need`: what to install (ADR 0016). */
      need: z.string().optional(),
      url: z.string().optional(),
      command: z.string().optional(),
    })
    .optional(),
});
export type ChannelDoor = z.infer<typeof ChannelDoor>;

/** `PUT /api/channels/door`: use an address of your own, which forwards to the door's port. */
export const SetChannelDoorBody = z.object({ url: z.string().trim().min(1).max(500) });
export type SetChannelDoorBody = z.infer<typeof SetChannelDoorBody>;

/** `GET /api/channels/:id/hook`: what to paste in WeChat's server settings (read once, while setting up). */
export const ChannelHookSecrets = z.object({
  url: z.string().optional(),
  token: z.string().optional(),
  aesKey: z.string().optional(),
});
export type ChannelHookSecrets = z.infer<typeof ChannelHookSecrets>;
