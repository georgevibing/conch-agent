import type { Meta, StoryObj } from '@storybook/react-vite';

import { NeverList } from './Learning';

const meta = {
  title: 'Patterns/Learning/NeverList',
  component: NeverList,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Things Conch won’t learn again (ADR 0088, ADR 0097). Learning itself is silent — nothing is announced in the chat and nothing routine asks — so the only record worth showing is what you took back. **Remove** lets Conch learn one again.',
      },
    },
  },
  args: {
    items: [
      { id: 'n1', text: 'Prefers dark mode', when: 'Taken back 3 days ago' },
      { id: 'n2', text: 'Works weekends', when: 'Taken back last week' },
    ],
  },
} satisfies Meta<typeof NeverList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <div style={{ maxInlineSize: 520 }}>
      <NeverList {...args} onRemove={() => undefined} />
    </div>
  ),
};

/** One of them is being allowed again. */
export const Working: Story = {
  render: (args) => (
    <div style={{ maxInlineSize: 520 }}>
      <NeverList {...args} busy="n1" onRemove={() => undefined} />
    </div>
  ),
};

/** Nothing to do about them: a plain list. */
export const ReadOnly: Story = {
  render: (args) => (
    <div style={{ maxInlineSize: 520 }}>
      <NeverList {...args} />
    </div>
  ),
};
