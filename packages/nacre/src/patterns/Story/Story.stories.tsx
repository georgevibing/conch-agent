import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { CodeBlock } from '../CodeBlock';
import { RememberedNote } from '../Memory';
import { Sources } from '../ToolViews';
import { favicons, files, readSteps, shipSteps, shirts, shopSteps, testSteps } from './fixtures';
import { Story, type StoryProps, type StoryStepView } from './Story';
import { STORY_FAMILIES } from './types';

const RAW: Record<string, string> = {
  toolu_tests: `$ pnpm --filter @conch/server test\n\n Test Files  241 passed (241)\n      Tests  7388 passed (7388)\n   Duration  38.20s`,
  toolu_commit: `$ git commit -m "feat(nacre): stories"\n[main 4f2a9c1] feat(nacre): stories\n 4 files changed, 184 insertions(+), 62 deletions(-)`,
  toolu_push: `$ git push origin main\nTo github.com:conch/conch.git\n   1dfc1e1..4f2a9c1  main -> main`,
  toolu_read_1: `Read apps/web/src/features/chat/Transcript.tsx (612 lines)`,
};

const renderRaw = (id: string) => (
  <CodeBlock code={RAW[id] ?? `{ "tool_use_id": "${id}" }`} language="bash" maxLines={10} />
);

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const meta = {
  title: 'Patterns/Chat/Story',
  component: Story,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A run of the assistant’s steps, told as one line (ADR 0103). The family’s glyph, a headline in plain words, a quiet outcome, what it touched, how many steps and how long. While it runs, one part of the glyph moves, an arc of light orbits it, and a line beneath says the step at hand, changing in place. Open it for the steps on a thin timeline: each asks “Why?” and opens once more to the exact call. A failure is a warm note, never a red flood.',
      },
    },
  },
  args: {
    headline: 'Ran the server tests',
    outcome: '241 files',
    family: 'verify',
    status: 'done',
    steps: testSteps,
    durationMs: 38_200,
    renderRaw,
  },
  decorators: [(Story) => <div style={{ maxInlineSize: 640 }}>{Story()}</div>],
} satisfies Meta<typeof Story>;

export default meta;
type S = StoryObj<typeof meta>;

/** The meta's args, for stories that draw several rows by hand. */
const base = meta.args as StoryProps;

export const Playground: S = {};

/** Finished: the glyph's well with a small check, the duration, closed. */
export const Done: S = {};

/** The coding run's three stories, as they read in a finished reply. */
export const Coding: S = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <Story
        headline="Read Transcript.tsx and 3 other files"
        family="explore"
        status="done"
        steps={readSteps}
        chips={files}
        durationMs={1_300}
        renderRaw={renderRaw}
      />
      <Story
        headline="Ran the server tests"
        outcome="241 files"
        family="verify"
        status="done"
        steps={testSteps}
        durationMs={38_200}
        renderRaw={renderRaw}
      />
      <Story
        headline="Committed and pushed to main"
        family="ship"
        status="done"
        steps={shipSteps}
        durationMs={3_220}
        renderRaw={renderRaw}
      />
    </div>
  ),
};

const [search, oxford, linen, poplin] = shopSteps as [
  StoryStepView,
  StoryStepView,
  StoryStepView,
  StoryStepView,
];
const [tests] = testSteps as [StoryStepView];
const [commit, push] = shipSteps as [StoryStepView, StoryStepView];

const doing = (step: StoryStepView, text: string): StoryStepView => ({
  ...step,
  text,
  status: 'running',
  outcome: undefined,
});

const RUN: { live: string; step: StoryStepView }[] = [
  {
    live: 'Searching amazon.de for “men’s shirt slim fit”',
    step: doing(search, 'Searching amazon.de'),
  },
  { live: 'Opening the Oxford shirt', step: doing(oxford, 'Opening the Oxford shirt') },
  {
    live: 'Reading the reviews of the Oxford shirt',
    step: doing(oxford, 'Opening the Oxford shirt'),
  },
  { live: 'Opening the linen shirt', step: doing(linen, 'Opening the linen shirt') },
  { live: 'Opening the poplin shirt', step: doing(poplin, 'Opening the poplin shirt') },
];

