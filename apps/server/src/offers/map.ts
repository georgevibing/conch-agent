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
}

/** What the map may cost a turn, in characters (ADR 0060). */
export const MAP_BUDGET = 2_400;

const HEADING = '## What Conch can turn on';

const INTRO =
  'These aren’t on yet. If one would help, call `offer` with its kind and id, and the person gets a card under your reply to turn it on. Nothing is turned on unless they press it.';

const RULES = [
  'Call `offer` only when one of these would clearly do what was asked, and only then. One offer at most.',
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

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });

/**
 * The order things are kept in when the budget runs out, most wanted first:
 * featured apps, then skills (the person's own), then the other apps; each
 * alphabetical. What doesn't fit is dropped from the end, so the apps the
 * person is least likely to want go first.
 */
export function keepOrder(map: OfferMap): { kind: 'app' | 'skill'; line: string }[] {
  const featured = map.apps.filter((a) => a.featured).sort(byName);
  const others = map.apps.filter((a) => !a.featured).sort(byName);
  const skills = [...map.skills].sort((a, b) => byName({ name: a.title }, { name: b.title }));
  return [
    ...featured.map((a) => ({ kind: 'app' as const, line: appLine(a) })),
    ...skills.map((s) => ({ kind: 'skill' as const, line: skillLine(s) })),
    ...others.map((a) => ({ kind: 'app' as const, line: appLine(a) })),
  ];
}

/**
 * The section itself, at most `budget` characters, or nothing when there's
 * nothing to offer. Apps are listed before skills; what was left out to keep
 * it short is counted, and can still be offered when the person names it.
 */
export function mapSection(map: OfferMap, budget = MAP_BUDGET): string {
  const order = keepOrder(map);
  if (!order.length) return '';
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
      RULES,
    ].join('\n');
  };
  let kept = order;
  let text = draw(kept, 0);
  while (text.length > budget && kept.length) {
    kept = kept.slice(0, -1);
    text = draw(kept, order.length - kept.length);
  }
  return kept.length ? text : '';
}
