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
    color: '#26A5E4',
    minutes: 2,
    available: true,
  },
  {
    id: 'discord',
    name: 'Discord',
    tagline: 'Message your assistant privately, from any device.',
    color: '#5865F2',
    minutes: 4,
    available: true,
  },
  {
    id: 'slack',
    name: 'Slack',
    tagline: 'A private DM with your assistant, in your workspace.',
    color: '#4A154B',
    minutes: 4,
    available: true,
  },
  { id: 'whatsapp', name: 'WhatsApp', tagline: 'Coming soon.', color: '#25D366', available: false },
  { id: 'signal', name: 'Signal', tagline: 'Coming soon.', color: '#3A76F0', available: false },
  { id: 'imessage', name: 'iMessage', tagline: 'Coming soon.', color: '#34DA50', available: false },
  {
    id: 'microsoftteams',
    name: 'Microsoft Teams',
    tagline: 'Coming soon.',
    color: '#6264A7',
    available: false,
  },
  { id: 'matrix', name: 'Matrix', tagline: 'Coming soon.', color: '#0DBD8B', available: false },
];

export const CHANNEL_NAMES: Record<ChannelKind, string> = {
  telegram: 'Telegram',
  discord: 'Discord',
  slack: 'Slack',
};
