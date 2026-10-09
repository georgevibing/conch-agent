/**
 * The words of the welcome (ADR 0068): what to ask first, and the interests an
 * earlier welcome may have kept in "About you" to choose them by. Kept apart
 * from the screens so they can be read and tested on their own.
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

/** The line in "About you" an earlier welcome wrote. */
const LEAD = 'I’d mostly like a hand with ';

/**
 * What an earlier welcome said the person would like a hand with, read back
 * from "About you" ("I’d mostly like a hand with coding and research."). The
 * welcome no longer asks (ADR 0068, amended), but a sentence it wrote before
 * still picks the things to ask first.
 */
export function interestsIn(about: string): Interest[] {
  const line = about.split('\n').find((l) => l.startsWith(LEAD));
  if (!line) return [];
  return INTERESTS.filter((i) => line.includes(i.phrase)).map((i) => i.value);
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

/** Three things to ask first: from earlier picks if any, topped up with ones anyone might like. */
export function startersFor(picked: readonly Interest[]): string[] {
  return [...new Set([...picked, ...ANYONE])].slice(0, 3).map((i) => STARTERS[i]);
}
