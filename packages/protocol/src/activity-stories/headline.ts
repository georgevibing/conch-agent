/**
 * A story's headline by rules, from its steps' own words: one step says what
 * it did, steps of a kind are counted ("Read 6 files"), and two kinds are
 * joined ("Searched the web and read 3 pages on amazon.de"). Which words lead
 * is decided by consequence, then count, then order (`TIER`), never by which
 * step came first alone. Past tense once it's done, "-ing" while it runs.
 * Never longer than a line.
 */
import type { ActivityEffect, ActivityFamily } from '../activity';
import type { StoryStep } from '../activity-stories';

export const HEADLINE_MAX = 60;

export type Tense = 'done' | 'doing';

/** How much a kind of step says about a story, for its family. */
const WEIGHT: Record<ActivityFamily, number> = {
  ship: 10,
  edit: 9,
  connect: 8,
  make: 7,
  verify: 6,
  delegate: 5,
  research: 4,
  browse: 4,
  run: 3,
  explore: 2,
  remember: 1,
  plan: 0,
  other: 0,
};

/**
 * Which words lead a headline: **consequence, then count, then order.**
 *
 * Consequence is first what kind of work it is (sending it off, then
 * changing things, then checking them, then looking), then what it changed:
 * a push over a commit, a commit over a tag, a tag over staging. Count is how
 * many steps a phrase covers: of one search and three pages read, the pages
 * lead. Order breaks what's left: the earlier one.
 */
const TIER: Record<ActivityFamily, number> = {
  ship: 4,
  edit: 3,
  connect: 3,
  make: 3,
  verify: 2,
  delegate: 2,
  research: 1,
  browse: 1,
  run: 1,
  explore: 1,
  remember: 1,
  plan: 0,
  other: 0,
};

/** What a change means beyond this computer: a push or a message weighs most, staging least. */
const EFFECT_RANK: Record<ActivityEffect['kind'], number> = {
  push: 3,
  publish: 3,
  send: 3,
  purchase: 3,
  delete: 3,
  commit: 2,
  schedule: 2,
  install: 2,
  file: 1,
  other: 1,
};

type VerbClass = 'read' | 'search' | 'list' | 'any';

const READ = new Set([
  'read',
  'reading',
  'opened',
  'opening',
  'viewed',
  'viewing',
  'fetched',
  'fetching',
  'visited',
  'visiting',
  'loaded',
  'loading',
]);
const SEARCH = new Set([
  'searched',
  'searching',
  'found',
  'finding',
  'grepped',
  'grepping',
  'looked',
  'looking',
]);
const LIST = new Set(['listed', 'listing']);

function firstWord(text: string): string {
  return text.trim().split(/\s+/)[0] ?? '';
}

function rest(text: string): string {
  const t = text.trim();
  const i = t.search(/\s/);
  return i < 0 ? '' : t.slice(i + 1).trim();
}

function verbClass(step: StoryStep): VerbClass {
  const f = step.label.family;
  if (f !== 'explore' && f !== 'research') return 'any';
  const w = firstWord(step.label.done).toLowerCase();
  const doing = firstWord(step.label.doing).toLowerCase();
  if (w === 'looked' && /^looked\s+(at|in|into|over|through)\b/i.test(step.label.done))
    return 'read';
  if (READ.has(w) || READ.has(doing)) return 'read';
  if (SEARCH.has(w) || SEARCH.has(doing)) return 'search';
  if (LIST.has(w) || LIST.has(doing)) return 'list';
  return 'any';
}

interface Group {
  family: ActivityFamily;
  verb: VerbClass;
  steps: StoryStep[];
  first: number;
}

function groupKey(step: StoryStep): string {
  const f = step.label.family;
  // Every change to files is one group: "Edited X and 2 other files".
  if (f === 'edit') return 'edit';
  // The browser is one thing being used, whatever it clicked.
  if (f === 'browse') return 'browse';
  // Every check is one group: "Ran the tests and 2 other checks".
  if (f === 'verify') return 'verify';
  if (f === 'explore' || f === 'research') return `${f}:${verbClass(step)}`;
  // Apps, commands, sending it off: grouped by what they did.
  return `${f}:${firstWord(step.label.done).toLowerCase()}`;
}

