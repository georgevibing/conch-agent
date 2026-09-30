import type { ChannelSecrets } from '@conch/protocol';

import { DISCORD_API, DiscordAdapter } from './discord';
import { SLACK_API, SlackAdapter } from './slack';
import { TELEGRAM_API, TelegramAdapter } from './telegram';
import type { ChannelAdapter } from './types';

/** Where each app's API lives; tests and the mock engine point these at pretend ones. */
export interface ChannelEndpoints {
  telegram?: string;
  discord?: string;
  discordGateway?: string;
  slack?: string;
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
  }
}

/** Slack's keys, checked one at a time while the other is still being fetched. */
export function slackCheckFor(
  parts: { botToken?: string; appToken?: string },
  endpoints: ChannelEndpoints = {},
): SlackAdapter {
  return new SlackAdapter(parts.botToken ?? '', parts.appToken ?? '', endpoints.slack ?? SLACK_API);
}
