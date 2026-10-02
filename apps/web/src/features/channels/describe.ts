import type { Channel, ChannelKind } from '@conch/protocol';
import type { ChannelStateValue } from '@conch/nacre';

import { relativeTime } from '../../lib/time';

/** Each app's name and colour, for the words and the tiles. */
export const APPS: Record<ChannelKind, { name: string; color: string }> = {
  telegram: { name: 'Telegram', color: '#26A5E4' },
  discord: { name: 'Discord', color: '#5865F2' },
  slack: { name: 'Slack', color: '#4A154B' },
  whatsapp: { name: 'WhatsApp', color: '#25D366' },
  signal: { name: 'Signal', color: '#3A76F0' },
};

export const isKind = (value: string | undefined): value is ChannelKind =>
  value !== undefined && value in APPS;

/** WhatsApp and Signal: your own account, linked by QR code (ADR 0043), not a bot. */
export const isLinkedKind = (kind: ChannelKind): kind is 'whatsapp' | 'signal' =>
  kind === 'whatsapp' || kind === 'signal';

/** Where you talk to your assistant in a linked account. */
export const SELF_CHAT: Record<'whatsapp' | 'signal', string> = {
  whatsapp: 'Message yourself',
  signal: 'Note to Self',
};

/** "+15550001111" → "+1 555 000 1111"-ish: groups of digits a person can read. */
export function readablePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8) return phone;
  const country = digits.length > 10 ? digits.slice(0, digits.length - 10) : '';
  const rest = digits.slice(country.length);
  return `+${country}${country ? ' ' : ''}${rest.slice(0, 3)} ${rest.slice(3, 6)} ${rest.slice(6)}`.trim();
}

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
  if (state === 'needs-token')
    return isLinkedKind(channel.kind) ? 'Link again' : 'Paste the new key';
  if (state === 'conflict' || state === 'error') return 'Repair';
  if (channel.requests.length) return 'Review';
  return undefined;
}

/** The bot's handle as people type it (Slack has none worth showing; a linked account has a number). */
export function handleOf(channel: Channel): string | undefined {
  return channel.kind === 'slack' || isLinkedKind(channel.kind) ? undefined : channel.bot.username;
}
