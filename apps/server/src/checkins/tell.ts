/**
 * How a check-in says what it found (ADR 0107): the same few words on a lock
 * screen and in a chat app, always with why you're hearing it. The label is
 * Conch's (from the mail's sender and subject, or the event's title), the note
 * a small model's few words cleaned of links and markup (`cleanNote`), the why
 * your own standing order. Nothing in it is a link a message chose.
 */
import type { ToldThing } from '@conch/protocol';

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

/** Markdown a chat app would read as formatting or a link, said as plain text. */
export function plain(text: string): string {
  return text.replace(/[\\`*_~[\]()<>#|!]/g, (c) => `\\${c}`);
}

export interface TellWords {
  title: string;
  body: string;
  /** With previews off: says only that something came. */
  quiet: string;
  /** For chat apps. */
  markdown: string;
}

export function tellWords(thing: ToldThing): TellWords {
  const what = thing.source === 'calendar' ? `Coming up: ${thing.label}` : thing.label;
  const title = clip(thing.note ?? what, 90);
  const body = clip(thing.note ? `${what} · ${thing.why}` : thing.why, 240);
  return {
    title,
    body,
    quiet: 'Something you asked to hear about came in.',
    markdown: [
      `🔔 **${plain(clip(thing.note ?? what, 160))}**`,
      ...(thing.note ? [plain(clip(what, 200))] : []),
      `_Why you’re hearing this: ${plain(thing.why.replace(/^You asked: /, 'you asked '))}_`,
    ].join('\n'),
  };
}
