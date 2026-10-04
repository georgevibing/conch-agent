import { Briefcase, Heart, House, Sparkles, Users } from 'lucide-react';

import type { PortraitCard, PortraitFact } from './Portrait';

export const portraitCards: PortraitCard[] = [
  { kind: 'work', title: 'Work', icon: <Briefcase />, example: 'Designer at a small studio' },
  { kind: 'home', title: 'Home', icon: <House />, example: 'Lives in Lisbon since 2019' },
  {
    kind: 'person',
    title: 'People',
    icon: <Users />,
    example: 'Sam',
    detailLabel: 'Who they are to you',
    detailExample: 'partner · birthday 3 May',
  },
  { kind: 'interest', title: 'Interests', icon: <Heart />, example: 'Bouldering' },
  { kind: 'way', title: 'How you like things', icon: <Sparkles />, example: 'Short answers first' },
];

export const portraitFacts: PortraitFact[] = [
  { id: 'f1', kind: 'work', text: 'SDM at Amazon', detail: 'AWS Security' },
  { id: 'f2', kind: 'home', text: 'Lives in Berlin', detail: 'since 2016' },
  { id: 'f3', kind: 'home', text: 'From Komotini, Greece' },
  { id: 'f4', kind: 'person', text: 'Lina', detail: 'daughter · born 8 June 2025' },
  { id: 'f5', kind: 'person', text: 'Jouda', detail: 'wife · software engineer' },
  { id: 'f6', kind: 'interest', text: 'Graphics programming' },
  { id: 'f7', kind: 'interest', text: 'Game dev by night' },
];

export const portraitSuggested: PortraitFact[] = [
  { id: 's1', kind: 'person', text: 'Antonis and Poly', detail: 'parents' },
  { id: 's2', kind: 'interest', text: 'Indie hacking' },
];
