import type { Tone } from '@conch/protocol';

/**
 * The words of the welcome (ADR 0068): what a person can say they'd like a hand
 * with, how each voice sounds, which apps come first for whom, and what to ask
 * first. Kept apart from the screens so each can be read and tested on its own.
 */

export type Interest =
  'writing' | 'coding' | 'research' | 'email' | 'planning' | 'work' | 'learning' | 'ideas' | 'life';

export const INTERESTS: readonly { value: Interest; label: string; phrase: string }[] = [
  { value: 'writing', label: 'Writing', phrase: 'writing' },
  { value: 'coding', label: 'Coding', phrase: 'coding' },
  { value: 'research', label: 'Research', phrase: 'research' },
  { value: 'email', label: 'Email and calendar', phrase: 'email and my calendar' },
  { value: 'planning', label: 'Planning my days', phrase: 'planning my days' },
  { value: 'work', label: 'Work and meetings', phrase: 'work and meetings' },
  { value: 'learning', label: 'Learning', phrase: 'learning new things' },
  { value: 'ideas', label: 'Ideas', phrase: 'coming up with ideas' },
  { value: 'life', label: 'Home and life', phrase: 'home and everyday life' },
];

/** The line in "About you" the welcome writes, and rewrites if it's run again. */
const LEAD = 'I’d mostly like a hand with ';

/** "a, b and c". */
function listed(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/**
 * "About you" with what the person picked, in their words: one sentence the
 * assistant reads in every chat, with every provider. Anything they wrote
 * themselves stays; a sentence from an earlier welcome is replaced, not repeated.
 */
export function aboutWith(about: string, picked: readonly Interest[]): string {
  const kept = about
    .split('\n')
    .filter((line) => !line.startsWith(LEAD))
    .join('\n')
    .trim();
  const phrases = INTERESTS.filter((i) => picked.includes(i.value)).map((i) => i.phrase);
  const line = phrases.length ? `${LEAD}${listed(phrases)}.` : '';
  return [line, kept].filter(Boolean).join('\n');
}

/** What the person picked last time, read back from "About you". */
export function interestsIn(about: string): Interest[] {
  const line = about.split('\n').find((l) => l.startsWith(LEAD));
  if (!line) return [];
  return INTERESTS.filter((i) => line.includes(i.phrase)).map((i) => i.value);
}

export const VOICES: readonly { value: Tone; label: string }[] = [
  { value: 'warm', label: 'Warm' },
  { value: 'concise', label: 'Concise' },
  { value: 'playful', label: 'Playful' },
  { value: 'precise', label: 'Precise' },
];

/**
 * Apps that connect in a press or two (a sign-in, or Gmail's app password), in
 * the order that suits what the person picked. Google Calendar and Drive need a
 * Google Cloud project of your own, so they wait for Apps, where that's explained.
 */
const APPS_FOR: Record<Interest, readonly string[]> = {
  writing: ['notion', 'canva', 'dropbox'],
  coding: ['github', 'linear', 'vercel', 'sentry'],
  research: ['notion', 'dropbox', 'airtable'],
  email: ['gmail', 'calendly'],
  planning: ['todoist', 'notion', 'calendly'],
  work: ['slack', 'atlassian', 'linear', 'gmail'],
  learning: ['notion', 'todoist'],
  ideas: ['miro', 'canva', 'notion'],
  life: ['todoist', 'gmail', 'dropbox'],
};
const EVERYONE = [
  'gmail',
  'notion',
  'slack',
  'github',
  'todoist',
  'linear',
  'dropbox',
  'canva',
  'calendly',
];
export const APPS_SHOWN = 9;

/**
 * Which apps to show, best first: each pick takes a turn (its first app, then the
 * next pick's first…), so every pick is seen near the top; then the ones most people use.
 */
export function appsFor(picked: readonly Interest[], available: ReadonlySet<string>): string[] {
  const lists = picked.map((i) => APPS_FOR[i]);
  const turns: string[] = [];
  for (let round = 0; lists.some((list) => round < list.length); round++)
    for (const list of lists) if (list[round]) turns.push(list[round] as string);
  return [...new Set([...turns, ...EVERYONE])]
    .filter((id) => available.has(id))
    .slice(0, APPS_SHOWN);
}

/** Something to ask first, for each pick: exactly the words that go in the composer. */
const STARTERS: Record<Interest, string> = {
  writing: 'Help me write a short thank-you note',
  coding: 'Walk me through a project folder of mine',
  research: 'Find me three good sources on something I’m curious about',
  email: 'What needs my attention in my inbox today?',
  planning: 'Help me plan my week',
  work: 'Help me get ready for my next meeting',
  learning: 'Teach me something new in five minutes',
  ideas: 'Brainstorm ten ideas for a weekend project',
  life: 'Plan five easy dinners for this week',
};
const ANYONE: readonly Interest[] = ['planning', 'learning', 'ideas'];

/** Three things to ask first: from the picks, topped up with ones anyone might like. */
export function startersFor(picked: readonly Interest[]): string[] {
  return [...new Set([...picked, ...ANYONE])].slice(0, 3).map((i) => STARTERS[i]);
}
