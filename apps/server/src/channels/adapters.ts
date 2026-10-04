import type { ChannelSecrets } from '@conch/protocol';

import { DISCORD_API, DiscordAdapter } from './discord';
import { SignalAdapter } from './signal';
import type { SignalDaemon } from './signal-cli';
import { EmailAdapter, type MailEndpoints } from './email';
import { ImessageAdapter, type ImessageOptions } from './imessage';
import type { ChannelDoorService } from './door';
import { GoogleChatAdapter } from './googlechat';
import { LineAdapter } from './line';
import { MattermostAdapter } from './mattermost';
import { RocketChatAdapter } from './rocketchat';
import { MatrixAdapter } from './matrix';
import { SLACK_API, SlackAdapter } from './slack';
import { TwilioSmsAdapter } from './sms';
import { TeamsAdapter } from './teams';
import { TELEGRAM_API, TelegramAdapter } from './telegram';
import type { ChannelAdapter } from './types';
import { type WaConnect, WhatsAppAdapter } from './whatsapp';
import type { WhatsAppSessions } from './whatsapp-sessions';
import { WeChatOfficialAdapter, WeComBotAdapter } from './wechat';

/** Where each app's API lives; tests and the mock engine point these at pretend ones. */
export interface ChannelEndpoints {
  telegram?: string;
  discord?: string;
  discordGateway?: string;
  slack?: string;
  /** Linked devices (ADR 0043): where WhatsApp's keys live and how it connects; the signal-cli Conch runs. */
  whatsapp?: { sessions: WhatsAppSessions; connect: WaConnect };
  signal?: SignalDaemon;
  /** The pretend mail server (IMAP and SMTP on this computer). */
  email?: MailEndpoints;
  /** The pretend Messages: its database, its attachments and how it sends. */
  imessage?: Omit<ImessageOptions, 'mode' | 'handle'>;
  /** Teams: Microsoft's sign-in (tokens), Bot Framework's OpenID metadata, and connector hosts allowed besides Microsoft's. */
  teamsLogin?: string;
  teamsOpenId?: string;
  teamsConnectors?: string[];
  /** WeChat: the Official Account API, and WeCom's bot WebSocket. */
  wechat?: string;
  wecom?: string;
  /** Where files may come from besides Tencent's own servers (the pretend WeChat). */
  wechatFiles?: string[];
  /** Twilio's REST API (the pretend Twilio in tests). */
  twilio?: string;
  /** LINE's Messaging API, and where it serves content (the pretend LINE in tests). */
  line?: string;
  lineData?: string;
  /** Google Chat's API, Google's token endpoint, its signing keys and token issuers (the pretend Google in tests). */
  googleChat?: string;
  googleToken?: string;
  googleCerts?: string;
  googleIssuers?: string[];
  /** The public door (Teams, Official Accounts), and where channels keep what they remember. */
  door?: ChannelDoorService;
  home?: string;
}

/** The adapter for a bot's keys. */
export function adapterFor(
  secrets: ChannelSecrets,
  endpoints: ChannelEndpoints = {},
): ChannelAdapter {
  switch (secrets.kind) {
    case 'telegram':
      return new TelegramAdapter(secrets.token, endpoints.telegram ?? TELEGRAM_API);
    case 'discord':
      return new DiscordAdapter(secrets.token, endpoints.discord ?? DISCORD_API);
    case 'slack':
      return new SlackAdapter(secrets.botToken, secrets.appToken, endpoints.slack ?? SLACK_API);
    case 'whatsapp':
      if (!endpoints.whatsapp) throw new Error('WhatsApp isn’t set up in this Conch.');
      return new WhatsAppAdapter(secrets.session, endpoints.whatsapp);
    case 'signal':
      if (!endpoints.signal) throw new Error('Signal isn’t set up in this Conch.');
      return new SignalAdapter(secrets.account, endpoints.signal);
    case 'imessage':
      return new ImessageAdapter({
        ...endpoints.imessage,
        mode: secrets.mode,
        handle: secrets.handle,
      });
    case 'email':
      return new EmailAdapter(secrets, endpoints.email);
    case 'microsoftteams':
      return new TeamsAdapter(secrets, endpoints);
    case 'matrix':
      return new MatrixAdapter(secrets, endpoints);
    case 'wechat':
      return secrets.mode === 'wecom'
        ? new WeComBotAdapter(secrets, endpoints)
        : new WeChatOfficialAdapter(secrets, endpoints);
    case 'sms':
      return new TwilioSmsAdapter(secrets, endpoints);
    case 'mattermost':
      return new MattermostAdapter(secrets);
    case 'line':
      return new LineAdapter(secrets, endpoints);
    case 'rocketchat':
      return new RocketChatAdapter(secrets);
    case 'googlechat':
      return new GoogleChatAdapter(secrets, endpoints);
  }
}

/** Slack's keys, checked one at a time while the other is still being fetched. */
export function slackCheckFor(
  parts: { botToken?: string; appToken?: string },
  endpoints: ChannelEndpoints = {},
): SlackAdapter {
  return new SlackAdapter(parts.botToken ?? '', parts.appToken ?? '', endpoints.slack ?? SLACK_API);
}
