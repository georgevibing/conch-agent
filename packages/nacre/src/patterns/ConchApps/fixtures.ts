import type { PartChannelView, PartProviderView } from './PartReview';
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

/**
 * Pictures an app might have as its icon (ADR 0090), small PNGs drawn for the
 * stories: a scene that fills its tile, and a mark with transparent edges.
 */
export const samplePictures = {
  sunrise:
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAEzElEQVR42u2bO2sUURiG51eY/AL/gCKCFiYIIZi9r4lJhEBE0EIQRLHRQhEUQUwhWihWioqFkEIIRIjEWn+BhbWFtbkceWezq65sPHM5M2dmnuJplt2ZM9/3zLl852wwfuSsgeoSEAQEIBAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAiQB62ZM+bS3Ky5t9w1q1da5uP15oDv92ohf36m7+i7+o1+iwAFY6k9Zx5f6JgvNxvm54OZVNC1dE1dGwE8TfqLS+3wbU4r6aPQPXSvsshQWAEOTyyEXXUWSd9PBrVBbUGADBOvNzCvpI9CbSqiCIUR4ODxxXAc9i3xw6iNaisCpIhm5Hl29XGGBrUZAVLo7rU0K0rih1HbfR8WAp9n9kV66/frDXxeMXgpQKpj/UrNbD2tm53XTbPzrmV237dDzEbXmM09NrqDz/UdfVe/0W/TnBsggMVET5W4pMHeelI3O29bZnet8zvJMdE1dC1dM2m79Gy+TRADn5KfqHq3Ugvf3N315EkfKcN6J7xHkp5Bz+iTBEHRk7/1qBZ2266SPgrdU/cuugRBYZO/98Znnfh/RIjZI/giQe4CxFnmbT9vOO3q4wwNalOcZWKlBYhc0l3Jp7uPMixE7Q0Ug0oKoEpZ1LE+jVm9895grRN5bpBn1TAXASan5iMVebQE+2vd7jsb3UjLRsVCMamMAFEmfYVLfkwJFJNKCKD989InP6YEik2pBdDGSGWSH1OCrDePAi+XfCvFmPBFmRjarg6yXhpmJoBO2Nq+BTur7dIkf7BEXLVf8mZ5Gjnw7e3fftksXfL76Nl86wUCn95+rZ9LMe7vNx+wrBFk1QsEPr39Zez64w4FWfUCgS8zfx3AKHvy+4SHTTxZETgXwPZ0T3hKpyIC6Fl9OUXkXICvt+u8/TF7AcWu0AKovs3Yn2wu4HqPIMi7+w9n/hVL/qAXsFgRuB4Ggrw3fcq87k+jLuB6kyhwedTLavJXopJvrBKxRYxcHh1zJoD+DGFT869q8vvY7BG4/GNJkOe2r87RVV0Am7OELreJnQlg8wcP/eGi6gIoBjZ/KCmcADYTwCoVf5IUhVxOBJ0JYDO5KfXGT4QNIptYlVOATQQIJ4JlE8CmAhge+SL5vYKQxZExVxXBIK/9/yrW/5PsC7g6H4AACIAACIAACIAACJDpMbCo28Df3nfMpzc9Xj1rm/sPWwOWbjRN89rfHDhbT5Xh6+uef7ZBbeq3T21Ne1vY1fGw3OsAPz50B4EbTujk5UbqicwaPcOwMP3n1bOXsg4wLMDnOzNm41bN3L3ao3GxbibO1wuf3LRQLBSTfnwUK8WsWAIcWzDjJ+bN2NSsGTvVNRPnGubQMslNimKoWCqmiq1iHMY6NwH6iZ4+bcbqHTPWaZOonFDswxxMn44txmgBji6S6LKIcXTxPwIo0Sfnet2MEr3QIJBlY6HRE0M5PjnXE0MCEJxqgwAIQBAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAB84xeonVWDtOVowAAAAABJRU5ErkJggg==',
  blossom:
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAD5UlEQVR42u2dQY7TMBSGe4QeIUfoEbLMstwgK8QKFQkWCCFVKPseoeIEWXCAnABlxzYXCIoEEkIsKDKyUQc1baYTx89+3ye9xcx0mjb/H9t5fnZWKwAAAAAAAAAAAAAAAAAAAIDI6Ytq3RdVPhJrzlCagpd9UR37our6ojrdiM6+tsQQcQufWSFPTwzzHhlnVJ/wGCFC8Xd9UQ0exHdh3nvHmZbZzx89Cn+pNWB8IEj8dkHxXbSYQK/4mECIAZqA4rtoUCKM+HsB4rvYo8iy4ueCxHeRo8xyBmgFGqBFmWXELwWK76JEIf8G6AQboEMhv+JvBYvvYotS/gxwjMAAR5TyZ4AhAgMMKOVH/E0E4rvYoNh9ad3cJnhM1DbT15z9HIsBavuZ3eevz74XlUdnomd2CreNSNw55xF2KmsMPBZtxBo6ik1sM39A8NE4JNs92L5vQORJVUd5auKXCKs0rUxfrzipJGzOPtbY0+wTZWziZwz4Zh8YZjEZoEE0pbWHNP3KuwLhBRuxR8fVT5T0/YwFxOb5EWiZWNP80w2Q8r0nvr1+d/pxeHP69enlgzC/M38jRZxg///12Ye/Av/+/OJ0+vL8apjXmNea/2Ec8DgDiDxZ39+/nST8JSOY/5X6vTDAhPj58dWjhf8/zHtggAgNMIf4kk2AAW40+3OJ70Jad4ABrgz47unzp4wJJA0MMcBImBH83OK7MO+NAcYNIKK238fVf94KsBfBuAFqCUkeX+K7EJIsqiUaYJdy8y+sG9hJNEAW+sSYlK5vA5hjCDCAzPKw0OMAJQaQuxdR6BlBJQYQXRCyDlkNrMAAg/i1gyEXgygYBMaxSCRUYWjit4Hx7EAWcifPhBNBca0YDtUVJJoKjnZ94JHJIFYIH5kOVr7nYAgTJFAQktaGkyHmCiIuCUvzwVR2s8dm6e4goqLQRsUmk0vnCSIpC9ex03joLV+FLwxRcfWzT+CVfQJp/ln/T/OvPDYpG4AVxJqfO8S+gcqfQcgOIsqfRIoBMAAGwACIjAEItQZg63jNzx3kNpDbwByBEyv+vMMEiBzTun8PBqgROqJl38wHMA/gwwQ8TeTCur+VFrgbUDb6v2CANYUhDwtB1D1Qui+qLcL/i+1KI2QGE8/8TewKWsXit+qa/hETaLwrGNSLf2aCTaBBYRuoBepUrAEQ3h009pjrhaepafZvGOEQ4p57odzEAYWnzxo2nq76zY2uyNdxc5S9L1fQLC3AjAZs1N7jz2yEzO4v0Dzy5O+esq1qqOPCtCs0t/32eeQ+R9e2ixg7Lk08AAAAAAAAAAAAAAAAAAAAAAAAAACE4Q/vaP5EVx4X6gAAAABJRU5ErkJggg==',
  /** An address that never loads: the glyph stays. */
  broken: 'data:image/png;base64,AAAA',
};

