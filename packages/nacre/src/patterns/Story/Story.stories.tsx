import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { CodeBlock } from '../CodeBlock';
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
