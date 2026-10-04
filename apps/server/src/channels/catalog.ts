/**
 * The chat apps your assistant can be reached from, in the words a person
 * would use. Adding a channel is an entry here plus an adapter (AGENTS.md
 * § Adding a channel); the documentation's channel pages are generated from
 * this list (`apps/docs/reference`).
 */
import type { ChannelCatalogEntry, ChannelKind } from '@conch/protocol';

export const CHANNEL_CATALOG: ChannelCatalogEntry[] = [
  {
    id: 'telegram',
    name: 'Telegram',
    tagline: 'The easiest. Make a bot, paste its key, say hello.',
    short: 'The easiest: a bot of your own',
    color: '#26A5E4',
    minutes: 2,
    available: true,
    groups: true,
  },
  {
    id: 'discord',
    name: 'Discord',
    tagline: 'Message your assistant privately, from any device.',
    short: 'A private bot of your own',
    color: '#5865F2',
    minutes: 4,
    available: true,
    groups: true,
  },
  {
    id: 'slack',
    name: 'Slack',
    tagline: 'A private DM with your assistant, in your workspace.',
    short: 'A DM in your workspace',
    color: '#4A154B',
    minutes: 4,
    available: true,
    groups: true,
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    tagline: 'Your own WhatsApp. Scan a code, then message yourself.',
    short: 'Message yourself',
    color: '#25D366',
    minutes: 1,
    available: true,
  },
  {
    id: 'signal',
    name: 'Signal',
    tagline: 'Your own Signal. Scan a code, then use Note to Self.',
    short: 'Note to Self, on your phone',
    color: '#3A76F0',
    minutes: 2,
    available: true,
  },
  {
    id: 'imessage',
    name: 'iMessage',
    tagline: 'Text yourself from your iPhone. Nothing to make.',
    short: 'Text yourself',
    color: '#34DA50',
    minutes: 1,
    available: true,
  },
  {
    id: 'email',
    name: 'Email',
    tagline: 'Write to yourself+conch, from any mail app.',
    short: 'Write to yourself',
    color: '#5B6B7F',
    minutes: 3,
    available: true,
  },
  {
    id: 'microsoftteams',
    name: 'Microsoft Teams',
    tagline: 'A private chat with your assistant, at work.',
    short: 'A private chat at work',
    color: '#6264A7',
    minutes: 8,
    available: true,
  },
  {
    id: 'matrix',
    name: 'Matrix',
    tagline: 'Encrypted, on the homeserver you choose.',
    short: 'Encrypted, on your homeserver',
    color: '#0DBD8B',
    minutes: 3,
    available: true,
  },
  {
    id: 'wechat',
    name: 'WeChat',
    tagline: 'Through a WeCom bot, or your own Official Account. 微信',
    short: 'WeCom or an Official Account',
    color: '#07C160',
    minutes: 5,
    available: true,
  },
  {
    id: 'sms',
    name: 'SMS',
    tagline: 'A phone number of its own. Text it from any phone.',
    short: 'Text it from any phone',
    color: '#F22F46',
    minutes: 5,
    available: true,
  },
  {
    id: 'mattermost',
    name: 'Mattermost',
    tagline: 'A bot on your own Mattermost server. No public address.',
    short: 'A bot on your server',
    color: '#1E325C',
    minutes: 3,
    available: true,
    groups: true,
  },
];

export const CHANNEL_NAMES: Record<ChannelKind, string> = {
  telegram: 'Telegram',
  discord: 'Discord',
  slack: 'Slack',
  whatsapp: 'WhatsApp',
  signal: 'Signal',
  imessage: 'iMessage',
  email: 'Email',
  microsoftteams: 'Microsoft Teams',
  matrix: 'Matrix',
  wechat: 'WeChat',
  sms: 'SMS',
  mattermost: 'Mattermost',
};

/** Channels that only work on some systems: elsewhere the tile says so and can't be chosen. */
const ONLY_ON: Partial<Record<string, { platforms: NodeJS.Platform[]; tagline: string }>> = {
  imessage: { platforms: ['darwin'], tagline: 'Only on a Mac.' },
};

/** The catalog as this computer can offer it. */
export function catalogFor(platform: NodeJS.Platform): ChannelCatalogEntry[] {
  return CHANNEL_CATALOG.map((entry) => {
    const only = ONLY_ON[entry.id];
    return only && !only.platforms.includes(platform)
      ? { ...entry, tagline: only.tagline, available: false }
      : entry;
  });
}
