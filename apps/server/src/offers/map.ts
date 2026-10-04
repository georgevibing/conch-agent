/**
 * The map (ADR 0060 §1): what Conch could turn on that isn't on yet, as a
 * short section of each turn's system text, so the assistant can offer the
 * one thing a request is missing even when nobody named it.
 */

/** An app in the catalog that isn't connected, as the map lists it. */
export interface MapApp {
  id: string;
  name: string;
  /** Four or five words: "Issues and projects". */
  tagline: string;
  /** What it lets the assistant do: the card's words. */
  description: string;
  color?: string;
  featured: boolean;
}

/** A skill that's Off or waits to be asked, as the map lists it. */
export interface MapSkill {
  id: string;
  /** What it's called when asked for: `weekly-review`. */
  name: string;
  title: string;
  description: string;
  mode: 'off' | 'manual';
}

/** Everything that could be offered, for the provider answering, right now. */
export interface OfferMap {
  apps: MapApp[];
  skills: MapSkill[];
  /** Skills people publish can be searched with `find_skills` (ADR 0074). */
  market?: boolean;
}

/** What the map may cost a turn, in characters (ADR 0060). */
export const MAP_BUDGET = 2_400;

const HEADING = '## What Conch can turn on';

const INTRO =
  'These aren’t on yet. If one would help, call `offer` with its kind and id, and the person gets a card under your reply to turn it on. Nothing is turned on unless they press it.';

const RULES = [
  'Call `offer` only when one of these would clearly do what was asked, and only then. One offer at most.',
  'An app here has no tools until it’s connected, so don’t search for them. When they ask about one of these, or for what only one of these can do, call `offer` first: before the browser, making an app, or any other way round. Bring those up only if they say no.',
  'Never offer what the person said they don’t use.',
  'Answer what you can first. Don’t explain how to set anything up: the card does that.',
].join('\n');

/** The first sentence of a description, for one line of the map. */
export function firstSentence(text: string, max = 140): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  const end = /[.!?](?=\s|$)/.exec(clean);
  const sentence = end ? clean.slice(0, end.index + 1) : clean;
  return sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence;
}

const appLine = (app: MapApp) => `- app \`${app.id}\`: ${app.name} (${app.tagline})`;

const skillLine = (skill: MapSkill) => {
  const about = firstSentence(skill.description);
  return `- skill \`${skill.id}\`: ${skill.title}${skill.mode === 'manual' ? ' (when asked)' : ''}${about ? ` — ${about}` : ''}`;
};

/** How the assistant reaches skills people publish (ADR 0074). */
const MARKET =
  'Skills people share: when nothing here fits and a ready-made skill would clearly help with what was asked (a kind of document, a way of working), call `find_skills` with a few plain words, then `offer` the best one with kind `market` and its id. Never instead of answering.';

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });

/** Whether the person's words name it, as a whole word or phrase ("Todoist", not "linearly"). */
function names(said: string, name: string): boolean {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!said || !words.join('').length) return false;
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').test(said);
}

/**
 * The order things are kept in when the budget runs out, most wanted first:
 * what the person's latest words name, then featured apps, then skills (the
 * person's own), then the other apps; each alphabetical. What doesn't fit is
 * dropped from the end, so the apps the person is least likely to want go first.
 */
export function keepOrder(map: OfferMap, said = ''): { kind: 'app' | 'skill'; line: string }[] {
  const named = map.apps.filter((a) => names(said, a.name) || names(said, a.id)).sort(byName);
  const rest = map.apps.filter((a) => !named.includes(a));
  const featured = rest.filter((a) => a.featured).sort(byName);
  const others = rest.filter((a) => !a.featured).sort(byName);
  const skills = [...map.skills].sort((a, b) => byName({ name: a.title }, { name: b.title }));
  return [
    ...named.map((a) => ({ kind: 'app' as const, line: appLine(a) })),
    ...featured.map((a) => ({ kind: 'app' as const, line: appLine(a) })),
    ...skills.map((s) => ({ kind: 'skill' as const, line: skillLine(s) })),
    ...others.map((a) => ({ kind: 'app' as const, line: appLine(a) })),
  ];
}

/**
 * The section itself, at most `budget` characters, or nothing when there's
 * nothing to offer. Apps are listed before skills; what was left out to keep
 * it short is counted. `said` is the person's latest message: what it names
 * is always kept.
 */
export function mapSection(map: OfferMap, budget = MAP_BUDGET, said = ''): string {
  const order = keepOrder(map, said);
  if (!order.length && !map.market) return '';
  const draw = (kept: typeof order, left: number) => {
    const apps = kept.filter((k) => k.kind === 'app').map((k) => k.line);
    const skills = kept.filter((k) => k.kind === 'skill').map((k) => k.line);
    return [
      HEADING,
      INTRO,
      ...(apps.length ? ['Apps that aren’t connected:', ...apps] : []),
      ...(skills.length ? ['Skills that are off, or used only when asked:', ...skills] : []),
      ...(left
        ? [
            `${left} more ${left === 1 ? 'isn’t' : 'aren’t'} listed, to keep this short. Offer one only if the person names it.`,
          ]
        : []),
      ...(map.market ? [MARKET] : []),
      RULES,
    ].join('\n');
  };
  let kept = order;
  let text = draw(kept, 0);
  while (text.length > budget && kept.length) {
    kept = kept.slice(0, -1);
    text = draw(kept, order.length - kept.length);
  }
  return kept.length || map.market ? text : '';
}
