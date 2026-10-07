import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { fn } from 'storybook/test';

import { Button } from '../../components/Button';
import { AwayDigest, type AwayDigestItem } from './AwayDigest';

const CODING: AwayDigestItem[] = [
  {
    id: 'read',
    headline: 'Read Transcript.tsx and 3 other files',
    family: 'explore',
    status: 'done',
  },
  {
    id: 'edit',
    headline: 'Changed TranscriptItems.tsx and 2 other files',
    outcome: '+184 −62',
    family: 'edit',
    status: 'done',
  },
  {
    id: 'tests',
    headline: 'Ran the server tests',
    outcome: '7,388 passed',
    family: 'verify',
    status: 'done',
  },
  { id: 'ship', headline: 'Committed and pushed to main', family: 'ship', status: 'done' },
];

const meta = {
  title: 'Patterns/Chat/AwayDigest',
  component: AwayDigest,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'When you come back to a chat that kept working while its tab was hidden: a soft card that says what happened, one line per story, the lines arriving one after another. Press a line to go to it in the chat. Dismissed, the card folds out of its place.',
      },
    },
  },
  args: { items: CODING, durationMs: 12 * 60_000 + 40_000, onJump: fn(), onDismiss: fn() },
  decorators: [(Story) => <div style={{ maxInlineSize: 640 }}>{Story()}</div>],
} satisfies Meta<typeof AwayDigest>;

export default meta;
type S = StoryObj<typeof meta>;

export const Playground: S = {};

/** One didn't work, one still going. */
export const Mixed: S = {
  args: {
    items: [
      ...CODING.slice(0, 2),
      {
        id: 'tests',
        headline: 'Ran the server tests',
        outcome: '3 failed',
        family: 'verify',
        status: 'failed',
      },
      {
        id: 'fix',
        headline: 'Fixing the failing tests',
        family: 'edit',
        status: 'running',
      },
    ],
  },
};

/** More than fit: the earliest fold into one line. */
export const Many: S = {
  args: {
    items: [
      { id: 'plan', headline: 'Made a plan', outcome: '4 steps', family: 'plan', status: 'done' },
      {
        id: 'mem',
        headline: 'Looked back at “Stories in chat”',
        family: 'remember',
        status: 'done',
      },
      ...CODING,
      {
        id: 'web',
        headline: 'Compared 3 shirts on amazon.de',
        outcome: 'Poplin is the best value',
        family: 'browse',
        status: 'done',
      },
    ],
  },
};

/** Coming back again: press Replay to see the cascade; Dismiss folds it away. */
function Replay() {
  const [n, setN] = useState(0);
  const [shown, setShown] = useState(true);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
      <Button
        size="sm"
        variant="soft"
        onClick={() => {
          setShown(true);
          setN((x) => x + 1);
        }}
      >
        Replay
      </Button>
      {shown && (
        <AwayDigest
          key={n}
          items={CODING}
          durationMs={760_000}
          onJump={() => {}}
          onDismiss={() => setShown(false)}
        />
      )}
      <p style={{ margin: 0, color: 'var(--nc-text-muted)', fontSize: 'var(--nc-text-sm)' }}>
        The reply goes on here.
      </p>
    </div>
  );
}

export const Arriving: S = { render: () => <Replay /> };

export const Mobile: S = {
  decorators: [(Story) => <div style={{ inlineSize: 358 }}>{Story()}</div>],
  args: Mixed.args,
};

export const ReducedMotion: S = { globals: { motion: 'reduced' } };

export const Dark: S = { globals: { mode: 'dark' }, args: Mixed.args };
