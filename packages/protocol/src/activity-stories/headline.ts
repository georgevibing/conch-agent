/**
 * A story's headline by rules, from its steps' own words: one step says what
 * it did, steps of a kind are counted ("Read 6 files"), and two kinds are
 * joined ("Searched the code and read 4 files"). Past tense once it's done,
 * "-ing" while it runs. Never longer than a line.
 */
import type { ActivityFamily } from '../activity';
import type { StoryStep } from '../activity-stories';

export const HEADLINE_MAX = 60;

export type Tense = 'done' | 'doing';

/** How much a kind of step says about a story, for which words make the headline. */
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
  if (f === 'explore' || f === 'research') return `${f}:${verbClass(step)}`;
  // Apps, commands, checks: grouped by what they did.
  return `${f}:${firstWord(step.label.done).toLowerCase()}`;
}

function groupsOf(steps: readonly StoryStep[]): Group[] {
  const groups = new Map<string, Group>();
  steps.forEach((step, i) => {
    const key = groupKey(step);
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

interface Phrase {
  /** The fullest words: "Edited Transcript.tsx and 2 other files". */
  long: string;
  /** Fewer words when the line is crowded: "Edited 3 files". */
  short: string;
  weight: number;
  first: number;
}

function phraseOf(g: Group, tense: Tense): Phrase {
  const last = g.steps[g.steps.length - 1] as StoryStep;
  const base = { weight: WEIGHT[g.family], first: g.first };
  const said = (text: string, short = text): Phrase => ({ ...base, long: text, short });
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
  if (g.family === 'verify') {
    if (texts.length === 2)
      return said(joinTwo(texts[0] as string, texts[1] as string), texts[1] as string);
    return said(`${ing ? 'Running' : 'Ran'} ${plural(texts.length, 'check')}`);
  }
  // Apps, pictures, helpers: the first one's words and how many more.
  const first = words(g.steps[0] as StoryStep, tense);
  return said(`${first} and ${subjects.length - 1} more`, first);
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

function combine(phrases: readonly Phrase[]): string | undefined {
  const ordered = [...phrases].sort((a, b) => a.first - b.first);
  const [a, b] = ordered;
  if (!a) return undefined;
  if (!b) {
    if (a.long.length <= HEADLINE_MAX) return a.long;
    return a.short.length <= HEADLINE_MAX ? a.short : undefined;
  }
  // Never "and … and": a phrase with its own "and" goes short.
  const pick = (p: Phrase) => (/ and /.test(p.long) ? p.short : p.long);
  for (const [x, y] of [
    [pick(a), pick(b)],
    [a.short, b.short],
  ] as const) {
    if (/ and /.test(x) || / and /.test(y)) continue;
    const joined = joinTwo(x, y);
    if (joined.length <= HEADLINE_MAX) return joined;
  }
  return undefined;
}

/**
 * The headline of a story's steps (those worth a line: no repeats, no polls).
 * While it runs, it says what's happening now: the group of `focus`.
 */
export function headlineOf(steps: readonly StoryStep[], tense: Tense, focus?: StoryStep): string {
  if (steps.length === 0) return tense === 'doing' ? 'Working' : 'Worked';
  const groups = groupsOf(steps);
  if (tense === 'doing') {
    const g = groups.find((x) => focus && x.steps.includes(focus)) ?? groups[groups.length - 1];
    const p = phraseOf(g as Group, 'doing');
    return fit(p.long.length <= HEADLINE_MAX ? p.long : p.short);
  }
  const phrases = groups.map((g) => phraseOf(g, 'done'));
  const byWeight = [...phrases].sort((a, b) => b.weight - a.weight || a.first - b.first);
  const top = byWeight[0] as Phrase;
  const next = byWeight[1];
  // Looking around says little next to what it changed: "Edited X and 2 other files".
  const alone = !next || top.weight - next.weight >= 5;
  const two = alone ? undefined : combine(byWeight.slice(0, 2));
  return fit(two ?? combine([top]) ?? top.long);
}

/** How much a step's family weighs, for the story's family and outcome. */
export function weightOf(family: ActivityFamily): number {
  return WEIGHT[family];
}
