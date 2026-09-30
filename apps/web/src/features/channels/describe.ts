import type { Channel, ChannelKind } from '@conch/protocol';
import type { ChannelStateValue } from '@conch/nacre';

import { relativeTime } from '../../lib/time';

/** Each app's name and colour, for the words and the tiles. */
export const APPS: Record<ChannelKind, { name: string; color: string }> = {
  telegram: { name: 'Telegram', color: '#26A5E4' },
  discord: { name: 'Discord', color: '#5865F2' },
  slack: { name: 'Slack', color: '#4A154B' },
};

export const isKind = (value: string | undefined): value is ChannelKind =>
  value === 'telegram' || value === 'discord' || value === 'slack';

/** How a card shows a channel. Connected but nobody has said hello yet is its own state. */
export function channelState(channel: Channel): ChannelStateValue {
  if (!channel.enabled) return 'off';
  if (channel.health.state === 'online' && channel.people.length === 0) return 'hello';
  return channel.health.state;
}

/** States that need a person, shown first. */
export function needsYou(channel: Channel): boolean {
  const state = channelState(channel);
  return (
    state === 'needs-token' ||
    state === 'conflict' ||
    state === 'error' ||
    state === 'hello' ||
    channel.requests.length > 0
  );
}

/** "You and Grace. Last message 5 minutes ago." */
export function channelMeta(channel: Channel, now = Date.now()): string {
  const others = channel.people.slice(1);
  const who =
    others.length === 0
      ? 'Just you'
      : others.length === 1
        ? `You and ${others[0]?.name.split(' ')[0]}`
        : `You and ${others.length} others`;
  return channel.lastMessageAt
    ? `${who}. Last message ${relativeTime(channel.lastMessageAt, now)}`
    : who;
}

/** The sentence a card shows when the channel isn't simply fine. */
export function channelMessage(channel: Channel): string | undefined {
  const state = channelState(channel);
  if (state === 'hello') return `Connected. Say hello from ${APPS[channel.kind].name} to finish.`;
  if (state === 'off') return 'Off. Nobody can reach your assistant here.';
  return channel.health.message;
}

/** The one button a card offers, if any. */
export function channelFix(channel: Channel): string | undefined {
  const state = channelState(channel);
  if (state === 'hello') return 'Say hello';
  if (state === 'needs-token') return 'Paste the new key';
  if (state === 'conflict' || state === 'error') return 'Repair';
  if (channel.requests.length) return 'Review';
  return undefined;
}

/** The bot's handle as people type it (Slack has none worth showing). */
export function handleOf(channel: Channel): string | undefined {
  return channel.kind === 'slack' ? undefined : channel.bot.username;
}
