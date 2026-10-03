/**
 * Cues: how Conch tells that a message is about one of the catalog's apps, so
 * the chat can offer to connect it (connect-from-chat).
 *
 * A false suggestion is worse than none, so cues only match real intent: the
 * name written as a name ("…in Linear this week"), or next to words that only
 * go with the app ("Linear tickets", "Notion page", "Stripe customers"). What
 * means something else ("linear algebra", "the notion of", "slack in the
 * rope") is blanked out first. Code, email addresses and file names are never
 * read; links count only when they're the app's own addresses.
 */

export interface Cues {
  /** Phrases that only mean the app. Tried on the words, with code, links and addresses removed. */
  match: RegExp[];
  /** Phrases that mean something else ("linear algebra"), blanked out before `match` is tried. */
  not?: RegExp[];
  /** The app's own addresses (`linear.app/…/issue/…`). */
  links?: RegExp[];
}

/** Only the start of a long message is read: past that it's pasted material. */
const MAX_CHARS = 4000;

const CODE = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g;
const LINK = /\b(?:https?:\/\/)?(?:[\w-]+\.)+[a-z]{2,}(?::\d+)?(?:\/[^\s<>"'`)\]]*)?/gi;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
/** A web address has a scheme, or a path, or ends in a common web suffix. */
const WEBLIKE = /^https?:\/\/|\/|\.(?:com|app|so|site|io|net|dev|org|co|ai|local)(?::\d+)?$/i;
const FILE =
  /[\w@./-]*\.(?:jsonc?|ya?ml|toml|tsx?|jsx?|mjs|cjs|mdx?|txt|env|lock|py|rb|go|rs|java|kt|swift|css|scss|html?|sh|ps1|sql|csv|xml)\b/gi;

/**
 * Asking which app to pick, not asking an app for something: no suggestion at
 * all ("Linear vs Jira?", "should we switch to Notion?").
 */
const CHOOSING =
  /\b(?:vs\.?|versus|compared\s+(?:to|with)|pros\s+and\s+cons|alternatives?\s+(?:to|for)|(?:better|worse)\s+than|switch(?:ing|ed)?\s+(?:from|to|over)|migrat\w*\s+(?:away\s+)?from|should\s+(?:i|we)\s+(?:use|try|pick|choose|get|buy|switch))\b/i;

/** "We don't use Linear", "instead of Notion": the app named is the one they aren't asking about. */
const NEGATED =
  /\b(?:instead\s+of|rather\s+than|(?:don['’]?t|doesn['’]?t|didn['’]?t|do\s+not|does\s+not|never|no\s+longer|not|stopped|quit)\s+(?:use|using|used|have|like|in|on))\s+(?:the\s+|my\s+|our\s+|any\s+)?[\p{L}\p{N}&.-]+/giu;

/**
 * Talking about an app rather than asking it for something: building against
 * its API, borrowing its design, or its news ("the Notion API", "a sidebar
 * like Linear", "a Notion clone", "Stripe's pricing", "how much did Notion raise").
 */
const ABOUT_THE_APP = [
  /\b[\p{L}\p{N}.-]+(?:\s+(?:graphql|rest|web|public|admin|management))?\s+(?:apis?|sdks?|client\s+librar(?:y|ies)|webhooks?|oauth\s+apps?|bot\s+tokens?|api\s+keys?|endpoints?|npm\s+packages?|clones?)\b/giu,
  /(?<!\b(?:would|I|we|you|they)\s|['’]d\s)\b(?:like|similar\s+to|inspired\s+by|(?:a\s+)?clone\s+of|in\s+the\s+style\s+of)\s+(?:the\s+)?[\p{L}\p{N}&.-]+/giu,
  /\b[\p{L}\p{N}&.-]+['’]s\s+(?:founders?|ceo|valuation|funding|pricing|design(?:\s+system)?|website|logo|brand(?:ing)?|culture|history|business\s+model|marketing|landing\s+page|homepage|changelog|blog|office|headquarters|stock|ipo|competitors?|ui|ux)\b/giu,
  /\b(?:pricing|founders?|ceo|valuation|funding|history|website|logo|design\s+system|landing\s+page|homepage|competitors?)\s+(?:of|for)\s+[\p{L}\p{N}&.-]+/giu,
  /\b(?:work(?:s|ed|ing)?|jobs?|interview(?:ing|s)?|internships?|careers?)\s+(?:at|for)\s+[\p{L}\p{N}&.-]+/giu,
  /\b[\p{L}\p{N}&.-]+\s+(?:raised?|was\s+founded|went\s+public|was\s+acquired|got\s+acquired)\b/giu,
];

const blank = (text: string, pattern: RegExp) => text.replace(pattern, (m) => ' '.repeat(m.length));

const global = (re: RegExp) =>
  re.flags.includes('g') ? re : new RegExp(re.source, `${re.flags}g`);

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The name written as a name: capitalised, in the middle of a sentence, and
 * whole ("…assigned to me in Linear", not "Linear algebra is…" opening a
 * sentence, "non-Linear", or "LINEAR" in capitals).
 */
export function named(name: string): RegExp {
  return new RegExp(
    `(?<=[\\p{L}\\p{N},;:)'’"”]\\s+["“'‘]?)${escape(name)}(?![\\p{L}\\p{N}_@-])`,
    'u',
  );
}

/**
 * A made-up name that's no word in any language (Todoist, Airtable): in any
 * case, anywhere in a sentence, even first. Never inside a word, a handle
 * (`@vercel`), a package (`supabase-js`) or an address.
 */
export function coined(name: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}_@./-])${escape(name)}(?![\\p{L}\\p{N}_@-])`, 'iu');
}

export interface Read {
  /** What the person wrote, minus code, links, addresses and file names. */
  words: string;
  links: string[];
}

/** What of a message is worth reading for cues. */
export function readMessage(text: string): Read {
  const links: string[] = [];
  let words = text.slice(0, MAX_CHARS).replace(CODE, ' ');
  words = blank(words, EMAIL);
  words = words.replace(LINK, (m) => {
    if (!WEBLIKE.test(m)) return m;
    links.push(m);
    return ' '.repeat(m.length);
  });
  words = blank(words, FILE);
  words = blank(words, NEGATED);
  for (const pattern of ABOUT_THE_APP) words = blank(words, pattern);
  return { words, links };
}

/** Whether these cues say the message is about their app, and where (for ordering). */
export function cueAt(read: Read, cues: Cues): number | undefined {
  if (read.links.some((link) => cues.links?.some((re) => re.test(link)))) return -1;
  let words = read.words;
  for (const not of cues.not ?? []) words = blank(words, global(not));
  let first: number | undefined;
  for (const re of cues.match) {
    const found = new RegExp(re.source, re.flags.replace('g', '')).exec(words);
    if (found && (first === undefined || found.index < first)) first = found.index;
  }
  return first;
}

/**
 * The apps a message is clearly about, in the order it mentions them. Nothing
 * when it's weighing one app against another.
 */
export function cuedApps<T extends { id: string; cues: Cues }>(
  text: string,
  catalog: Iterable<T>,
): T[] {
  const read = readMessage(text);
  if (CHOOSING.test(read.words)) return [];
  const found: { item: T; at: number }[] = [];
  for (const item of catalog) {
    const at = cueAt(read, item.cues);
    if (at !== undefined) found.push({ item, at });
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.item);
}
