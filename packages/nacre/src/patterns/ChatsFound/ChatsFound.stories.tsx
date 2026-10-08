import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';

import { Button } from '../../components/Button';
import { ChatsFound, type ChatsFoundSource } from './ChatsFound';
import { PastChatReader } from './PastChatReader';

const sources: ChatsFoundSource[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    logo: 'claude',
    count: 1_031,
    projects: [
      { name: 'shop', count: 412 },
      { name: 'garden-planner', count: 220 },
      { name: 'dotfiles', count: 98 },
      { name: 'blog', count: 61 },
      { name: 'taxes', count: 12 },
    ],
    when: 'since March 2025',
  },
  {
    id: 'codex',
    label: 'Codex',
    logo: 'openai',
    count: 241,
    projects: [{ name: 'shop', count: 180 }],
    when: 'since June 2025',
  },
  { id: 'hermes', label: 'Hermes', count: 12, when: 'since August 2025' },
];

const meta = {
  title: 'Patterns/ChatsFound',
  component: ChatsFound,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Your past chats from other apps (ADR 0111). Conch finds them by itself and says so in one moment: every app’s mark gathered by the pearl, light flowing in, and the count turning up on its wheels. Each app has its count and its busiest projects; then one press. While they come in the light quickens and a bar fills; once they’re here the pearl glows. With reduced motion the count simply is.',
      },
    },
  },
  args: {
    sources,
    note: 'They come in to read and search. Nothing in those apps changes, and anything that looks like a key is taken out.',
    action: (
      <>
        <Button>Bring them in</Button>
        <Button variant="ghost">Not now</Button>
      </>
    ),
  },
  render: (args) => (
    <div style={{ maxInlineSize: 560 }}>
      <ChatsFound {...args} />
    </div>
  ),
} satisfies Meta<typeof ChatsFound>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** One app, one project: the smallest find. */
export const OneApp: Story = {
  args: {
    sources: [
      {
        id: 'codex',
        label: 'Codex',
        logo: 'openai',
        count: 1,
        projects: [{ name: 'garden', count: 1 }],
      },
    ],
  },
};

/** On their way in: the light quickens, the bar fills, the app it's reading says so. */
export const Bringing: Story = {
  render: (args) => {
    const [done, setDone] = useState(380);
    useEffect(() => {
      const timer = setInterval(() => setDone((d) => (d >= 1284 ? 380 : d + 37)), 400);
      return () => clearInterval(timer);
    }, []);
    return (
      <div style={{ maxInlineSize: 560 }}>
        <ChatsFound
          {...args}
          phase="bringing"
          progress={{ done, total: 1284, current: 'Reading Claude Code' }}
          action={undefined}
        />
      </div>
    );
  },
};

/** They're here: the pearl glows, and the next thing to try. */
export const Done: Story = {
  args: {
    phase: 'done',
    title: (count) => <>{count} conversations are here</>,
    lead: 'Search them with ⌘K, or ask about one in any chat.',
    note: '31 things that looked like keys were taken out.',
    action: <Button variant="surface">Try it: “what did we decide about checkout?”</Button>,
  },
};

const markdown = (text: string) => <p style={{ margin: 0 }}>{text}</p>;

/** A past chat to read, with one press to carry it on. */
export const PastChat: Story = {
  render: () => (
    <div style={{ maxInlineSize: 680 }}>
      <PastChatReader
        title="Checkout double charge"
        source="Claude Code"
        logo="claude"
        meta="shop · 1 March 2026 · 3 messages · claude-sonnet-4-5"
        messages={[
          {
            id: '1',
            from: 'user',
            children: markdown('Why does the checkout page double-charge? My key is •••'),
          },
          {
            id: '2',
            from: 'assistant',
            children: markdown('The retry runs before the lock is taken.'),
          },
          {
            id: '3',
            from: 'assistant',
            children: markdown('Move the lock up a line and it charges once.'),
          },
        ]}
        note="Claude Code picks it up here, with the conversation so far."
        action={<Button>Carry on here</Button>}
      />
    </div>
  ),
};
