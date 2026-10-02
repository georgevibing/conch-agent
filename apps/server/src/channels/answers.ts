/**
 * Buttons for apps that have none (iMessage, email): the question says which
 * word to reply with, and a reply that is only that word presses the button.
 *
 * Kept narrow on purpose, so an ordinary answer never presses anything by
 * accident: only a reply that is just one of the words (a full stop or an
 * emoji around it is fine) counts, and only while the question is open.
 */
import { createHash } from 'node:crypto';

import type { ChannelButton } from './types';

/** The words for each kind of button Conch shows (Allow, Always in this chat, Don't allow). */
const WORDS: { test: (b: ChannelButton) => boolean; say: string; words: string[] }[] = [
  {
    test: (b) => /^always/i.test(b.label),
    say: 'always',
    words: ['always', 'always allow', 'allow always'],
  },
  {
    test: (b) => b.style === 'danger' || /^(don|do not|no|deny)/i.test(b.label),
    say: 'no',
    words: ['no', 'n', 'nope', 'deny', 'don’t', "don't", 'dont', 'don’t allow', "don't allow"],
  },
  {
    test: (b) => b.style === 'primary' || /^allow/i.test(b.label),
    say: 'yes',
    words: ['yes', 'y', 'yep', 'yeah', 'ok', 'okay', 'allow', 'sure', '👍', '✅'],
  },
];

export interface ReplyChoice {
  /** The word the question asks for. */
  say: string;
  label: string;
  data: string;
  words: string[];
}

/** What each button becomes as a reply. Buttons with no word are left out. */
export function replyChoices(buttons: ChannelButton[]): ReplyChoice[] {
  const out: ReplyChoice[] = [];
  for (const button of buttons) {
    const kind = WORDS.find((w) => w.test(button));
    if (!kind || out.some((c) => c.say === kind.say)) continue;
    out.push({ say: kind.say, label: button.label, data: button.data, words: kind.words });
  }
  return out;
}

/** The line under a question: “Reply yes to allow it, always for the rest of this chat, or no.” */
export function replyHint(choices: ReplyChoice[]): string {
  const said = choices.map((c) =>
    c.say === 'yes'
      ? '**yes** to allow it'
      : c.say === 'always'
        ? '**always** to allow it for the rest of this chat'
        : '**no**',
  );
  if (!said.length) return '';
  if (said.length === 1) return `Reply ${said[0]}.`;
  return `Reply ${said.slice(0, -1).join(', ')}${said.length > 2 ? ',' : ''} or ${said.at(-1)}.`;
}

/** The button a reply presses, if the reply is just one of the words. */
export function matchReply(text: string, choices: ReplyChoice[]): ReplyChoice | undefined {
  const said = text
    .trim()
    .toLowerCase()
    .replace(/[.!\s]+$/u, '')
    .replace(/^[\s]+/u, '')
    .replace(/\s+/g, ' ');
  if (!said || said.length > 20) return undefined;
  return choices.find((c) => c.words.includes(said));
}

/**
 * An address (an email, a phone number) as a Conch id (`Id`: letters, digits,
 * `_` and `-`). Reversible, so a reply can find its way back without a table;
 * an address too long for that gets a hash, and the address travels in the
 * person's `username`.
 */
export function handleId(prefix: 'm' | 'i', handle: string): string {
  const encoded = Buffer.from(normalHandle(handle)).toString('base64url');
  if (encoded.length <= 120) return `${prefix}${encoded}`;
  return `${prefix}h${createHash('sha256').update(normalHandle(handle)).digest('hex').slice(0, 40)}`;
}

/** The address behind `handleId`, or undefined for a hashed one. */
export function handleOf(id: string): string | undefined {
  if (!/^[mi][A-Za-z0-9_-]+$/.test(id) || /^[mi]h[0-9a-f]{40}$/.test(id)) return undefined;
  const decoded = Buffer.from(id.slice(1), 'base64url').toString('utf8');
  return decoded && handleId(id[0] as 'm' | 'i', decoded) === id ? decoded : undefined;
}

/** Emails compare without case; phone numbers without spaces, dashes or brackets. */
export function normalHandle(handle: string): string {
  const trimmed = handle.trim();
  if (trimmed.includes('@')) return trimmed.toLowerCase();
  return trimmed.replace(/[\s().-]/g, '');
}
