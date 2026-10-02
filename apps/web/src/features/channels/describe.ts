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
  imessage: { name: 'iMessage', color: '#34DA50' },
  email: { name: 'Email', color: '#5B6B7F' },
  microsoftteams: { name: 'Microsoft Teams', color: '#6264A7' },
  matrix: { name: 'Matrix', color: '#0DBD8B' },
  wechat: { name: 'WeChat', color: '#07C160' },
};

/** More words people would type to find each app (⌘K). */
export const APP_WORDS: Partial<Record<string, string>> = {
  whatsapp: 'link qr code linked device scan',
  signal: 'link qr code linked device scan',
  imessage: 'messages text sms apple iphone mac',
  email: 'mail gmail icloud fastmail inbox imap',
  microsoftteams: 'teams microsoft office work school bot',
  matrix: 'element encrypted homeserver matrix.org',
  wechat: '微信 企业微信 wecom weixin 公众号 测试号 official account',
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

/**
 * The account is the person's own (ADR 0043, 0044): their linked WhatsApp or
 * Signal, their iMessage, their email. An answer would come from them, so
 * other people's chats are never read unless they said so.
 */
export const isOwnAccount = (kind: ChannelKind) =>
  isLinkedKind(kind) || kind === 'imessage' || kind === 'email';

/** How a card shows a channel. Connected but nobody has said hello yet is its own state. */
export function channelState(channel: Channel): ChannelStateValue {
  if (!channel.enabled) return 'off';
  if (channel.health.access) return 'access';
  if (channel.health.state === 'online' && channel.people.length === 0) return 'hello';
  return channel.health.state;
}

/** States that need a person, shown first. */
export function needsYou(channel: Channel): boolean {
  const state = channelState(channel);
  return (
    state === 'needs-token' ||
    state === 'conflict' ||
    state === 'access' ||
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
  if (state === 'access')
    return channel.health.access === 'automation' ? 'Allow it' : 'Turn on Full Disk Access';
  if (state === 'needs-token')
    return isLinkedKind(channel.kind)
      ? 'Link again'
      : channel.kind === 'email'
        ? 'Paste a new app password'
        : 'Paste the new key';
  if (state === 'conflict' || state === 'error') return 'Repair';
  if (channel.requests.length) return 'Review';
  return undefined;
}

/**
 * The bot's handle as people type it (Slack, Teams and WeChat have none worth
 * showing; a linked account has a number).
 */
export function handleOf(channel: Channel): string | undefined {
  return channel.kind === 'slack' ||
    channel.kind === 'microsoftteams' ||
    channel.kind === 'wechat' ||
    isLinkedKind(channel.kind)
    ? undefined
    : channel.bot.username;
}

/** Who to write to, in words: "@my_bot", "ada+conch@gmail.com", or the bot's name. */
export function whoOf(channel: Channel): string {
  const handle = handleOf(channel);
  if (handle) return `@${handle}`;
  if (channel.bot.phone) return readablePhone(channel.bot.phone);
  return channel.bot.address ?? channel.bot.name;
}

/** Where the owner talks to their assistant in an account of their own: "in Note to Self". */
export function whereYouTalk(channel: Channel): string {
  if (isLinkedKind(channel.kind)) return `in ${SELF_CHAT[channel.kind]}`;
  if (channel.kind === 'imessage' && channel.bot.address === channel.people[0]?.username)
    return 'in the chat with yourself';
  return `at ${channel.bot.address ?? channel.bot.name}`;
}
