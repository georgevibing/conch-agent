/**
 * The words on a "Save how I did this" card (ADR 0058): a short headline the
 * draft's model writes (what the skill would do), and where it was learned,
 * which code writes from the chat's taint marks.
 *
 * Where it was learned is never a model's: the model read the same work a
 * page could have steered, so the one line that says "check the steps" is
 * written here, from the marks alone.
 */
import type { TaintSource } from '@conch/protocol';

/** A name a mark gives, and what kind of name it is. */
interface Named {
  text: string;
  /** `host`: a site; `app`: an app's name ("… content"); `phrase`: already words ("web search results"). */
  as: 'host' | 'app' | 'phrase';
}

const HOST = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;
/** "Yazio content", "Slack messages": the app is the name. */
const KIND_SUFFIX = /\s+(?:content|messages)$/i;
/** Where an app came from, as `sourceName` says it: "Tally (from a chat that read x and y)". */
const FROM = /^(.*?)\s*\(from (.+)\)\s*$/;

/** Marks that are already a phrase, in the card's words. */
const PHRASES: Record<string, string> = {
  'web search results': 'web search results',
  'a web page': 'a web page',
  'pages in the browser': 'pages in the browser',
  'something downloaded': 'a download',
  'document content': 'a document',
  'task results': 'task results',
};

function plain(text: string): string {
  return text
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** One app's or site's name, as people read it. */
function named(raw: string): Named | undefined {
  const text = plain(raw).replace(KIND_SUFFIX, '').trim();
  if (!text) return undefined;
  const phrase = PHRASES[plain(raw).toLowerCase()];
  if (phrase) return { text: phrase, as: 'phrase' };
  if (/^github\.com\//i.test(text) || /^github$/i.test(text)) return { text: 'GitHub', as: 'app' };
  // A site, whichever kind of mark named it ("trains.example").
  if (HOST.test(text)) return { text: text.toLowerCase(), as: 'host' };
  // An integration's id ("github", "notion"): a name starts with a capital.
  const shown = /^[a-z][a-z0-9]*$/.test(text) ? `${text[0]?.toUpperCase()}${text.slice(1)}` : text;
  return { text: shown.slice(0, 60), as: 'app' };
}

/** Every name one mark gives: its own, then the ones it carried in ("from a chat that read …"). */
function namesOf(source: TaintSource): Named[] {
  if (source.kind === 'person')
    return [{ text: `a message from ${plain(source.label).slice(0, 60)}`, as: 'phrase' }];
  const from = FROM.exec(source.label);
  if (!from) return [named(source.label)].filter((n): n is Named => Boolean(n));
  const own = named(from[1] ?? '');
  const where = plain(from[2] ?? '');
  const carried = /^a chat that read /i.test(where)
    ? where
        .replace(/^a chat that read /i, '')
        .split(/,\s*|\s+and\s+/)
        .map((part) => named(part))
    : /^github\.com\//i.test(where)
      ? [named(where)]
      : [];
  return [own, ...carried].filter((n): n is Named => Boolean(n));
}

/**
 * The names a chat's marks give, each once: "Yazio content" and "Yazio (from
 * a chat that read GitHub and Yazio content)" are Yazio and GitHub. A name
 * that comes in two cases keeps the one with capitals ("GitHub", not "github").
 */
export function sourceNames(sources: readonly TaintSource[]): Named[] {
  const seen = new Map<string, Named>();
  for (const source of sources)
    for (const name of namesOf(source)) {
      const key = name.text.toLowerCase();
      const had = seen.get(key);
      if (!had) seen.set(key, name);
      else if (had.text === key && name.text !== key) seen.set(key, { ...had, text: name.text });
    }
  const order: Named['as'][] = ['host', 'app', 'phrase'];
  return [...seen.values()].sort((a, b) => order.indexOf(a.as) - order.indexOf(b.as));
}

const list = (parts: readonly string[]) =>
  parts.length <= 1
    ? (parts[0] ?? '')
    : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) ?? ''}`;

/** At most this many names; the rest are counted. */
const SHOWN = 3;

/**
 * Where a skill was learned, in one short sentence:
 * "Learned from Yazio and GitHub content.", "Learned from trains.example.",
 * "Learned from news.example, Gmail content and 2 more sources."
 */
export function learnedFrom(sources: readonly TaintSource[]): string {
  const names = sourceNames(sources);
  if (!names.length) return 'Learned from something it read outside Conch.';
  const shown = names.length > SHOWN ? names.slice(0, SHOWN - 1) : names;
  const rest = names.length - shown.length;
  // "Yazio and GitHub content": the word goes once, after the last app's name.
  const lastApp = shown.findLastIndex((n) => n.as === 'app');
  const parts = shown.map((n, i) => (i === lastApp ? `${n.text} content` : n.text));
  if (rest) parts.push(`${rest} more ${rest === 1 ? 'source' : 'sources'}`);
  return `Learned from ${list(parts)}.`;
}

// ── The headline ──────────────────────────────────────────────────────────

const HEADLINE_MAX_CHARS = 48;
const HEADLINE_MAX_WORDS = 7;
const WRAP = /^["'“”‘’`*_#\s-]+|["'“”‘’`*_\s]+$/g;
const NOT_WORDS = /https?:\/\/|www\.|[\w.+-]+@[\w-]+\.|[<>{}[\]|\\/$`]|\p{Extended_Pictographic}/u;
const REFUSAL = /\b(?:i can(?:no|')t|i cannot|i'm sorry|as an ai|i'm unable|skill)\b/i;

/**
 * A model's headline for the card, or undefined when it isn't one: a short
 * phrase in plain words that says what the skill would do ("Log a meal in
 * Yazio"). Nothing secret, no address or path, nothing particular to this one
 * time, one line.
 */
export function cleanHeadline(
  raw: string | undefined,
  context: {
    specifics?: readonly string[];
    redact?: (text: string) => string;
    secret?: RegExp;
  } = {},
): string | undefined {
  if (!raw || /[\r\n]/.test(raw.trim())) return undefined;
  const text = plain(raw)
    .replace(WRAP, '')
    .replace(/[.!?:;,。]+$/u, '')
    .trim();
  if (text.length < 3 || text.length > HEADLINE_MAX_CHARS) return undefined;
  if (text.split(' ').length > HEADLINE_MAX_WORDS) return undefined;
  if (!/^\p{L}/u.test(text) || NOT_WORDS.test(text) || REFUSAL.test(text.replace(/[‘’ʼ]/g, "'")))
    return undefined;
  if (context.secret?.test(text)) return undefined;
  if (context.redact && context.redact(text) !== text) return undefined;
  if (context.specifics?.some((s) => s.length >= 4 && text.includes(s))) return undefined;
  return `${text.charAt(0).toLocaleUpperCase()}${text.slice(1)}`;
}
