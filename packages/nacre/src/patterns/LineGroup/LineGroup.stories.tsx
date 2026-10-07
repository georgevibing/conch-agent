import type { Meta, StoryObj } from '@storybook/react-vite';
import { ShieldAlert } from 'lucide-react';

import { LineGroup } from './LineGroup';

const meta = {
  title: 'Patterns/Chat/LineGroup',
  component: LineGroup,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Many lines of one kind, said as one. A quiet summary opens, with a smooth height, to the lines themselves and a footnote on what they mean. What a chat read and what a task did use it, so a wall of near-identical rows never builds up.',
      },
    },
  },
  args: {
    icon: <ShieldAlert aria-hidden />,
    summary: 'Read 4 sites and 2 of your chats.',
    items: [
      'cheatsheetseries.owasp.org',
      'something downloaded from rfc-editor.org',
      'localhost',
      'things in your chat “Trip plans”',
    ],
    label: 'What it read',
    footnote: 'Something read from outside could try to steer me, so I ask before acting on it.',
  },
  decorators: [(Story) => <div style={{ maxInlineSize: 560 }}>{Story()}</div>],
} satisfies Meta<typeof LineGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
export const Open: Story = { args: { defaultOpen: true } };
/** Without an icon, as a folded run in a task's steps. */
export const Bare: Story = {
  args: {
    icon: undefined,
    summary: 'Read src/pager.ts and 3 more',
    items: [
      'Read src/pager.ts',
      'Read src/pager.test.ts',
      'Read src/fixtures.ts',
      'Read src/index.ts',
    ],
    label: 'Steps like it',
    footnote: undefined,
  },
};
