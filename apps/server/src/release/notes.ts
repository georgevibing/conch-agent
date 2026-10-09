/**
 * A release's notes, written from its commits (ADR 0051).
 *
 * What a person reads is a few short lines in at most three groups — New,
 * Better, Fixed — and a "Heads up" when they must do something. Each line is
 * one thing they'd notice, from their side. So:
 *
 * - housekeeping is left out: chores, tests, docs, refactors, CI, builds;
 * - the commits of one feature become one line. A feature here usually lands
 *   as `feat(protocol)`, `feat(server)`, `feat(nacre)` and `feat(web)` in a
 *   row, saying the same thing in different words: commits close together
 *   that share the words few other commits use are one feature;
 * - that line is taken from the commit closest to the person (the web app's,
 *   then any other, never the protocol's or a component's), in the words
 *   `humanise` already turns subjects into;
 * - a fix to something new in the same release isn't a fix anyone saw: the
 *   feature's line covers it.
 *
 * This is the deterministic base: always there, always the same for the same
 * commits. `polish.ts` can rewrite it with a model, held to these lines.
 */
import { humanise } from '../updates/whatsnew';
import { isBreaking, type Commit } from './semver';

export interface Notes {
  headsUp: string[];
  new: string[];
  better: string[];
  fixed: string[];
}

export const SECTIONS = [
  ['headsUp', 'Heads up'],
  ['new', 'New'],
  ['better', 'Better'],
  ['fixed', 'Fixed'],
] as const satisfies readonly (readonly [keyof Notes, string])[];

/** At most this many lines a group; the rest are counted in one last line. */
export const LIMITS: Record<keyof Notes, number> = { headsUp: 3, new: 8, better: 5, fixed: 5 };

const TYPE = /^([a-z]+)(?:\(([^)]*)\))?!?:\s*/i;
/** Housekeeping nobody using Conch would notice. */
const NOISE = new Set([
  'chore',
  'test',
  'tests',
  'docs',
  'doc',
  'style',
  'ci',
  'build',
  'refactor',
  'wip',
  'release',
  'deps',
  'revert',
]);
/**
 * Parts of the code a person never meets by name: their commits help find a
 * feature's other commits, but are never its line. A fix in Nacre is still
 * a fix someone saw.
 */
const INNER = new Set(['protocol', 'nacre', 'mock']);
/** Parts nobody using Conch meets at all: the build, the tests, the documentation site. */
const OUTSIDE = new Set(['ci', 'e2e', 'test', 'tests', 'deps', 'release', 'build', 'docs']);
/** Whose words a feature's line is taken from, best first. */
const CLOSEST = ['web', '', 'server'];

/** Words that carry no meaning about *which* feature. */
const STOP = new Set(
  (
    'a an the and or of for to in on at by with from into onto as is are be it its it’s this that ' +
    'these those your you their them they we our one two three every each all any some more less ' +
    'now new can could would will when what who which how why where there here not no yes than then ' +
    'also only just still again after before while about over under up down out off so too very ' +
    'conch conch’s says say said gets get got make makes made shows show see sees work works use uses ' +
    'used thing things way ways like own other others same first last next stay stays keep keeps ' +
    'without within back once part parts something nothing anything everything'
  ).split(' '),
);

interface Parsed extends Commit {
  type: string;
  scope: string;
  text: string;
  breaking: boolean;
  words: Set<string>;
}

