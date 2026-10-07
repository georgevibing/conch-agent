import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';

import { TurnMeter } from './TurnMeter';

const meta = {
  title: 'Patterns/Chat/TurnMeter',
  component: TurnMeter,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A quiet tally for a turn: how long, how many steps, what it cost, what it wrote. While it runs, a small pearl breathes, the clock ticks and the counts roll on their wheels; once it ends it’s a still line. Screen readers hear one plain sentence, not the ticking.',
      },
    },
  },
  args: { steps: 12, durationMs: 64_000, costUsd: 0.04, tokens: 41_240, running: false },
} satisfies Meta<typeof TurnMeter>;

export default meta;
type S = StoryObj<typeof meta>;

export const Finished: S = {};

/** Running: steps and tokens climb as they would. */
function Live() {
  const [startedAt] = useState(() => Date.now() - 52_000);
  const [steps, setSteps] = useState(7);
  const [tokens, setTokens] = useState(18_400);
  useEffect(() => {
    const id = setInterval(() => {
      setSteps((s) => s + 1);
      setTokens((t) => t + 1_850);
    }, 2200);
    return () => clearInterval(id);
  }, []);
  return <TurnMeter running startedAt={startedAt} steps={steps} tokens={tokens} costUsd={0.03} />;
}

export const Running: S = { render: () => <Live /> };

/** On a plan or on this computer: no money to show. */
export const NoCost: S = {
  args: { costUsd: undefined, tokens: undefined, steps: 3, durationMs: 9_000 },
};

/** A long job. */
export const Long: S = {
  args: { steps: 214, durationMs: 76 * 60_000, costUsd: 3.42, tokens: 1_240_000 },
};

export const Dark: S = { globals: { mode: 'dark' }, render: () => <Live /> };