/** How many beats the run rests, done, before it starts again. */
const REST = 3;

/** A run that plays itself: steps arrive, the line beneath changes, then it lands and starts again. */
function LiveRun(props: Partial<StoryProps>) {
  const [run, setRun] = useState(() => ({ tick: 0, startedAt: Date.now() }));
  useEffect(() => {
    const id = setInterval(
      () =>
        setRun((r) => {
          const tick = (r.tick + 1) % (RUN.length + REST);
          return { tick, startedAt: tick === 0 ? Date.now() : r.startedAt };
        }),
      1800,
    );
    return () => clearInterval(id);
  }, []);
  const now = RUN[run.tick];
  const steps: StoryStepView[] = now
    ? [
        ...shopSteps.slice(
          0,
          shopSteps.findIndex((s) => s.id === now.step.id),
        ),
        now.step,
      ]
    : shopSteps;
  const seen = shirts.slice(0, now ? Math.min(4, run.tick + 1) : 4);
  return (
    <Story
      headline={now ? 'Comparing shirts on amazon.de' : 'Compared 3 shirts on amazon.de'}
      outcome={now ? undefined : 'Poplin is the best value'}
      family="browse"
      status={now ? 'running' : 'done'}
      live={now?.live}
      steps={steps}
      chips={seen}
      startedAt={run.startedAt}
      durationMs={now ? undefined : 9_800}
      renderRaw={renderRaw}
      arriving
      {...props}
    />
  );
}

/** Running: the glyph lives, the clock ticks, the line beneath changes in place. Loops. */
export const Running: S = { render: () => <LiveRun /> };

/** The same run, opened: steps join the timeline as they start, the running one shimmering. */
export const RunningOpen: S = { render: () => <LiveRun defaultOpen /> };

/** The assistant narrating in its own words: set in the serif italic of the reasoning trail. */
export const Narrated: S = {
  args: {
    headline: 'Running the server tests',
    outcome: undefined,
    status: 'running',
    live: 'Let me make sure nothing else broke before I push.',
    liveSource: 'provider',
    steps: [doing(tests, 'Running the server tests')],
    startedAt: Date.now() - 14_000,
    durationMs: undefined,
  },
};

/** A grouped run reading code, the assistant narrating the step at hand beneath it. */
const narratedGroup = {
  headline: 'Reading 3 files',
  outcome: '25 matches',
  family: 'explore',
  status: 'running',
  live: 'Read guard refusal helper',
  liveSource: 'provider',
  steps: [...readSteps.slice(0, 3), doing(readSteps[3] as StoryStepView, 'Reading activity.ts')],
  chips: files,
  startedAt: Date.now() - 34_000,
  durationMs: undefined,
} satisfies Partial<StoryProps>;

/**
 * The row and its line beneath are one surface: hover anywhere on either and
 * the wash, the lustre rim and the press take in both, so the line never sits
 * half outside the row's highlight. Pressing the line opens the row.
 */
export const NarratedGroup: S = {
  args: narratedGroup,
  play: async ({ canvasElement }) => {
    const row = within(canvasElement).getByRole('button', { name: /^Reading 3 files/ });
    const line = within(canvasElement).getByText('Read guard refusal helper');
    const surface = row.parentElement as HTMLElement;
    const [s, l] = [surface.getBoundingClientRect(), line.getBoundingClientRect()];
    // The line sits inside the surface that's washed on hover…
    await expect(l.top).toBeGreaterThanOrEqual(s.top);
    await expect(l.bottom).toBeLessThanOrEqual(s.bottom);
    // …and a press on it lands on the row.
    const hit = canvasElement.ownerDocument.elementFromPoint(
      l.left + l.width / 2,
      l.top + l.height / 2,
    );
    await expect(hit).toBe(row);
  },
};