function groupsOf(steps: readonly StoryStep[]): Group[] {
  const groups = new Map<string, Group>();
  steps.forEach((step, i) => {
    // What didn't run is told apart from what did: "Didn’t send an email".
    const key = `${step.declined ? 'not:' : ''}${groupKey(step)}`;
    const g = groups.get(key);
    if (g) g.steps.push(step);
    else
      groups.set(key, {
        family: step.label.family,
        verb: verbClass(step),
        steps: [step],
        first: i,
      });
  });
  return [...groups.values()];
}

/** A group's consequence: its kind of work (tens), then the most its steps changed (units). */
function consequence(g: Group): number {
  // What didn't run changed nothing.
  if (g.steps.every((s) => s.declined)) return 0;
  const changed = g.steps.some((s) => (s.label.effects?.length ?? 0) > 0);
  // An app only read from (an email, a channel) is a look.
  const tier = g.family === 'connect' && !changed ? 1 : TIER[g.family];
  let rank = 0;
  for (const s of g.steps)
    for (const e of s.label.effects ?? []) rank = Math.max(rank, EFFECT_RANK[e.kind]);
  return tier * 10 + rank;
}

const tierOf = (g: Group) => Math.floor(consequence(g) / 10);
const rankOf = (g: Group) => consequence(g) % 10;

/** The groups by what they say about the story: consequence, then count, then order. */
function ranked(groups: readonly Group[], verifyLed: boolean): Group[] {
  const leads = (g: Group) => (verifyLed && g.family === 'verify' ? 1 : 0);
  return [...groups].sort(
    (a, b) =>
      leads(b) - leads(a) ||
      consequence(b) - consequence(a) ||
      b.steps.length - a.steps.length ||
      a.first - b.first,
  );
}

