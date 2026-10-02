import type { ChannelSecrets } from '@conch/protocol';

import { DISCORD_API, DiscordAdapter } from './discord';
import { SignalAdapter } from './signal';
import type { SignalDaemon } from './signal-cli';
import { EmailAdapter, type MailEndpoints } from './email';
import { ImessageAdapter, type ImessageOptions } from './imessage';
import { SLACK_API, SlackAdapter } from './slack';
import { TELEGRAM_API, TelegramAdapter } from './telegram';
import type { ChannelAdapter } from './types';
import { type WaConnect, WhatsAppAdapter } from './whatsapp';
import type { WhatsAppSessions } from './whatsapp-sessions';

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
  }
}

/** Slack's keys, checked one at a time while the other is still being fetched. */
export function slackCheckFor(
  parts: { botToken?: string; appToken?: string },
  endpoints: ChannelEndpoints = {},
): SlackAdapter {
  return new SlackAdapter(parts.botToken ?? '', parts.appToken ?? '', endpoints.slack ?? SLACK_API);
}
