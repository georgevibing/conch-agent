import type { Meta, StoryObj } from '@storybook/react-vite';

import { Message, MessageList } from '../Message';
import { Prose } from '../Prose';
import { SummaryDivider } from './SummaryDivider';

const SUMMARY = [
  'What the person wants',
  '- A planting plan for the back garden, ready by the end of April.',
  'Decided or done',
  '- Tomatoes along the south fence, basil between them; no peppers this year.',
  '- Raised bed is 2.4 m × 1.2 m (drawing in garden-plan.md).',
  'Facts to keep',
  '- Soil test: pH 6.4, low in nitrogen.',
  'Still open',
  '- Which compost to buy, and whether to add a drip line.',
].join('\n');

const meta = {
  title: 'Patterns/Chat/SummaryDivider',
  component: SummaryDivider,
  parameters: {
    docs: {
      description: {
        component:
          'A long chat outgrows what a model reads at once, so Conch folds its start into a summary (ADR 0055). This quiet line marks where the model’s word-for-word memory now starts. Everything above stays for the person; the line opens to show exactly what the model keeps. Not an alarm, not a meter: one line, with nothing to set.',
      },
    },
  },
  args: { model: 'GPT-5 mini', summary: SUMMARY },
  decorators: [
    (Story) => (
      <div style={{ display: 'grid', gap: 16, maxInlineSize: '44rem' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SummaryDivider>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Open: Story = { args: { defaultOpen: true } };

/** No model could write a summary (none answered): the turns went, and the line says so. */
export const WithoutSummary: Story = { args: { summary: '', model: 'Llama 3.2' } };

/** A model with no name to show. */
export const Unnamed: Story = { args: { model: undefined } };

/** Where it sits: between the oldest messages the model still reads and the ones it doesn’t. */
export const InAChat: Story = {
  render: (args) => (
    <MessageList>
      <Message from="user" timestamp={new Date(2026, 9, 3, 9, 12)}>
        And the shady corner by the shed?
      </Message>
      <Message from="assistant" timestamp={new Date(2026, 9, 3, 9, 12)}>
        <Prose>
          <p>Ferns and hostas will be happy there; skip anything that wants full sun.</p>
        </Prose>
      </Message>
      <SummaryDivider {...args} />
      <Message from="user" timestamp={new Date(2026, 9, 3, 18, 40)}>
        Remind me what we decided for the south fence?
      </Message>
      <Message from="assistant" timestamp={new Date(2026, 9, 3, 18, 40)}>
        <Prose>
          <p>Tomatoes along the fence with basil between them, and no peppers this year.</p>
        </Prose>
      </Message>
    </MessageList>
  ),
};
