import type {
  AppManifestView,
  AppToolView,
  AppWords,
  CommunityAppView,
  AppVersionView,
} from './types';

/** A plant diary, as the assistant might make one. */
export const plantDiary: AppManifestView = {
  id: 'plant-diary',
  name: 'Plant diary',
  tagline: 'Remembers when you water your plants, and which need it next',
  description:
    'Tell your assistant when you water a plant, and it keeps the date. Ask which plants are thirsty, and it checks the forecast before it answers.',
  version: '1.0.0',
  icon: { glyph: 'sprout', color: 'green' },
  pages: [{ id: 'main', title: 'My plants' }],
  settings: [
    {
      key: 'weatherKey',
      label: 'Weather API key',
      help: 'A free key from Open-Meteo’s customer page. It stays on this computer.',
      link: 'https://open-meteo.com/en/pricing',
      secret: true,
    },
    { key: 'city', label: 'City', help: 'For the forecast: where your plants live.' },
  ],
  examples: ['I watered the fern', 'Which plants need water?', 'When did I last feed the orchid?'],
};

export const plantTools: AppToolView[] = [
  {
    name: 'log_watering',
    title: 'Log watering',
    description: 'Records that a plant was watered. Use when the person says they watered one.',
    changes: true,
  },
  {
    name: 'find_plants',
    title: 'Find plants',
    description: 'Lists the plants, with when each was last watered.',
    changes: false,
  },
  {
    name: 'last_watered',
    title: 'When last watered',
    description: 'Says when one plant was last watered, and whether rain is due.',
    changes: false,
  },
];

/** What `appAbilities(plantDiary, plantTools)` says. */
export const plantWords: AppWords = {
  from: 'Made by you',
  abilities: [
    { kind: 'data', text: 'Keeps its own notes on this computer' },
    { kind: 'reach', text: 'Reaches api.open-meteo.com' },
    { kind: 'nothing-else', text: 'Can’t read your files, run programs or see your other apps' },
    { kind: 'needs', text: 'Needs from you: Weather API key, City' },
    { kind: 'looks', text: 'Looks things up: Find plants, When last watered' },
    { kind: 'changes', text: 'Makes changes: Log watering (asks first)' },
  ],
};

/** Version 1.1.0: it now reaches a second site and gained a tool. */
export const plantUpdate = {
  changes: {
    from: '1.0.0',
    to: '1.1.0',
    reachesAdded: ['api.gbif.org'],
    toolsNowChange: [],
  },
  words: {
    ...plantWords,
    changes: ['Now also reaches api.gbif.org', 'New: Name a plant from a photo'],
  } satisfies AppWords,
};

/** A coffee tab, found on GitHub and signed by its maker. */
export const coffeeTab: AppManifestView = {
  id: 'coffee-tab',
  name: 'Coffee tab',
  tagline: 'Counts what you spend on coffee, week by week',
  version: '2.1.0',
  icon: { glyph: 'coffee', color: 'amber' },
  pages: [{ id: 'week', title: 'This week' }],
  settings: [],
  examples: ['Flat white, 3.40', 'What did coffee cost me this month?'],
};

export const coffeeTools: AppToolView[] = [
  {
    name: 'add_cup',
    title: 'Add a cup',
    description: 'Notes a coffee and its price.',
    changes: true,
  },
  {
    name: 'spent',
    title: 'What I spent',
    description: 'Totals a week or a month.',
    changes: false,
  },
];

export const coffeeWords: AppWords = {
  from: 'Signed by Ada Lovelace',
  abilities: [
    { kind: 'data', text: 'Keeps its own notes on this computer' },
    { kind: 'reach', text: 'Reaches no websites' },
    { kind: 'nothing-else', text: 'Can’t read your files, run programs or see your other apps' },
    { kind: 'looks', text: 'Looks things up: What I spent' },
    { kind: 'changes', text: 'Makes changes: Add a cup (asks first)' },
  ],
};

export const trainCheck: AppManifestView = {
  id: 'train-late',
  name: 'Is my train late?',
  tagline: 'Checks your usual train before you leave',
  version: '0.3.0',
  icon: { glyph: 'train-front', color: 'blue' },
  settings: [{ key: 'station', label: 'Your station' }],
};

export const trainTools: AppToolView[] = [
  {
    name: 'next_trains',
    title: 'Next trains',
    description: 'The next departures.',
    changes: false,
  },
];

export const trainWords: AppWords = {
  from: 'From github.com/ada/conch-apps',
  abilities: [
    { kind: 'data', text: 'Keeps its own notes on this computer' },
    { kind: 'reach', text: 'Reaches v6.db.transport.rest' },
    { kind: 'nothing-else', text: 'Can’t read your files, run programs or see your other apps' },
    { kind: 'needs', text: 'Needs from you: Your station' },
    { kind: 'looks', text: 'Looks things up: Next trains' },
  ],
};

export const community: CommunityAppView[] = [
  {
    owner: 'ada',
    repo: 'plant-diary',
    description: 'Remembers when you water your plants, and checks the forecast first.',
    stars: 128,
    url: 'https://github.com/ada/plant-diary',
    installed: true,
  },
  {
    owner: 'grace',
    repo: 'reading-list',
    description: 'A reading list your assistant keeps for you: add, finish, and what’s next.',
    stars: 42,
    url: 'https://github.com/grace/reading-list',
  },
  {
    owner: 'linus',
    repo: 'coffee-tab',
    description: 'Counts what you spend on coffee, week by week.',
    stars: 7,
    url: 'https://github.com/linus/coffee-tab',
  },
  {
    owner: 'margaret',
    repo: 'conch-app-train-delays-for-the-morning-commute',
    description: '',
    stars: 0,
    url: 'https://github.com/margaret/conch-app-train-delays-for-the-morning-commute',
  },
];

const day = 86_400_000;
export const versions = (now: number): AppVersionView[] => [
  { version: '1.2.0', at: now - 2 * day, hash: 'c3' },
  { version: '1.1.0', at: now - 9 * day, hash: 'b2' },
  { version: '1.0.0', at: now - 30 * day, hash: 'a1' },
];