/** Focused from the keyboard: the ring goes round the row and its line, as the hover wash does. */
export const NarratedGroupFocused: S = {
  args: narratedGroup,
  play: async ({ canvasElement }) => {
    await userEvent.tab();
    await expect(
      within(canvasElement).getByRole('button', { name: /^Reading 3 files/ }),
    ).toHaveFocus();
  },
};

/** Didn't work: a warm note on the well and the outcome, never red. */
export const Failed: S = {
  args: {
    headline: 'Ran the server tests',
    outcome: '3 failed',
    status: 'failed',
    steps: [
      {
        ...tests,
        outcome: '3 failed, 7,385 passed',
        status: 'error',
        failed: true,
      },
    ],
    defaultOpen: true,
  },
};

/**
 * Not run: you said no (or a rule did). A quiet gray slash on the well and the
 * step, the words a shade softer: neither the check of done nor a failure's note.
 */
export const Declined: S = {
  args: {
    headline: 'Pushed to main',
    outcome: 'You said no',
    family: 'ship',
    status: 'declined',
    steps: [{ ...push, outcome: 'You said no', status: 'declined', durationMs: undefined }],
    durationMs: undefined,
    defaultOpen: true,
  },
};

/** Some steps ran and one you said no to: the story is done, the step says it didn't run. */
export const PartlyDeclined: S = {
  args: {
    headline: 'Committed “Fix the login test”',
    outcome: undefined,
    family: 'ship',
    status: 'done',
    steps: [commit, { ...push, outcome: 'Not allowed', status: 'declined', durationMs: undefined }],
    durationMs: 1_400,
    defaultOpen: true,
  },
};

/** Taking longer than it should: a gentle sentence in place of the live line. */
export const Stuck: S = {
  args: {
    headline: 'Pushing to main',
    outcome: undefined,
    family: 'ship',
    status: 'running',
    stuck: 'Still waiting for GitHub to answer. It usually takes a few seconds.',
    steps: [commit, doing(push, 'Pushing to main')],
    startedAt: Date.now() - 74_000,
    durationMs: undefined,
  },
};

/**
 * A provider waiting the slow way, checking on a command again and again
 * (Conch's `wait_for` is the quick way, ADR 0125): said calmly, in the row's
 * own ink, never as a warning.
 */
export const WaitingTheSlowWay: S = {
  args: {
    headline: 'Checking on a command',
    outcome: undefined,
    family: 'run',
    status: 'running',
    stuck: 'Still running · checked 4 times in 2 minutes, nothing new yet',
    stuckTone: 'calm',
    steps: [commit, doing(push, 'Checking on a command')],
    startedAt: Date.now() - 140_000,
    durationMs: undefined,
  },
};

/** What it looked at: favicons and product photos stacked in the row, pills when open. */
export const WithChips: S = {
  args: {
    headline: 'Compared 3 shirts on amazon.de',
    outcome: 'Poplin is the best value',
    family: 'browse',
    steps: shopSteps,
    chips: shirts,
    durationMs: 9_800,
  },
};

/** Opened on the shopping run: the chips as links, and what a search found under its step. */
export const WithChipsOpen: S = {
  render: (args) => (
    <Story
      {...args}
      {...(WithChips.args as StoryProps)}
      defaultOpen
      chips={[
        ...shirts,
        { kind: 'site', label: 'idealo.de', href: 'https://www.idealo.de', image: favicons.idealo },
      ]}
      renderFound={(id) =>
        id === 'toolu_search' ? (
          <Sources
            sources={[
              {
                title: 'Oxford shirt, slim fit, long sleeve',
                url: 'https://www.amazon.de/dp/B0C1OXFORD',
                snippet: '€39.90 · 4.5 out of 5 stars · 2,140 ratings',
              },
              {
                title: 'Linen shirt, regular fit',
                url: 'https://www.amazon.de/dp/B0C2LINEN',
                snippet: '€44.95 · 4.3 out of 5 stars · 812 ratings',
              },
            ]}
          />
        ) : null
      }
    />
  ),
};

