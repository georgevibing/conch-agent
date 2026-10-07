import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { WhatChanged, type WhatChangedGroup, type WhatChangedProps } from './WhatChanged';

const CODING: WhatChangedGroup[] = [
  {
    kind: 'file',
    text: 'Changed 4 files',
    items: [
      {
        kind: 'file',
        text: 'Changed TranscriptItems.tsx',
        target: 'apps/web/src/features/chat/TranscriptItems.tsx',
        undo: 'cs-1',
      },
      {
        kind: 'file',
        text: 'Changed Transcript.tsx',
        target: 'apps/web/src/features/chat/Transcript.tsx',
        undo: 'cs-2',
      },
      {
        kind: 'file',
        text: 'Made stories.ts',
        target: 'apps/web/src/features/chat/stories.ts',
        undo: 'cs-3',
      },
      {
        kind: 'file',
        text: 'Changed activity.ts',
        target: 'packages/protocol/src/activity.ts',
        undo: 'cs-4',
      },
    ],
  },
  {
    kind: 'commit',
    text: 'Committed',
    items: [{ kind: 'commit', text: 'Committed “feat(nacre): stories”', target: '4f2a9c1' }],
  },
  {
    kind: 'push',
    text: 'Pushed to main',
    items: [{ kind: 'push', text: 'Pushed 1 commit to main', target: 'github.com/conch/conch' }],
  },
];

const SHOPPING: WhatChangedGroup[] = [
  {
    kind: 'schedule',
    text: 'Added a reminder',
    items: [
      {
        kind: 'schedule',
        text: 'Added “Parcel arrives” to your calendar',
        target: 'Thursday, 10:00',
        undo: 'cs-cal',
      },
    ],
  },
  {
    kind: 'purchase',
    text: 'Bought the poplin shirt',
    items: [
      { kind: 'purchase', text: 'Bought the poplin shirt, non-iron', target: '€34.99 · amazon.de' },
    ],
  },
  {
    kind: 'send',
    text: 'Sent an email to Ana',
    items: [
      {
        kind: 'send',
        text: 'Sent “Found the shirt” to Ana',
        target: 'ana@example.com',
      },
    ],
  },
];

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** With working Undo and Redo: each takes a moment, as the real one does. */
function Live(props: Partial<WhatChangedProps>) {
  const [undone, setUndone] = useState<Set<string>>(new Set(props.undone ?? []));
  return (
    <WhatChanged
      groups={CODING}
      undone={undone}
      onUndo={async (id) => {
        await wait(700);
        setUndone((u) => new Set(u).add(id));
      }}
      onRedo={async (id) => {
        await wait(700);
        setUndone((u) => {
          const next = new Set(u);
          next.delete(id);
          return next;
        });
      }}
      {...props}
    />
  );
}

const meta = {
  title: 'Patterns/Chat/WhatChanged',
  component: WhatChanged,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'What the turn changed in the world, at the end of a reply (ADR 0103). Folded, one line: “Changed 4 files · committed · pushed to main”, with a mark for each kind. Opened, every change, the ones other people see, that cost money or that left this computer first, with Undo where a change can be put back. Undone, a change says so and offers Redo.',
      },
    },
  },
  args: { groups: CODING },
  decorators: [(Story) => <div style={{ maxInlineSize: 640 }}>{Story()}</div>],
} satisfies Meta<typeof WhatChanged>;

export default meta;
type S = StoryObj<typeof meta>;

export const Collapsed: S = { render: () => <Live /> };

export const Expanded: S = { render: () => <Live defaultOpen /> };

/** Some changes put back: they say so and offer Redo. */
export const SomeUndone: S = {
  render: () => <Live defaultOpen undone={new Set(['cs-1', 'cs-3'])} />,
};

/** Everything put back: the folded line says so. */
export const AllUndone: S = {
  render: () => <Live undone={new Set(['cs-1', 'cs-2', 'cs-3', 'cs-4'])} />,
};

/** Shopping: the purchase and the email come first, though they happened later. */
export const Consequential: S = { render: () => <Live groups={SHOPPING} defaultOpen /> };

export const Mobile: S = {
  decorators: [(Story) => <div style={{ inlineSize: 358 }}>{Story()}</div>],
  render: () => <Live defaultOpen />,
};

export const Dark: S = {
  globals: { mode: 'dark' },
  render: () => <Live groups={SHOPPING} defaultOpen />,
};