/** Whether `next` is worth saying beside `top`. */
function joins(top: Group, next: Group, verifyLed: boolean): boolean {
  const t = tierOf(top);
  const n = tierOf(next);
  // What never ran is said beside nothing but more of the same.
  if (n < 1) return t === 0 && next.steps.every((s) => s.declined);
  // Getting ready (staging the changes) isn't said beside what it got ready for.
  if (next.family === top.family && rankOf(top) > 0 && rankOf(next) === 0) return false;
  // A check's fixes are its note ("Worked after a fix"), never its words.
  if (verifyLed && top.family === 'verify' && next.family === 'edit') return false;
  // A change or a check is worth saying beside anything; a look only beside another look.
  return n >= 2 || t <= 1;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The last part of a path, a URL's host: short enough for a headline. */
export function shortSubject(subject: string): string {
  const s = subject.trim();
  const host = hostOf(s);
  if (host && /^[a-z]+:\/\//i.test(s)) return host;
  const parts = s.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? s;
}

export function hostOf(subject: string | undefined): string | undefined {
  const m = subject?.trim().match(/^https?:\/\/(?:[^@/?#]*@)?([^/?#:]+)/i);
  return m?.[1] ? m[1].toLowerCase().replace(/^www\./, '') : undefined;
}

function stepHost(step: StoryStep): string | undefined {
  return (
    hostOf(step.label.subject) ??
    hostOf(step.label.chips?.find((c) => c.kind === 'site' && c.href)?.href) ??
    step.label.chips?.find((c) => c.kind === 'site')?.label.replace(/^www\./, '')
  );
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

function words(step: StoryStep, tense: Tense): string {
  return tense === 'done' ? step.label.done : step.label.doing;
}

/** The verb a group's steps share in this tense, or `fallback`. */
function sharedVerb(steps: readonly StoryStep[], tense: Tense, fallback: string): string {
  const verbs = unique(steps.map((s) => firstWord(words(s, tense))));
  return verbs.length === 1 && verbs[0] ? verbs[0] : fallback;
}

/**
 * Words without what they quote, for a crowded line: "Searched the web for
 * “oxford shirts”" → "Searched the web", "Committed “fix the login”" → "Committed".
 */
export function unquoted(text: string): string {
  const at = text.search(/\s(?:(?:for|as|matching|about|called|named|titled)\s)?“/);
  return at > 0 ? text.slice(0, at) : text;
}

/** A check run's own words: the tests, wherever they are. */
export function isTestsStep(step: StoryStep): boolean {
  return /\btests?\b/i.test(step.label.done);
}

interface Phrase {
  /** The fullest words: "Edited Transcript.tsx and 2 other files". */
  long: string;
  /** Fewer words when the line is crowded: "Edited 3 files". */
  short: string;
  first: number;
}

function phraseOf(g: Group, tense: Tense, focus?: StoryStep): Phrase {
  const last = g.steps[g.steps.length - 1] as StoryStep;
  const said = (text: string, short = unquoted(text)): Phrase => ({
    long: text,
    short,
    first: g.first,
  });
  const texts = unique(g.steps.map((s) => words(s, tense)));
  const ing = tense === 'doing';
  const subjects = unique(g.steps.map((s) => s.label.subject ?? words(s, tense)));

  if (g.family === 'edit') {
    if (subjects.length === 1) return said(words(last, tense));
    const verb = sharedVerb(g.steps, tense, ing ? 'Changing' : 'Changed');
    const name = shortSubject((g.steps[0] as StoryStep).label.subject ?? '');
    const others = subjects.length - 1;
    const short = `${verb} ${plural(subjects.length, 'file')}`;
    const rest = others === 1 ? 'another file' : `${others} other files`;
    return said(name ? `${verb} ${name} and ${rest}` : short, short);
  }
  if (g.family === 'browse') {
    if (g.steps.length === 1) return said(words(last, tense));
    const hosts = unique(g.steps.map(stepHost).filter((h): h is string => !!h));
    const short = ing ? 'Using the browser' : 'Used the browser';
    return said(hosts.length === 1 ? `${short} on ${hosts[0]}` : short, short);
  }
  if (g.family === 'verify') {
    // While it runs, the check at hand.
    if (ing) return said(words(focus && g.steps.includes(focus) ? focus : last, tense));
    if (texts.length === 1) return said(texts[0] as string);
    const tests = g.steps.findLast(isTestsStep);
    const lead = tests ? words(tests, tense) : (texts[0] as string);
    if (texts.length === 2)
      return said(joinTwo(texts[0] as string, texts[1] as string), unquoted(lead));
    const others = texts.length - 1;
    return tests
      ? said(`${lead} and ${plural(others, 'other check')}`, unquoted(lead))
      : said(`Ran ${plural(texts.length, 'check')}`);
  }
  // The same words about different things are counted, where there's a noun to count.
  const counted = g.family === 'explore' || g.family === 'research' || g.family === 'run';
  if (texts.length === 1 && (subjects.length === 1 || !counted)) return said(texts[0] as string);
  if (subjects.length === 1) return said(words(last, tense));

  if (g.family === 'explore') {
    if (g.verb === 'search') return said(ing ? 'Searching the code' : 'Searched the code');
    if (g.verb === 'read') {
      const verb = sharedVerb(g.steps, tense, ing ? 'Reading' : 'Read');
      return said(`${verb} ${plural(subjects.length, 'file')}`);
    }
    if (g.verb === 'list') {
      return said(`${ing ? 'Looking in' : 'Looked in'} ${plural(subjects.length, 'folder')}`);
    }
    return said(`${ing ? 'Looking at' : 'Looked at'} ${plural(subjects.length, 'thing')}`);
  }
  if (g.family === 'research') {
    if (g.verb === 'search') {
      const n = subjects.length;
      return said(
        ing ? 'Searching the web' : `Searched the web ${n === 2 ? 'twice' : `${n} times`}`,
      );
    }
    const hosts = unique(g.steps.map(stepHost));
    const pages = plural(subjects.length, 'page');
    const verb =
      g.verb === 'read'
        ? sharedVerb(g.steps, tense, ing ? 'Reading' : 'Read')
        : ing
          ? 'Reading'
          : 'Read';
    const short = `${verb} ${pages}`;
    if (hosts.length === 1 && hosts[0]) return said(`${short} on ${hosts[0]}`, short);
    return said(short);
  }
  if (g.family === 'run')
    return said(`${ing ? 'Running' : 'Ran'} ${plural(subjects.length, 'command')}`);
  // Apps, pictures, helpers: the first one's words and how many more.
  const first = words(g.steps[0] as StoryStep, tense);
  return said(`${first} and ${subjects.length - 1} more`, unquoted(first));
}

/** Lower-cases a phrase's first letter to follow "and", unless it's a name ("GitHub", "iOS"). */
function follow(text: string): string {
  const word = firstWord(text);
  if (word.length < 2 || word.slice(1) !== word.slice(1).toLowerCase()) return text;
  return text[0]?.toLowerCase() + text.slice(1);
}

/** "Ran the tests" + "Ran the type check" → "Ran the tests and the type check". */
function joinTwo(a: string, b: string): string {
  if (firstWord(a) === firstWord(b) && rest(b)) return `${a} and ${rest(b)}`;
  return `${a} and ${follow(b)}`;
}

/** Sentence case, no more than `max` characters, cut at a word. */
export function fit(text: string, max = HEADLINE_MAX, sentence = true): string {
  let t = text.trim().replace(/\s+/g, ' ');
  if (t && sentence) t = t[0]?.toUpperCase() + t.slice(1);
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, '')}…`;
}

/** One phrase on its own: its fullest words that fit. */
function alone(p: Phrase): string {
  return p.long.length <= HEADLINE_MAX ? p.long : p.short;
}

/**
 * Two phrases in the order they happened, the lead's fullest words kept
 * longest. Never "and … and": a phrase with its own "and" goes short.
 */
function combine(lead: Phrase, other: Phrase): string | undefined {
  for (const [x, y] of [
    [lead.long, other.long],
    [lead.long, other.short],
    [lead.short, other.long],
    [lead.short, other.short],
  ] as const) {
    if (/ and /.test(x) || / and /.test(y)) continue;
    const joined = lead.first <= other.first ? joinTwo(x, y) : joinTwo(y, x);
    if (joined.length <= HEADLINE_MAX) return joined;
  }
  return undefined;
}

export interface Headline {
  /** "Searched the web and read 3 pages on amazon.de". */
  text: string;
  /** The steps whose words lead it, for the story's family and outcome. */
  lead: StoryStep[];
  /** The steps of the phrase joined to it, when one is. */
  also?: StoryStep[];
}

/**
 * The headline of a story's steps (those worth a line: no repeats, no polls).
 * While it runs, it says what's happening now: the group of `focus`. Done,
 * the lead group's words, with a second group's joined when it's worth it
 * (see `TIER` for which leads). A story that's a check (`verifyLed`) is told
 * as the check, whatever it fixed on the way.
 */
export function tellHeadline(
  steps: readonly StoryStep[],
  tense: Tense,
  { focus, verifyLed = false }: { focus?: StoryStep; verifyLed?: boolean } = {},
): Headline {
  if (steps.length === 0) return { text: tense === 'doing' ? 'Working' : 'Worked', lead: [] };
  const groups = groupsOf(steps);
  if (tense === 'doing') {
    const g = (groups.find((x) => focus && x.steps.includes(focus)) ??
      groups[groups.length - 1]) as Group;
    return { text: fit(alone(phraseOf(g, 'doing', focus))), lead: g.steps };
  }
  const [top, next] = ranked(groups, verifyLed) as [Group, Group | undefined];
  const lead = phraseOf(top, 'done');
  if (next && joins(top, next, verifyLed)) {
    const two = combine(lead, phraseOf(next, 'done'));
    if (two) return { text: fit(two), lead: top.steps, also: next.steps };
  }
  return { text: fit(alone(lead)), lead: top.steps };
}

/** How much a step's family weighs, for the story's family when no words lead it. */
export function weightOf(family: ActivityFamily): number {
  return WEIGHT[family];
}