/** The same call, repeated, folded into one story: "×3" in the row, a quiet line when open. */
export const Repeats: S = {
  args: {
    headline: 'Checked the deploy',
    outcome: 'live',
    family: 'run',
    repeats: 2,
    steps: [
      {
        id: 'toolu_poll',
        text: 'Checked the deploy',
        outcome: 'live on conch.app',
        status: 'success',
        family: 'run',
        subject: 'gh run watch 1184',
        durationMs: 6_100,
      },
    ],
    durationMs: 18_400,
    defaultOpen: true,
  },
};

/** The rules' headline, then a small model's: the words that change blur across, nothing moves. */
function Retitled() {
  const [model, setModel] = useState(false);
  useEffect(() => {
    const id = setInterval(() => setModel((m) => !m), 2600);
    return () => clearInterval(id);
  }, []);
  return (
    <Story
      headline={model ? 'Pushed the fixes to main' : 'Ran 2 git commands'}
      outcome={model ? '1 commit' : undefined}
      headlineSource={model ? 'model' : 'rule'}
      family="ship"
      status="done"
      steps={shipSteps}
      durationMs={3_220}
      arriving
    />
  );
}

export const ModelHeadline: S = { render: () => <Retitled /> };

/** Tests that pass, landing: "Running" becomes "Ran", the check draws itself, one glint. Loops. */
function LandingRun() {
  const [run, setRun] = useState(() => ({ done: false, startedAt: Date.now() }));
  useEffect(() => {
    const id = setInterval(
      () => setRun((r) => ({ done: !r.done, startedAt: r.done ? Date.now() : r.startedAt })),
      2800,
    );
    return () => clearInterval(id);
  }, []);
  const { done, startedAt } = run;
  return (
    <Story
      headline={done ? 'Ran the server tests' : 'Running the server tests'}
      outcome={done ? '7,388 passed' : undefined}
      family="verify"
      status={done ? 'done' : 'running'}
      live={done ? undefined : 'Running 241 test files'}
      steps={[done ? tests : doing(tests, 'Running the server tests')]}
      startedAt={startedAt}
      durationMs={done ? 38_200 : undefined}
      arriving
    />
  );
}

export const Landing: S = { render: () => <LandingRun /> };

/** Opened: the timeline, its thread through each step's dot, every step a press from its raw call. */
export const Expanded: S = {
  args: {
    headline: 'Read Transcript.tsx and 3 other files',
    outcome: undefined,
    family: 'explore',
    steps: readSteps,
    chips: files,
    durationMs: 1_300,
    defaultOpen: true,
    onExplain: async () => 'To see where tool rows are drawn before changing them.',
  },
};

/** The third level: a step opened to the exact call. */
export const ExpandedRaw: S = {
  args: { ...Expanded.args, steps: readSteps, headline: 'Read Transcript.tsx and 3 other files' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole('button', { name: /^Read Transcript\.tsx\s+612 lines/ }),
    );
    await expect(
      canvas.getByRole('button', { name: /^Read Transcript\.tsx\s+612 lines/ }),
    ).toHaveAttribute('aria-expanded', 'true');
  },
};

const ANSWER =
  'The tests were run before pushing, so a change that breaks the server never reaches main. All 241 files passed, so it went ahead.';

/** "Why?", answered: the words arrive one after another, like the reply's own. */
export const WhyAnswer: S = {
  args: {
    defaultOpen: true,
    onExplain: async () => {
      await wait(900);
      return ANSWER;
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Why?' }));
    await canvas.findByText(/never reaches main/, undefined, { timeout: 4000 });
  },
};

/** "Why?", while it's being asked. */
export const WhyLoading: S = {
  args: { defaultOpen: true, onExplain: () => new Promise(() => {}) },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Why?' }));
  },
};

