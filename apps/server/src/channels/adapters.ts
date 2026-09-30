import type { ChannelSecrets } from '@conch/protocol';

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
    default:
      throw new Error(`${secrets.kind} isn't available yet.`);
  }
}
