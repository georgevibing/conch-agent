import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';

import { CodeBlock } from '../CodeBlock';
import { codingRun, shirts, shopSteps } from './fixtures';
import type { StoryStepView } from './Story';
import { StoryStack, type StoryStackItem } from './StoryStack';

const meta = {
  title: 'Patterns/Chat/StoryStack',
  component: StoryStack,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'One run’s stories in a tight column. Past four, the earlier ones fold into one quiet line, with their glyphs, that opens to them; the latest stay in view. Stories come as data (`stories`), each carrying anything a `Story` takes; `renderRaw`, `renderFound` and `onExplain` given here reach every story.',
      },
    },
  },
  args: {
    stories: codingRun,
    renderRaw: (id: string) => <CodeBlock code={`{ "tool_use_id": "${id}" }`} language="json" />,
    onExplain: async () => 'To check nothing else depended on the old rows before changing them.',
  },
  decorators: [(Story) => <div style={{ maxInlineSize: 640 }}>{Story()}</div>],
} satisfies Meta<typeof StoryStack>;

export default meta;
type S = StoryObj<typeof meta>;

/** A finished coding run: six stories, the first three folded into a line. */
export const Many: S = {};

/** The fold, opened. */
export const EarlierShown: S = { args: { defaultShowEarlier: true } };

/** A short run: nothing to fold. */
export const Few: S = { args: { stories: codingRun.slice(-3) } };

const SHOPPING: StoryStackItem[] = [
  {
    id: 'shop-search',
    headline: 'Searched amazon.de for shirts',
    outcome: '48 results',
    family: 'browse',
    status: 'done',
    steps: shopSteps.slice(0, 1),
    chips: shirts.slice(0, 1),
    durationMs: 3_100,
  },
];

/** A run arriving: earlier stories land, the newest runs with its live line. Loops. */
function Live() {
  const [beat, setBeat] = useState(0);
  const [startedAt] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setBeat((b) => (b + 1) % 6), 2000);
    return () => clearInterval(id);
  }, []);
  const running: StoryStepView = {
    ...(shopSteps[1] as StoryStepView),
    status: 'running',
    text: 'Opening the Oxford shirt',
    outcome: undefined,
  };
  const comparing: StoryStackItem =
    beat < 4
      ? {
          id: 'shop-compare',
          headline: 'Comparing shirts on amazon.de',
          family: 'browse',
          status: 'running',
          live: [
            'Opening the Oxford shirt',
            'Reading its reviews',
            'Opening the linen shirt',
            'Opening the poplin shirt',
          ][beat],
          steps: [running],
          chips: shirts.slice(0, beat + 2),
          startedAt,
        }
      : {
          id: 'shop-compare',
          headline: 'Compared 3 shirts on amazon.de',
          outcome: 'Poplin is the best value',
          family: 'browse',
          status: 'done',
          steps: shopSteps.slice(1),
          chips: shirts,
          durationMs: 6_700,
        };
  return <StoryStack stories={[...codingRun.slice(0, 2), ...SHOPPING, comparing]} arriving />;
}

export const Arriving: S = { render: () => <Live /> };

export const Mobile: S = {
  decorators: [(Story) => <div style={{ inlineSize: 358 }}>{Story()}</div>],
};

export const Dark: S = { globals: { mode: 'dark' }, args: { defaultShowEarlier: true } };
