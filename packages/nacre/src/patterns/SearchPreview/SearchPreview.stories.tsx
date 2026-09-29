import type { Meta, StoryObj } from '@storybook/react-vite';

import { Kbd } from '../../components/Kbd';
import { SearchPreview } from './SearchPreview';

const meta = {
  title: 'Patterns/Chat/SearchPreview',
  component: SearchPreview,
  args: {
    title: 'Redeploy the staging stack',
    meta: 'Sep 29, 2026 · 5 messages',
    messages: [
      {
        id: 'u1',
        from: 'user',
        author: 'You',
        time: '2 hours ago',
        text: 'How do I redeploy the staging stack after changing the env vars?',
        ranges: [[9, 17]],
      },
      {
        id: 't1',
        from: 'tool',
        author: 'Tool',
        time: '2 hours ago',
        text: 'Bash pnpm deploy --stage staging',
      },
      {
        id: 'a1',
        from: 'assistant',
        author: 'Conch',
        time: '2 hours ago',
        text: 'The health check waits 30s by default. A cold start on staging can take longer — raise HEALTH_TIMEOUT to 90 and redeploy.',
        ranges: [[112, 120]],
        focus: true,
      },
      {
        id: 'u2',
        from: 'user',
        author: 'You',
        time: '1 hour ago',
        text: 'That worked, thanks!',
      },
    ],
    footer: (
      <>
        <Kbd keys="enter" size="sm" /> Open at this message
      </>
    ),
  },
  parameters: {
    docs: {
      description: {
        component:
          'The glance beside search results: the hit in context with its neighbours, matches marked, so you know it’s the right conversation before opening it. Only the focused message is emphasised.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ inlineSize: 380, blockSize: 460, border: '1px solid var(--nc-border-subtle)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SearchPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Loading: Story = {
  args: { loading: true, messages: [], title: '…', meta: undefined },
};
