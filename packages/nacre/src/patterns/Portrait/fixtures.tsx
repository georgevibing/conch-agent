import { Briefcase, Heart, House, MessageSquareText, Users } from 'lucide-react';

import type { PortraitFact, PortraitGroup } from './Portrait';

export const portraitGroups: PortraitGroup[] = [
  {
    kind: 'way',
    title: 'How you like answers',
    icon: <MessageSquareText />,
    invite: 'How do you like answers?',
    example: 'Short answers first',
  },
  {
    kind: 'person',
    title: 'People',
    icon: <Users />,
    invite: 'Who’s close to you?',
    example: 'Sam',
    detailLabel: 'Who they are to you',
    detailExample: 'partner · birthday 3 May',
  },
  {
    kind: 'work',
    title: 'Work and projects',
    icon: <Briefcase />,
    invite: 'What do you work on?',
    example: 'Designer at a small studio',
  },
  {
    kind: 'home',
    title: 'Places',
    icon: <House />,
    invite: 'Where do you live?',
    example: 'Lives in Lisbon since 2019',
  },
  {
    kind: 'interest',
    title: 'What you’re into',
    icon: <Heart />,
    invite: 'What are you into?',
    example: 'Bouldering',
  },
];

export const portraitFacts: PortraitFact[] = [
  { id: 'f1', kind: 'work', text: 'SDM at Amazon', detail: 'AWS Security' },
  { id: 'f2', kind: 'home', text: 'Lives in Berlin', detail: 'since 2016' },
  { id: 'f3', kind: 'home', text: 'From Komotini, Greece' },
  { id: 'f4', kind: 'person', text: 'Lina', detail: 'daughter · born 8 June 2025' },
  { id: 'f5', kind: 'person', text: 'Jouda', detail: 'wife · software engineer' },
  { id: 'f6', kind: 'interest', text: 'Graphics programming' },
  { id: 'f7', kind: 'interest', text: 'Game dev by night' },
  { id: 'f8', kind: 'way', text: 'Short answers first' },
];

/** What it learned from chats, beside what you told it. */
export const portraitLearned: PortraitFact[] = [
  {
    id: 'm1',
    kind: 'way',
    text: 'Prefers metric units',
    learned: true,
    source: 'Learned from a chat on 3 May',
    sourceAction: { label: 'Open the chat', onSelect: () => {} },
  },
  {
    id: 'm2',
    kind: 'way',
    text: 'Likes code examples in TypeScript',
    learned: true,
    source: 'Learned from a chat on 12 June',
  },
  {
    id: 'm3',
    kind: 'work',
    text: 'Building Conch, a web shell for coding agents',
    learned: true,
    source: 'Learned from a chat on 2 September',
  },
  {
    id: 'm4',
    kind: 'person',
    text: 'Antonis is his father',
    learned: true,
    source: 'You asked me to remember this on 20 August',
  },
];

export const portraitSuggested: PortraitFact[] = [
  { id: 's1', kind: 'person', text: 'Antonis and Poly', detail: 'parents' },
  { id: 's2', kind: 'interest', text: 'Indie hacking' },
];

/** A guess good enough for a story; the web app has its own. */
export function guessFixtureKind(text: string): string {
  const t = text.toLowerCase();
  if (/\b(prefer|like|answers?|always|never|please)\b/.test(t)) return 'way';
  if (/\b(wife|husband|partner|son|daughter|mother|father|friend|brother|sister)\b/.test(t))
    return 'person';
  if (/\b(live|lives|from|moved)\b/.test(t)) return 'home';
  if (/\b(work|job|project|building|team)\b/.test(t)) return 'work';
  return 'interest';
}
