import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { CopyButton } from '../CopyButton';
import { Message, MessageList } from '../Message';
import { Prose } from '../Prose';
import { ChatSpendChip, SpendLimitCard, SpendNote, TurnCostTag } from './Spend';
import type { ChatSpendValue } from './format';

const meta = {
  title: 'Patterns/Chat/Spend',
  component: SpendLimitCard,
  parameters: {
    docs: {
      description: {
        component:
          'What a chat costs, shown calmly (ADR 0079). Each reply has its cost among its actions — a quiet “$0.04”, or “Plan” on a subscription — with the detail a tap away: what reading from the cache saved, the tokens, the plan’s window. The chat’s chip beside the model picker adds it up, its tasks included, and holds the one money setting a chat has: a limit of its own. At a limit (the chat’s, or the monthly budget), the message waits for one tap: raise it, carry on with a model that costs less, or stop. A pricier model on a long chat, or a month nearly at its budget, gets one quiet line, once.',
      },
    },
  },
  args: {
    limit: 'chat',
    spentUsd: 2.04,
    limitUsd: 2,
    raiseTo: 5,
    switchTo: { label: 'Gemma 3', why: 'local' },
    onRaise: () => {},
    onSwitch: () => {},
    onStop: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ display: 'grid', gap: 16, maxInlineSize: '44rem' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SpendLimitCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The chat reached its own limit: the message waits; a model on this computer carries on for free. */
export const AtTheChatsLimit: Story = {};

/** A reply stopped part way: it carries on from there once you choose. */
export const StoppedPartWay: Story = { args: { during: true } };

/** Nothing free is set up: a cheaper model on the same key, with a little more room. */
export const ACheaperModel: Story = {
  args: { switchTo: { label: 'Haiku 4.5', why: 'cheaper', allowUsd: 0.5 } },
};

/** The monthly budget every chat shares: a plan carries on with nothing more to pay. */
export const AtTheMonthlyBudget: Story = {
  args: {
    limit: 'month',
    spentUsd: 50.12,
    limitUsd: 50,
    raiseTo: 100,
    switchTo: { label: 'Opus 5.5', provider: 'Claude Code', why: 'plan' },
  },
};

/** No model that costs less: raise it, or stop. */
export const NothingCheaper: Story = { args: { switchTo: undefined } };

/** Once chosen, a quiet line. */
export const Settled: Story = {
  render: (args) => (
    <>
      <SpendLimitCard {...args} state="raised" />
      <SpendLimitCard {...args} state="switched" />
      <SpendLimitCard {...args} state="stopped" />
      <SpendLimitCard {...args} limit="month" state="stopped" />
    </>
  ),
};

/** A quiet word, said once: nearly at the budget, or a pricier model on a long chat. */
export const Notes: Story = {
  render: () => (
    <>
      <SpendNote>
        This month you’ve spent $41.20 of your $50 budget. When it’s used up, a chat asks before
        spending more.
      </SpendNote>
      <SpendNote>
        With a chat this long, each reply from Opus 5.5 costs about $0.84. The last one cost $0.21.
      </SpendNote>
    </>
  ),
};

/** Each reply’s cost among its actions: money, a plan, and nothing at all on this computer. */
export const ReplyCosts: Story = {
  render: () => (
    <MessageList aria-label="Conversation" style={{ blockSize: 'auto' }}>
      {[
        {
          id: 'a',
          cost: {
            billing: 'metered' as const,
            usd: 0.042,
            priced: 'list' as const,
            savedUsd: 0.031,
          },
          tokens: { inputTokens: 18_200, cachedInputTokens: 12_000, outputTokens: 900 },
        },
        {
          id: 'b',
          cost: {
            billing: 'plan' as const,
            usd: 0.38,
            plan: { source: 'Claude Max', window: { label: 'Current session', usedPercent: 42 } },
          },
        },
        { id: 'c', cost: { billing: 'free' as const } },
      ].map(({ id, cost, tokens }) => (
        <Message
          key={id}
          from="assistant"
          author="Conch"
          actionsVisibility="always"
          actions={
            <>
              <CopyButton value="Done." label="Copy reply" />
              <TurnCostTag cost={cost} tokens={tokens} />
            </>
          }
        >
          <Prose>
            <p>Done: the table is sorted by date, newest first.</p>
          </Prose>
        </Message>
      ))}
    </MessageList>
  ),
};

function ChipDemo({ initial }: { initial: ChatSpendValue }) {
  const [spend, setSpend] = useState(initial);
  return (
    <div style={{ paddingBlockStart: 320 }}>
      <ChatSpendChip
        spend={spend}
        onSetLimit={(capUsd) => {
          const { capUsd: _old, ...rest } = spend;
          setSpend(capUsd === null ? rest : { ...rest, capUsd });
        }}
      />
    </div>
  );
}

/** The chat’s chip, beside the model picker: tap it for the detail and the chat’s own limit. */
export const ChatChip: Story = {
  render: () => <ChipDemo initial={{ usd: 0.31, tasksUsd: 0.08, savedUsd: 0.12 }} />,
};

/** Near its limit, the chip says so in colour and in words. */
export const ChatChipNearItsLimit: Story = {
  render: () => <ChipDemo initial={{ usd: 1.7, capUsd: 2, planTurns: 3 }} />,
};
