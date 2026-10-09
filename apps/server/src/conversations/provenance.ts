/**
 * Where what a chat read came from, in a few words, each place once
 * (ADR 0028, ADR 0058). The taint marks say it the long way ("read things in
 * Yazio content", "Yazio (from a chat that read GitHub and Yazio content)");
 * a card says it the way people would: "GitHub and Yazio content".
 *
 * Written from the marks alone, never by a model: the model read the same
 * work a page could have steered.
 */
import type { TaintSource } from '@conch/protocol';

/** A name a mark gives, and what kind of name it is. */
export interface Named {
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
  // `process_read` marked every command's output this way before 2026-10-09 (ADR 0117); a chat
  // marked so keeps it, said plainly.
  'command output': 'what a command printed',
  'ci logs on github': 'CI logs on GitHub, which others can write to',
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
 * The places, each once, in a phrase: "GitHub and Yazio content",
 * "news.example, Gmail content and 2 more sources". Empty with nothing to name.
 */
export function placesRead(sources: readonly TaintSource[]): string {
  const names = sourceNames(sources);
  if (!names.length) return '';
  const shown = names.length > SHOWN ? names.slice(0, SHOWN - 1) : names;
  const rest = names.length - shown.length;
  // "Yazio and GitHub content": the word goes once, after the last app's name.
  const lastApp = shown.findLastIndex((n) => n.as === 'app');
  const parts = shown.map((n, i) => (i === lastApp ? `${n.text} content` : n.text));
  if (rest) parts.push(`${rest} more ${rest === 1 ? 'source' : 'sources'}`);
  return list(parts);
}

/**
 * The approval card's one quiet line about what the chat read (ADR 0028):
 * "This chat read GitHub and Yazio content. Check this is what you asked for."
 * Someone else's words say so first: they're the likelier steer. With `would` (what the risk
 * policy says this step does, "push code to a remote"), the line says that too, so the card
 * reads as one reason: "This chat read CI logs on GitHub, which others can write to, and this
 * would push code to a remote."
 */
export function cautionFrom(sources: readonly TaintSource[], would?: string): string {
  const people = sources.filter((s) => s.kind === 'person');
  const places = placesRead(sources.filter((s) => s.kind !== 'person'));
  const check = 'Check this is what you asked for.';
  const then = would ? `, and this would ${would}` : '';
  if (people.length) {
    const who = sourceNames(people).map((n) => n.text.replace(/^a message from /, ''));
    const from =
      who.length > SHOWN ? `${who.slice(0, SHOWN - 1).join(', ')} and others` : list(who);
    return `This chat has messages from ${from}${places ? ` and read ${places}` : ''}${then}. ${check}`;
  }
  return `This chat read ${places || 'something from outside'}${then}. ${check}`;
}

/**
 * What the step would do, from a guard's reason ("… So I’m checking before I push code to a
 * remote."), when it says more than that it runs a command. Undefined otherwise.
 */
export function wouldFrom(reason: string): string | undefined {
  const would = /So I’m checking before I (.+?)\.?$/.exec(reason)?.[1];
  return would && !/^run (?:a command|or send input to a command)$/.test(would) ? would : undefined;
}