/** "Why?" with no one to ask: a quiet line, no bubble. */
export const WhyUnavailable: S = {
  args: {
    defaultOpen: true,
    onExplain: async () => ({ unavailable: 'None of your providers can answer this right now.' }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Why?' }));
    await canvas.findByText(/None of your providers/);
  },
};

/** Long words give way with an ellipsis: the outcome first, then the headline; the meta stays. */
export const LongText: S = {
  args: {
    headline:
      'Read the whole of apps/web/src/features/chat/TranscriptItems.tsx and the eleven files it imports',
    outcome: 'Nothing there draws a story yet, so the rows are built from scratch',
    family: 'explore',
    steps: readSteps,
    chips: files,
    durationMs: 1_300,
  },
};

/** At a phone's width: the step count gives way, the rest holds. */
export const Mobile: S = {
  render: () => (
    <div style={{ inlineSize: 358, display: 'flex', flexDirection: 'column' }}>
      <Story {...base} {...(WithChips.args as Partial<StoryProps>)} />
      <LiveRun />
      <Story {...base} />
      <Story {...base} {...(Failed.args as Partial<StoryProps>)} defaultOpen={false} />
    </div>
  ),
};

/** Every family's glyph, running (each with its own small motion) and done. */
export const Families: S = {
  render: () => (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 24 }}>
      {STORY_FAMILIES.map((family) => (
        <div key={family} style={{ display: 'contents' }}>
          <Story
            headline={family.charAt(0).toUpperCase() + family.slice(1)}
            family={family}
            status="running"
            steps={[]}
          />
          <Story
            headline={family.charAt(0).toUpperCase() + family.slice(1)}
            family={family}
            status={family === 'other' ? 'failed' : 'done'}
            steps={[]}
          />
        </div>
      ))}
    </div>
  ),
};

/** With reduced motion: nothing orbits, shimmers or morphs; every change is simply there. */
export const ReducedMotion: S = {
  globals: { motion: 'reduced' },
  render: () => <LiveRun defaultOpen />,
};

/** One kind of run, two steps long, as it reads while it works and between its steps. */
interface Between {
  family: StoryProps['family'];
  doing: string;
  did: string;
  first: [doing: string, done: string, live: string];
  second: [doing: string, done: string, live: string];
}

const YAZIO: Between = {
  family: 'connect',
  doing: 'Using Yazio',
  did: 'Used Yazio',
  first: ['Reading the diary in Yazio', 'Read the diary in Yazio', 'Using app yazio read diary'],
  second: ['Logging lunch in Yazio', 'Logged lunch in Yazio', 'Using app yazio log meal'],
};

const KINDS: Between[] = [
  {
    family: 'browse',
    doing: 'Comparing shirts on amazon.de',
    did: 'Compared shirts on amazon.de',
    first: ['Searching amazon.de', 'Searched amazon.de', 'Searching amazon.de for “oxford shirt”'],
    second: ['Opening the Oxford shirt', 'Opened the Oxford shirt', 'Reading its reviews'],
  },
  {
    family: 'edit',
    doing: 'Editing Story.tsx',
    did: 'Edited Story.tsx',
    first: ['Editing Story.tsx', 'Edited Story.tsx', 'Editing Story.tsx'],
    second: ['Editing Story.module.css', 'Edited Story.module.css', 'Editing Story.module.css'],
  },
  {
    family: 'research',
    doing: 'Searching the web',
    did: 'Searched the web',
    first: ['Searching for “yazio api”', 'Searched for “yazio api”', 'Searching for “yazio api”'],
    second: ['Reading yazio.com', 'Read yazio.com', 'Reading yazio.com'],
  },
  {
    family: 'remember',
    doing: 'Remembering',
    did: 'Remembered 2 things',
    first: ['Remembering your weight', 'Remembered your weight', 'Remembering your weight'],
    second: ['Remembering your goal', 'Remembered your goal', 'Remembering your goal'],
  },
];

/** A → gap → B → gap → the reply: the beats a live run goes through. */
const BEATS = ['first', 'between', 'second', 'after', 'over'] as const;
type Beat = (typeof BEATS)[number];