/** `DeviceLinkCard` reads as device, link, card: a component often names its feature. */
function splitCase(text: string): string {
  return text.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** A word's plain stem, so "pages", "page" and "paged" meet. */
function stem(word: string): string {
  return word
    .replace(/’s$|'s$/, '')
    .replace(/(?<=\w{3})(ing|ed|es|s)$/, '')
    .replace(/(?<=\w{3})e$/, '');
}

function wordsOf(text: string): Set<string> {
  const words = splitCase(text)
    .toLowerCase()
    .split(/[^\p{L}\p{N}’']+/u)
    .map((w) => w.replace(/^['’]+|['’]+$/g, ''))
    .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w))
    .map(stem);
  return new Set(words);
}

/**
 * A commit, read; `'end'` for one that closes a feature (its documentation,
 * its end-to-end journey); `undefined` for other housekeeping.
 */
function parse(commit: Commit): Parsed | 'end' | undefined {
  const match = TYPE.exec(commit.subject);
  const type = (match?.[1] ?? '').toLowerCase();
  const scope = (match?.[2] ?? '').toLowerCase();
  const breaking = isBreaking(commit);
  if (!breaking && (type === 'docs' || scope === 'e2e')) return 'end';
  // Housekeeping is left out, unless it breaks something people must know about.
  if ((NOISE.has(type) || OUTSIDE.has(scope)) && !breaking) return undefined;
  if (/^(merge\b|revert "|fixup!|squash!|amend!)/i.test(commit.subject)) return undefined;
  const text = commit.subject.slice(match?.[0].length ?? 0);
  return {
    ...commit,
    type: type || 'other',
    scope,
    text,
    breaking,
    words: wordsOf(text.replace(/\(ADR \d+\)/gi, '')),
  };
}

/** One line in Conch's plain voice: no ADR numbers, no "and its tests", not too long. */
export function cleanLine(text: string): string | undefined {
  const human = humanise(`x: ${text}`);
  if (!human) return undefined;
  let line = human
    .replace(/\s*\((?:ADR \d+[^)]*|#\d+)\)/gi, '')
    .replace(/,?\s+(?:and|with) (?:its|their) tests\b/gi, '')
    .replace(/\s*\((?=[^)]*[⌘⇧↩⌥])[^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  // A long list reads better cut at its last whole item.
  if (line.length > 96) {
    const cut = line.lastIndexOf(', ', 92);
    line = cut > 40 ? line.slice(0, cut) : `${line.slice(0, 92).replace(/\s+\S*$/, '')}…`;
  }
  return line.charAt(0).toUpperCase() + line.slice(1);
}

/** How rare each word is in these commits: a word every commit uses says nothing. */
function rarity(commits: Parsed[]): Map<string, number> {
  const seen = new Map<string, number>();
  for (const commit of commits) for (const w of commit.words) seen.set(w, (seen.get(w) ?? 0) + 1);
  // A short release reads as if among a few dozen commits: a word shared by its few is still rare.
  const n = Math.max(commits.length, 40);
  return new Map([...seen].map(([w, count]) => [w, Math.log(n / count)]));
}

export interface Group {
  /** What this group is about, in one line. */
  line: string;
  section: keyof Notes;
  commits: { sha: string; subject: string }[];
}

/** How far apart (in commits worth telling) two commits of one feature can be. */
const NEAR = 10;
/** How much rare wording two commits must share to be one feature. */
const ALIKE = 2;
/** A fix joins something new from further away, and needs to share a little more. */
const ALIKE_FIX = 3;

interface Cluster {
  members: Parsed[];
  /** Where its last commit is, and in which stretch between features' ends. */
  last: number;
  stretch: number;
}

/**
 * The commits worth telling, as features: each group one line, in the order
 * a person should read them. `commits` newest first, as `git log` gives them.
 *
 * A commit joins the feature whose commit it's most like (the rare words they
 * share, not just common ones), when that's near enough: a `feat` only within
 * the same stretch (a feature's documentation or journey ends it), a fix to
 * anything new in this release.
 */
export function groups(commits: Commit[]): Group[] {
  const read = [...commits].reverse().map(parse);
  const parsed = read.filter((c): c is Parsed => typeof c === 'object');
  const weight = rarity(parsed);
  const like = (a: Parsed, b: Parsed) => {
    let score = 0;
    for (const w of a.words) if (b.words.has(w)) score += weight.get(w) ?? 0;
    return score;
  };
  const clusters: Cluster[] = [];
  let stretch = 0;
  let index = 0;
  for (const commit of read) {
    if (commit === 'end') {
      stretch++;
      continue;
    }
    if (!commit) continue;
    index++;
    const fix = commit.type !== 'feat';
    let best: Cluster | undefined;
    let bestScore = 0;
    for (const cluster of clusters) {
      const feature = cluster.members.some((c) => c.type === 'feat');
      const reach =
        fix && feature ? true : cluster.stretch === stretch && index - cluster.last <= NEAR;
      if (!reach || commit.breaking) continue;
      const score = Math.max(...cluster.members.map((member) => like(commit, member)));
      if (score >= (fix && cluster.stretch !== stretch ? ALIKE_FIX : ALIKE) && score > bestScore) {
        best = cluster;
        bestScore = score;
      }
    }
    if (best) {
      best.members.push(commit);
      best.last = index;
      best.stretch = stretch;
    } else clusters.push({ members: [commit], last: index, stretch });
  }

  const out: (Group & { size: number; at: number })[] = [];
  clusters.forEach((cluster, at) => {
    const { members } = cluster;
    const said = (pick: Parsed) => cleanLine(pick.text);
    const rank = (c: Parsed) => {
      const i = CLOSEST.indexOf(INNER.has(c.scope) ? '\u0000' : c.scope);
      return INNER.has(c.scope) ? 10 : i === -1 ? 1 : i;
    };
    const feat = members.some((c) => c.type === 'feat');
    const pool = members.filter((c) => (feat ? c.type === 'feat' : true));
    const voice = [...pool].sort((a, b) => rank(a) - rank(b))[0];
    if (!voice) return;
    // A feature only its inner parts mention isn't one a person can use yet.
    if (feat && rank(voice) === 10 && !members.some((c) => c.breaking)) return;
    const line = said(voice);
    if (!line) return;
    const section: keyof Notes = members.some((c) => c.breaking)
      ? 'headsUp'
      : feat
        ? BETTER.test(line)
          ? 'better'
          : 'new'
        : members.some((c) => c.type === 'perf' || c.type === 'other')
          ? 'better'
          : 'fixed';
    out.push({
      line: section === 'headsUp' ? headsUp(members) : line,
      section,
      commits: members.map(({ sha, subject }) => ({ sha, subject })),
      size: members.length,
      at,
    });
  });
  // The bigger the feature (the more commits it took), the higher it goes; then the newest.
  return out
    .sort((a, b) => b.size - a.size || b.at - a.at)
    .map(({ line, section, commits: c }) => ({ line, section, commits: c }));
}

/** A line that's about something getting better, not something new. */
const BETTER =
  /^(faster|quicker|clearer|calmer|quieter|smoother|simpler|easier|better|safer|lighter|tidier|fewer|less|more|improved?|sharper|steadier|honest)\b/i;

/** What changes for you, and what to do: the `BREAKING CHANGE:` footer says it best. */
function headsUp(members: Parsed[]): string {
  const breaking = members.find((c) => c.breaking);
  const footer = breaking && /^BREAKING[ -]CHANGE:\s*(.+(?:\n(?!\n).+)*)/m.exec(breaking.body)?.[1];
  const said = footer ? footer.replace(/\s+/g, ' ').trim() : breaking?.text;
  return cleanLine(said ?? '') ?? 'Something works differently: read on before you update';
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The notes, at most a few lines a group. */
export function notesFrom(commits: Commit[]): { notes: Notes; groups: Group[] } {
  const all = groups(commits);
  const notes: Notes = { headsUp: [], new: [], better: [], fixed: [] };
  for (const group of all) {
    const list = notes[group.section];
    if (!list.some((line) => line.toLowerCase() === group.line.toLowerCase()))
      list.push(group.line);
  }
  const more = { new: 'new thing', better: 'smaller improvement', fixed: 'fix' } as const;
  for (const key of ['new', 'better', 'fixed'] as const) {
    const list = notes[key];
    const limit = LIMITS[key];
    if (list.length > limit) {
      const rest = list.length - (limit - 1);
      notes[key] = [
        ...list.slice(0, limit - 1),
        `And ${plural(rest, `${more[key]}`, `${more[key]}${key === 'fixed' ? 'es' : 's'}`)}`,
      ];
    }
  }
  notes.headsUp = notes.headsUp.slice(0, LIMITS.headsUp);
  if (!notes.new.length && !notes.better.length && !notes.fixed.length && !notes.headsUp.length)
    notes.better.push('Work behind the scenes to keep Conch running well');
  return { notes, groups: all };
}

// ── Writing them down ─────────────────────────────────────────────────────

const bullets = (lines: string[]) => lines.map((line) => `- ${line}`).join('\n');

/**
 * The tag's message: plain words, no `#` (git would read a heading as a
 * comment). The same text the GitHub Release and CHANGELOG.md say.
 */
export function tagMessage(version: string, notes: Notes): string {
  const parts = [`Conch ${version}`];
  for (const [key, title] of SECTIONS)
    if (notes[key].length) parts.push(`${title}\n${bullets(notes[key])}`);
  return `${parts.join('\n\n')}\n`;
}

/** For the GitHub Release. */
export function releaseBody(notes: Notes): string {
  return `${SECTIONS.filter(([key]) => notes[key].length)
    .map(([key, title]) => `### ${title}\n\n${bullets(notes[key])}`)
    .join('\n\n')}\n`;
}

/**
 * A version's part of CHANGELOG.md, headed the way release-please heads its
 * own (`## [0.3.0](compare link) (2026-10-02)`), so its pull request reads it.
 */
export function changelogSection(
  version: string,
  date: string,
  notes: Notes,
  link?: string,
): string {
  return `## ${link ? `[${version}](${link})` : version} (${date})\n\n${releaseBody(notes)}`;
}

const CHANGELOG_HEAD = `# What’s new in Conch

Every release, newest first. Conch shows the same notes in Settings → Health → Updates.
`;

/** CHANGELOG.md with a new version on top. */
export function addToChangelog(existing: string | undefined, section: string): string {
  const text = existing?.trim() ? existing : CHANGELOG_HEAD;
  const first = text.search(/^## /m);
  if (first === -1) return `${text.trimEnd()}\n\n${section}`;
  return `${text.slice(0, first)}${section}\n${text.slice(first)}`;
}

// ── Reading them back ─────────────────────────────────────────────────────

const TITLES = new Map<string, keyof Notes>(
  SECTIONS.map(([key, title]) => [title.toLowerCase(), key]),
);

/**
 * Notes from a tag's message or a CHANGELOG section. What comes from
 * upstream is read strictly: known groups only, a few short lines each,
 * no control characters. Anything else is left out.
 */
export function parseNotes(text: string): Notes {
  const notes: Notes = { headsUp: [], new: [], better: [], fixed: [] };
  let at: keyof Notes | undefined;
  for (const raw of text.split(/\r?\n/).slice(0, 400)) {
    const line = raw.trim();
    const heading = /^#{0,4}\s*([A-Za-z ]+?)\s*:?$/.exec(line)?.[1]?.toLowerCase();
    if (heading && TITLES.has(heading)) {
      at = TITLES.get(heading);
      continue;
    }
    const item = /^[-*•]\s+(.+)$/.exec(line)?.[1];
    // Any other words end the group: what follows isn't part of it.
    if (!item && line) at = undefined;
    if (!at || !item) continue;
    // eslint-disable-next-line no-control-regex
    const clean = item.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e]/g, '').trim();
    if (clean && notes[at].length < 12) notes[at].push(clean.slice(0, 160));
  }
  return notes;
}

/** The part of CHANGELOG.md about `version`. */
export function changelogFor(changelog: string, version: string): string | undefined {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // `## 0.3.0 — date`, `## 0.3.0 (date)` or `## [0.3.0](link) (date)`.
  const start = new RegExp(`^## (?:\\[${escaped}\\]\\([^)\\s]*\\)|${escaped})(?:\\s|$)`, 'm').exec(
    changelog,
  );
  if (!start) return undefined;
  const rest = changelog.slice(start.index + start[0].length);
  const end = rest.search(/^## /m);
  return end === -1 ? rest : rest.slice(0, end);
}

export const emptyNotes = (notes: Notes) =>
  !notes.headsUp.length && !notes.new.length && !notes.better.length && !notes.fixed.length;

/** As plain text, for a terminal. */
export function notesText(notes: Notes): string {
  return SECTIONS.filter(([key]) => notes[key].length)
    .map(([key, title]) => `${title}\n${notes[key].map((l) => `  • ${l}`).join('\n')}`)
    .join('\n\n');
}