/** A provider made with Conch (ADR 0122): Fireworks, declared, no code. */
export const fireworks: AppManifestView = {
  id: 'fireworks',
  name: 'Fireworks AI',
  tagline: 'Fast open models, in every chat',
  version: '1.0.0',
  icon: { glyph: 'zap', color: 'violet' },
};

export const fireworksProvider: PartProviderView = {
  name: 'Fireworks AI',
  speaks: 'openai',
  reaches: ['api.fireworks.ai'],
  key: {
    label: 'Fireworks API key',
    help: 'Account → API Keys → Create API key.',
    link: 'https://fireworks.ai/account/api-keys',
  },
  models: [
    {
      id: 'accounts/fireworks/models/llama4-maverick-instruct-basic',
      name: 'Llama 4 Maverick',
      context: 1_000_000,
      price: { input: 0.22, output: 0.88 },
    },
    {
      id: 'accounts/fireworks/models/qwen3-235b-a22b',
      name: 'Qwen3 235B',
      context: 128_000,
      price: { input: 0.22, output: 0.88 },
    },
  ],
};

export const fireworksWords: AppWords = {
  from: 'Made by you',
  abilities: [
    {
      kind: 'provider',
      text: 'Answers chats as Fireworks AI (OpenAI’s chat, 2 models)',
    },
    { kind: 'reach', text: 'Reaches api.fireworks.ai' },
    { kind: 'nothing-else', text: 'Can’t read your files, run programs or see your other apps' },
    { kind: 'needs', text: 'Needs from you: Fireworks API key (kept by Conch, never in the app)' },
  ],
};

/** A chat app made with Conch (ADR 0122): Zulip, its bot polled from this computer. */
export const zulip: AppManifestView = {
  id: 'zulip',
  name: 'Zulip',
  tagline: 'Talk to your assistant on Zulip',
  version: '1.0.0',
  icon: { glyph: 'message-circle', color: 'teal' },
};

export const zulipChannel: PartChannelView = {
  name: 'Zulip',
  receives: 'poll',
  steps: [
    'In Zulip, open Personal settings → Bots and press Add a new bot.',
    'Choose Generic bot, name it after your assistant, and press Create bot.',
  ],
  fields: [
    {
      key: 'site',
      label: 'Your Zulip address',
      placeholder: 'https://yourteam.zulipchat.com',
      secret: false,
    },
    { key: 'email', label: 'The bot’s email', secret: false },
    {
      key: 'apiKey',
      label: 'The bot’s API key',
      help: 'Shown beside the bot in Personal settings → Bots.',
      secret: true,
    },
  ],
};

export const zulipWords: AppWords = {
  from: 'Made by you',
  abilities: [
    {
      kind: 'channel',
      text: 'Lets you talk to your assistant on Zulip; only delivers messages, can’t read your chats or use your apps',
    },
    { kind: 'reach', text: 'Reaches yourteam.zulipchat.com' },
    { kind: 'nothing-else', text: 'Can’t read your files, run programs or see your other apps' },
    {
      kind: 'needs',
      text: 'Needs from you: Your Zulip address, The bot’s email, The bot’s API key (kept by Conch, never in the app)',
    },
  ],
};