function betweenProps(run: Between, beat: Beat, startedAt: number): StoryProps {
  const step = (id: string, [doing, done]: Between['first'], running: boolean): StoryStepView => ({
    id,
    text: running ? doing : done,
    status: running ? 'running' : 'success',
    family: run.family,
    ...(!running && { durationMs: 1_400 }),
  });
  const a = step(`${run.family}-a`, run.first, beat === 'first');
  const b = step(`${run.family}-b`, run.second, beat === 'second');
  const steps = beat === 'first' || beat === 'between' ? [a] : [a, b];
  const working = beat === 'first' || beat === 'second';
  return {
    // What the rules say: past tense as soon as no step runs. The row holds it while the run goes on.
    headline: working ? run.doing : run.did,
    family: run.family,
    status: working ? 'running' : 'done',
    continuing: beat === 'between' || beat === 'after',
    ...(beat === 'first' && { live: run.first[2] }),
    ...(beat === 'second' && { live: run.second[2] }),
    steps,
    startedAt,
    ...(!working && { durationMs: Date.now() - startedAt }),
    arriving: true,
  };
}

/** Plays the beats one after another, `beat` ms apart, and starts again; `data-beat` says where it is. */
function BetweenRuns({ runs, beat = 1600 }: { runs: Between[]; beat?: number }) {
  const [at, setAt] = useState(() => ({ n: 0, startedAt: Date.now() }));
  useEffect(() => {
    const id = setInterval(
      () =>
        setAt((was) => {
          const n = (was.n + 1) % (BEATS.length + 1);
          return { n, startedAt: n === 0 ? Date.now() : was.startedAt };
        }),
      beat,
    );
    return () => clearInterval(id);
  }, [beat]);
  const now = BEATS[Math.min(at.n, BEATS.length - 1)] as Beat;
  return (
    <div data-beat={now} style={{ display: 'flex', flexDirection: 'column' }}>
      {runs.map((run) => (
        <Story key={run.family} {...betweenProps(run, now, at.startedAt)} />
      ))}
      <p style={{ margin: '8px 0 0', font: 'inherit', fontSize: 14 }}>
        {now === 'over' ? 'You had 640 kcal for lunch, 180 under your goal.' : ' '}
      </p>
    </div>
  );
}

/**
 * Asserts the rows stay the same elements, at the same height, from the first
 * step through the pause between steps to the second and the pause after it.
 */
async function holdsSteady(canvasElement: HTMLElement) {
  const root = () => canvasElement.querySelector<HTMLElement>('[data-beat]');
  await waitFor(() => expect(root()?.dataset.beat).toBe('first'), { timeout: 15_000 });
  const rows = [...canvasElement.querySelectorAll<HTMLElement>('div[data-family]')];
  const tall = rows.map((r) => r.offsetHeight);
  const resized: number[] = [];
  const watch = new ResizeObserver((entries) => {
    for (const e of entries) resized.push(Math.round(e.contentRect.height));
  });
  rows.forEach((r) => watch.observe(r));
  for (const beat of ['between', 'second', 'after'] as const) {
    await waitFor(() => expect(root()?.dataset.beat).toBe(beat), { timeout: 5_000 });
    // Let anything that would move, move.
    await wait(450);
    const now = [...canvasElement.querySelectorAll<HTMLElement>('div[data-family]')];
    for (const [i, r] of now.entries()) {
      await expect(r).toBe(rows[i]);
      await expect(r).toHaveAttribute('data-status', 'running');
    }
    await expect(now.map((r) => r.offsetHeight)).toEqual(tall);
  }
  watch.disconnect();
  // The first callback reports the size it started at; nothing after it changed.
  await expect(new Set(resized).size).toBeLessThanOrEqual(1);
}

/**
 * Between two steps (the assistant thinking about what the first found), the
 * row holds as it was while working: the same words, the clock going on, the
 * line beneath saying “Thinking…”. Nothing folds and comes back, so nothing
 * under it moves. Once the reply comes, it lands and folds to its line.
 */
