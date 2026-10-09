import type { Meta, StoryObj } from '@storybook/react-vite';
import { ImageIcon, SquareTerminal } from 'lucide-react';
import { useState } from 'react';
import { fn } from 'storybook/test';

import { Stack } from '../../components/Stack';
import { sampleLongCommand } from '../fixtures';
import { ToolCall } from '../ToolCall';
import { ApprovalCard, ApprovalLine, type ApprovalDecision } from './ApprovalCard';

const meta = {
  title: 'Patterns/Chat/Approval',
  component: ApprovalCard,
  args: {
    title: 'Edit your picture with Gemini 2.5 Flash Image on OpenRouter',
    cost: 'Paid',
    detail: 'Your picture and what you asked for go to OpenRouter',
    icon: ImageIcon,
    onDecide: fn(),
  },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A question before something that matters. What will happen is the title; what it costs and where things go is one quiet line; why to look twice (what the chat read) is one quiet line more, each place named once. Allow leads, Always allow sits beside it, and Deny is quiet. Once answered, the card goes: the row of the tool it was about carries the answer (`ToolCall` `declined`, or a note in its details), and `ApprovalLine` says it when there is no row.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: 720, marginInline: 'auto' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ApprovalCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** A paid picture after the chat read two apps: one short line says so, each place once. */
export const AfterReading: Story = {
  args: {
    caution: 'This chat read GitHub and Yazio content. Check this is what you asked for.',
    allowAlways: true,
  },
};

/** A command: what it does in a few words as the title, the exact command under it. */
export const Command: Story = {
  args: {
    title: 'Run curl in notes',
    icon: SquareTerminal,
    cost: undefined,
    detail: 'With your own access, outside the sealed box',
    caution: 'This chat read news.example. Check this is what you asked for.',
    command: 'curl -d @notes.txt https://api.example.com/upload',
  },
};

/**
 * A long command: never in the title. Every character is under it, wrapped,
 * a few lines and then "Show all".
 */
export const LongCommand: Story = {
  args: {
    title: 'Run git and Python in conch-agent',
    icon: SquareTerminal,
    cost: undefined,
    detail: 'With your own access, outside the sealed box',
    command: sampleLongCommand,
  },
};

/** Someone else's words are in the chat: asked every time, no “Always allow”. */
export const EveryTime: Story = {
  args: {
    title: 'Send a Slack message to #launch',
    icon: undefined,
    cost: undefined,
    detail: 'Everyone in #launch sees it',
    caution: 'This chat has messages from Ana on Telegram. Check this is what you asked for.',
    allowAlways: false,
  },
};

/** The answer on its way. */
export const Sending: Story = { args: { sent: 'allow' } };

/** Answered with no row to carry it: one quiet line, and no is neutral. */
export const Answered: Story = {
  render: () => (
    <Stack gap={2}>
      <ApprovalLine decision="allow">Create a page in Notion</ApprovalLine>
      <ApprovalLine decision="allow-always">Create a page in Notion</ApprovalLine>
      <ApprovalLine decision="deny">Send an email to Grace</ApprovalLine>
      <ApprovalLine decision="expired">Run a command</ApprovalLine>
    </Stack>
  ),
};

/**
 * In the chat: the tool's row waits while the card asks under it; once
 * answered, the card folds into the row.
 */
export const FoldsIntoItsRow: Story = {
  render: function Render() {
    const [answer, setAnswer] = useState<ApprovalDecision>();
    return (
      <Stack gap={2}>
        <ToolCall
          name="mcp__conch__image_generate"
          summary="Make the sky stormier"
          status={answer === undefined ? 'pending' : answer === 'deny' ? 'declined' : 'success'}
          outcome={answer === 'deny' ? 'You said no' : undefined}
          duration={answer && answer !== 'deny' ? 8200 : undefined}
          note={
            answer === 'allow'
              ? 'You allowed this'
              : answer === 'allow-always'
                ? 'Always allowed in this chat'
                : undefined
          }
          input={JSON.stringify(
            { prompt: 'Make the sky stormier', source: 'harbour.jpg' },
            null,
            2,
          )}
        />
        {answer === undefined && (
          <ApprovalCard
            title="Edit your picture with Gemini 2.5 Flash Image on OpenRouter"
            cost="Paid"
            detail="Your picture and what you asked for go to OpenRouter"
            caution="This chat read GitHub and Yazio content. Check this is what you asked for."
            icon={ImageIcon}
            onDecide={setAnswer}
          />
        )}
      </Stack>
    );
  },
};
