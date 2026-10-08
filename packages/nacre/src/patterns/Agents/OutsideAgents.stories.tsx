import type { Meta, StoryObj } from '@storybook/react-vite';

import { OutsideAgentList, OutsideAgentPreview } from './OutsideAgents';

const meta = {
  title: 'Patterns/Agents/OutsideAgents',
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Outside agents (ADR 0112): agents elsewhere that speak A2A, added in Settings → Agents by pasting their address. What a paste turned out to be arrives as a card with one button; what it says about itself is shown as its own claim. The list says where each answers and what went wrong last time.',
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Found: Story = {
  render: () => (
    <div style={{ maxInlineSize: '32rem' }}>
      <OutsideAgentPreview
        name="Travel Agent"
        description="Finds flights and hotels, and holds them for a day."
        skills={[{ name: 'Flights' }, { name: 'Hotels' }, { name: 'Trains' }]}
        by="Example Travel"
        host="agents.example.com"
        onAdd={() => undefined}
      />
    </div>
  ),
};

export const AnotherConch: Story = {
  render: () => (
    <div style={{ maxInlineSize: '32rem' }}>
      <OutsideAgentPreview
        name="Sage"
        description="Plans trips"
        skills={[{ name: 'Talk' }]}
        by="Conch"
        host="ana-mac.tail1234.ts.net"
        private
        keyed
        onAdd={() => undefined}
      />
    </div>
  ),
};

export const List: Story = {
  render: () => (
    <div style={{ maxInlineSize: '36rem' }}>
      <OutsideAgentList
        agents={[
          {
            id: 'oa_travel',
            name: 'Travel Agent',
            description: 'Finds flights and hotels',
            host: 'agents.example.com',
          },
          {
            id: 'oa_sage',
            name: 'Sage at Ana’s',
            host: 'ana-mac.tail1234.ts.net',
            private: true,
            problem: 'Couldn’t reach Sage at Ana’s. Is it running?',
          },
        ]}
        onRemove={() => undefined}
      />
    </div>
  ),
};
