/**
 * What Slack's reads found, drawn as messages (ADR 0060 §7): a channel's
 * catch-up or a search. The model still reads the tools' own text. Slack's
 * markup (`<@U123>`, `<https://…|label>`, `&amp;`) becomes the plain words a
 * person would see in Slack, and only Slack's own links are kept.
 */
import type { ChatMessageItem, ToolView } from '@conch/protocol';

/** What the read tools hand the model, as far as a view needs it. */
interface ReadMessage {
  from?: unknown;
  text?: unknown;
  time?: unknown;
  link?: unknown;
  channel?: { name?: unknown };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const clip = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

/** Only Slack's own links. */
const slackLink = (value: unknown): string | undefined =>
  typeof value === 'string' &&
  value.length <= 2000 &&
  /^https:\/\/[a-z0-9-]+(?:\.enterprise)?\.slack\.com\//i.test(value)
    ? value
    : undefined;

/**
 * Slack's message markup as plain words: people and channels by name, links
 * by their label, and the three escaped characters back as themselves.
 * `person` names a user id that came without a label, when it's known.
 */
export function slackPlain(text: string, person?: (id: string) => string | undefined): string {
  return text
    .replace(/<([^<>]*)>/g, (_, inner: string) => {
      const [target = '', label] = inner.split('|', 2);
      if (target.startsWith('@')) {
        const name = label ?? person?.(target.slice(1));
        return name ? `@${name.replace(/^@/, '')}` : '@someone';
      }
      if (target.startsWith('#')) return label ? `#${label}` : '#a channel';
      if (target.startsWith('!')) {
        const special = /^!(here|channel|everyone)\b/.exec(target)?.[1];
        if (special) return `@${special}`;
        return label ?? '';
      }
      return label ?? target.replace(/^mailto:/, '');
    })
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function item(m: ReadMessage, person?: (id: string) => string | undefined) {
  if (typeof m.time !== 'string' || Number.isNaN(Date.parse(m.time))) return undefined;
  const author = typeof m.from === 'string' && m.from.trim() ? m.from.trim() : 'someone';
  const text = typeof m.text === 'string' ? slackPlain(m.text, person) : '';
  const url = slackLink(m.link);
  const out: ChatMessageItem = {
    author: clip(author, 200),
    text: clip(text, 2000),
    at: m.time,
    ...(url && { url }),
  };
  return out;
}

const place = (name: unknown) =>
  typeof name === 'string' && name.trim()
    ? clip(`#${name.trim().replace(/^#/, '')}`, 120)
    : undefined;

/** A channel's catch-up (`slack_read_channel`): its newest messages, oldest first. */
export function channelView(
  result: unknown,
  person?: (id: string) => string | undefined,
): ToolView | undefined {
  if (!isRecord(result) || !Array.isArray(result.messages)) return undefined;
  const items = (result.messages as ReadMessage[])
    .map((m) => (isRecord(m) ? item(m, person) : undefined))
    .filter((m): m is ChatMessageItem => Boolean(m))
    .slice(-30);
  const where = isRecord(result.channel) ? place(result.channel.name) : undefined;
  return { kind: 'messages', ...(where && { place: where }), items };
}

/** A search (`slack_search`): the matches, with the channel when they share one. */
export function searchView(
  result: unknown,
  person?: (id: string) => string | undefined,
): ToolView | undefined {
  if (!isRecord(result) || !Array.isArray(result.matches)) return undefined;
  const matches = (result.matches as ReadMessage[]).filter(isRecord);
  const items = matches
    .map((m) => item(m, person))
    .filter((m): m is ChatMessageItem => Boolean(m))
    .slice(0, 30);
  const channels = new Set(matches.map((m) => (isRecord(m.channel) ? m.channel.name : undefined)));
  const [only] = channels;
  const where = channels.size === 1 ? place(only) : undefined;
  return { kind: 'messages', ...(where && { place: where }), items };
}