export const BetweenSteps: S = {
  render: () => <BetweenRuns runs={[YAZIO]} />,
  play: async ({ canvasElement }) => holdsSteady(canvasElement),
};

/** The same, for each kind of step: browsing, file edits, searches, memories. */
export const BetweenStepsKinds: S = {
  render: () => <BetweenRuns runs={[YAZIO, ...KINDS]} />,
  play: async ({ canvasElement }) => holdsSteady(canvasElement),
};

/** With reduced motion: the words swap at once, nothing slides, and the height still holds. */
export const BetweenStepsReducedMotion: S = {
  globals: { motion: 'reduced' },
  render: () => <BetweenRuns runs={[YAZIO]} />,
  play: async ({ canvasElement }) => holdsSteady(canvasElement),
};

const WEIGHT = 'George reported a weight of 82.4 kg on 9 October, down from 83.1 kg a week before.';

const memoryStep = (id: string, text: string, outcome?: string): StoryStepView => ({
  id,
  text,
  ...(outcome && { outcome }),
  status: 'success',
  family: 'remember',
  explainable: false,
});

const appStep: StoryStepView = {
  id: 'toolu_diary',
  text: 'Looked at a diary in Yazio',
  outcome: '3 entries',
  status: 'success',
  family: 'connect',
  subject: 'read_diary',
  durationMs: 38_000,
};

/**
 * What it remembered, told like any other step (ADR 0103): a row with the
 * family's glyph; opened, the memory in full and a quiet Undo, placed like
 * Why?. A step said by its own event has no Why?.
 */
export const Remembered: S = {
  args: {
    headline: 'Remembered something',
    outcome: undefined,
    family: 'remember',
    steps: [memoryStep('mem-1', 'Remembered something')],
    durationMs: undefined,
    defaultOpen: true,
    renderRaw: undefined,
    onExplain: async () => 'Never asked: a memory step has no Why?.',
    renderFound: () => <RememberedNote text={WEIGHT} state="kept" onUndo={() => {}} />,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(WEIGHT)).toBeVisible();
    await expect(canvas.queryByRole('button', { name: 'Why?' })).toBeNull();
    await expect(canvas.getByRole('button', { name: `Undo “${WEIGHT}”` })).toBeVisible();
  },
};

/** In a run: the app's step and the memory share one story and one timeline. */
export const RememberedInARun: S = {
  args: {
    headline: 'Looked at a diary in Yazio and remembered something',
    outcome: undefined,
    family: 'connect',
    steps: [appStep, memoryStep('mem-1', 'Remembered something')],
    durationMs: 38_000,
    defaultOpen: true,
    onExplain: async () => 'To see what George logged today.',
    renderFound: (id) =>
      id === 'mem-1' ? <RememberedNote text={WEIGHT} state="kept" onUndo={() => {}} /> : undefined,
  },
};

/** Taken back, and one it forgot: the words stay, quieter; Undo goes once there's nothing to undo. */
export const RememberedUndone: S = {
  args: {
    headline: 'Remembered something and forgot something',
    outcome: undefined,
    family: 'remember',
    steps: [
      memoryStep('mem-1', 'Remembered something', 'Undone'),
      memoryStep('mem-2', 'Forgot something'),
    ],
    durationMs: undefined,
    defaultOpen: true,
    renderRaw: undefined,
    renderFound: (id) =>
      id === 'mem-1' ? (
        <RememberedNote text={WEIGHT} state="undone" />
      ) : (
        <RememberedNote text="George lives in Munich" state="forgotten" onUndo={() => {}} />
      ),
  },
};

export const Dark: S = {
  globals: { mode: 'dark' },
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <LiveRun />
      <Story {...base} {...(WithChips.args as Partial<StoryProps>)} />
      <Story {...base} {...(Failed.args as Partial<StoryProps>)} />
    </div>
  ),
};
