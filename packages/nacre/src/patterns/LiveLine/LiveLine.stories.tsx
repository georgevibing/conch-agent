import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';

import { LiveLine, type LiveLineProps } from './LiveLine';

const meta = {
  title: 'Patterns/Chat/LiveLine',
  component: LiveLine,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'One line that says what’s happening now and changes in place: the old words drift up and blur away as the new ones rise in, inside a height that never changes. Changes faster than about 600 ms are coalesced, so it never flickers; a band of light sweeps across while the work goes on. The assistant’s own narration wears the reasoning trail’s serif italic. Screen readers hear it once it settles.',
      },
    },
  },
  args: { text: 'Running the server tests' },
  decorators: [(Story) => <div style={{ maxInlineSize: 480 }}>{Story()}</div>],
} satisfies Meta<typeof LiveLine>;

export default meta;
type S = StoryObj<typeof meta>;

export const Playground: S = {};

const CODING = [
  'Reading Transcript.tsx',
  'Reading TranscriptItems.tsx',
  'Searching the code for “ToolItem”',
  'Changing TranscriptItems.tsx',
  'Running the server tests',
  'Committing the changes',
  'Pushing to main',
];

/** A new line every so often, with a text in between that the throttle folds away. */
function Cycling({
  lines,
  every = 1500,
  ...props
}: Partial<LiveLineProps> & { lines: string[]; every?: number }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((n) => (n + 1) % lines.length), every);
    return () => clearInterval(id);
  }, [lines.length, every]);
  return <LiveLine text={lines[i] ?? ''} {...props} />;
}

export const Changing: S = { render: () => <Cycling lines={CODING} /> };

/** A burst of changes every 150 ms: only every ~600 ms does the line move, to the newest. */
export const Coalesced: S = { render: () => <Cycling lines={CODING} every={150} /> };

/** The assistant narrating, in its own words. */
export const Narration: S = {
  render: () => (
    <Cycling
      source="provider"
      every={2400}
      lines={[
        'Let me look at how the rows are drawn first.',
        'The tests pass, so I’ll commit this.',
        'Pushing it to main now.',
      ]}
    />
  ),
};

export const Quiet: S = { args: { tone: 'quiet', text: 'Waiting for the build to start' } };
export const Warning: S = {
  args: { tone: 'warning', active: false, text: 'Still waiting for GitHub to answer' },
};

/** Long words end in an ellipsis on the one line. */
export const Long: S = {
  args: {
    text: 'Reading apps/web/src/features/chat/TranscriptItems.tsx and the eleven files it imports, to see where rows are drawn',
  },
};

export const ReducedMotion: S = {
  globals: { motion: 'reduced' },
  render: () => <Cycling lines={CODING} />,
};

export const Dark: S = { globals: { mode: 'dark' }, render: () => <Cycling lines={CODING} /> };
