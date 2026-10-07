/**
 * Real runs, for stories and tests: a coding turn (tests, reading, a commit
 * and a push) and a shopping one (three shirts compared on amazon.de).
 */
import type { StoryStackItem } from './StoryStack';
import type { StoryStepView } from './Story';
import type { StoryChip } from './types';

/** A favicon drawn as a data URL, so stories never reach the network. */
function favicon(bg: string, fg: string, letter: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="${bg}"/><text x="16" y="22.5" font-family="Helvetica,Arial,sans-serif" font-size="18" font-weight="700" text-anchor="middle" fill="${fg}">${letter}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** A product photo stand-in: a shirt in its colour on a soft ground. */
function shirt(colour: string, ground: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="${ground}"/><path d="M11 7l-5 3 2.2 4.2 2.3-1V25h11V13.2l2.3 1L26 10l-5-3c-.8 1.8-2.7 3-5 3s-4.2-1.2-5-3z" fill="${colour}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export const favicons = {
  amazon: favicon('#232F3E', '#FF9900', 'a'),
  zalando: favicon('#FF6900', '#ffffff', 'z'),
  otto: favicon('#D52B1E', '#ffffff', 'o'),
  idealo: favicon('#0A3761', '#ffffff', 'i'),
};

export const shirts: StoryChip[] = [
  { kind: 'site', label: 'amazon.de', href: 'https://www.amazon.de', image: favicons.amazon },
  {
    kind: 'image',
    label: 'Oxford shirt, slim fit · €39.90',
    href: 'https://www.amazon.de/dp/B0C1OXFORD',
    image: shirt('#9DB7D5', '#EEF2F7'),
  },
  {
    kind: 'image',
    label: 'Linen shirt, regular fit · €44.95',
    href: 'https://www.amazon.de/dp/B0C2LINEN',
    image: shirt('#E9E1D3', '#F6F3EE'),
  },
  {
    kind: 'image',
    label: 'Poplin shirt, non-iron · €34.99',
    href: 'https://www.amazon.de/dp/B0C3POPLIN',
    image: shirt('#FFFFFF', '#E4E7EB'),
  },
];

export const files: StoryChip[] = [
  { kind: 'file', label: 'Transcript.tsx', href: 'apps/web/src/features/chat/Transcript.tsx' },
  {
    kind: 'file',
    label: 'TranscriptItems.tsx',
    href: 'apps/web/src/features/chat/TranscriptItems.tsx',
  },
  { kind: 'file', label: 'reducer.ts', href: 'apps/web/src/live/reducer.ts' },
  { kind: 'file', label: 'activity.ts', href: 'packages/protocol/src/activity.ts' },
];

export const testSteps: StoryStepView[] = [
  {
    id: 'toolu_tests',
    text: 'Ran the server tests',
    outcome: '7,388 passed',
    status: 'success',
    family: 'verify',
    subject: 'pnpm --filter @conch/server test',
    durationMs: 38_200,
  },
];

export const readSteps: StoryStepView[] = [
  {
    id: 'toolu_read_1',
    text: 'Read Transcript.tsx',
    outcome: '612 lines',
    status: 'success',
    family: 'explore',
    subject: 'apps/web/src/features/chat/Transcript.tsx',
    durationMs: 40,
  },
  {
    id: 'toolu_read_2',
    text: 'Read TranscriptItems.tsx',
    outcome: '488 lines',
    status: 'success',
    family: 'explore',
    subject: 'apps/web/src/features/chat/TranscriptItems.tsx',
    durationMs: 35,
  },
  {
    id: 'toolu_grep',
    text: 'Searched the code for “ToolItem”',
    outcome: '3 matches',
    status: 'success',
    family: 'explore',
    subject: 'rg -n "ToolItem" apps/web/src',
    durationMs: 210,
  },
  {
    id: 'toolu_read_3',
    text: 'Read activity.ts',
    outcome: '128 lines',
    status: 'success',
    family: 'explore',
    subject: 'packages/protocol/src/activity.ts',
    durationMs: 30,
  },
];

export const shipSteps: StoryStepView[] = [
  {
    id: 'toolu_commit',
    text: 'Committed “feat(nacre): stories”',
    outcome: '4 files',
    status: 'success',
    family: 'ship',
    subject: 'git commit -m "feat(nacre): stories"',
    durationMs: 820,
  },
  {
    id: 'toolu_push',
    text: 'Pushed to main',
    outcome: '1 commit',
    status: 'success',
    family: 'ship',
    subject: 'git push origin main',
    durationMs: 2_400,
  },
];

export const shopSteps: StoryStepView[] = [
  {
    id: 'toolu_search',
    text: 'Searched amazon.de for “men’s shirt slim fit”',
    outcome: '48 results',
    status: 'success',
    family: 'browse',
    subject: 'https://www.amazon.de/s?k=men%27s+shirt+slim+fit',
    durationMs: 3_100,
  },
  {
    id: 'toolu_p1',
    text: 'Opened the Oxford shirt',
    outcome: '€39.90 · 4.5 stars',
    status: 'success',
    family: 'browse',
    subject: 'amazon.de/dp/B0C1OXFORD',
    durationMs: 2_200,
  },
  {
    id: 'toolu_p2',
    text: 'Opened the linen shirt',
    outcome: '€44.95 · 4.3 stars',
    status: 'success',
    family: 'browse',
    subject: 'amazon.de/dp/B0C2LINEN',
    durationMs: 2_600,
  },
  {
    id: 'toolu_p3',
    text: 'Opened the poplin shirt',
    outcome: '€34.99 · 4.6 stars',
    status: 'success',
    family: 'browse',
    subject: 'amazon.de/dp/B0C3POPLIN',
    durationMs: 1_900,
  },
];

/** A whole coding run, oldest first. */
export const codingRun: StoryStackItem[] = [
  {
    id: 'plan',
    headline: 'Made a plan',
    outcome: '4 steps',
    family: 'plan',
    status: 'done',
    steps: [
      {
        id: 'toolu_plan',
        text: 'Wrote the plan',
        outcome: '4 steps',
        status: 'success',
        family: 'plan',
        durationMs: 20,
      },
    ],
    durationMs: 20,
  },
  {
    id: 'read',
    headline: 'Read Transcript.tsx and 3 other files',
    family: 'explore',
    status: 'done',
    steps: readSteps,
    chips: files,
    durationMs: 1_300,
  },
  {
    id: 'remember',
    headline: 'Looked back at “Stories in chat”',
    family: 'remember',
    status: 'done',
    steps: [
      {
        id: 'toolu_mem',
        text: 'Searched past chats for “stories”',
        outcome: '2 chats',
        status: 'success',
        family: 'remember',
        durationMs: 180,
      },
    ],
    durationMs: 180,
  },
  {
    id: 'edit',
    headline: 'Changed TranscriptItems.tsx and 2 other files',
    outcome: '+184 −62',
    family: 'edit',
    status: 'done',
    steps: [
      {
        id: 'toolu_e1',
        text: 'Changed TranscriptItems.tsx',
        outcome: '+120 −48',
        status: 'success',
        family: 'edit',
        subject: 'apps/web/src/features/chat/TranscriptItems.tsx',
        durationMs: 60,
      },
      {
        id: 'toolu_e2',
        text: 'Changed Transcript.tsx',
        outcome: '+22 −14',
        status: 'success',
        family: 'edit',
        subject: 'apps/web/src/features/chat/Transcript.tsx',
        durationMs: 50,
      },
      {
        id: 'toolu_e3',
        text: 'Made stories.ts',
        outcome: '+42',
        status: 'success',
        family: 'edit',
        subject: 'apps/web/src/features/chat/stories.ts',
        durationMs: 40,
      },
    ],
    durationMs: 150,
  },
  {
    id: 'tests',
    headline: 'Ran the server tests',
    outcome: '241 files',
    family: 'verify',
    status: 'done',
    steps: testSteps,
    durationMs: 38_200,
  },
  {
    id: 'ship',
    headline: 'Committed and pushed to main',
    family: 'ship',
    status: 'done',
    steps: shipSteps,
    durationMs: 3_220,
  },
];
