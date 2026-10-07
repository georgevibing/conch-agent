import type { Meta, StoryObj } from '@storybook/react-vite';
import { RotateCcw, ThumbsDown, ThumbsUp } from 'lucide-react';
import { fn } from 'storybook/test';

import { IconButton } from '../../components/IconButton';
import { Stack } from '../../components/Stack';
import { CopyButton } from '../CopyButton';
import { sampleReply } from '../fixtures';
import { Prose } from '../Prose';
import { ReplyChips } from '../ReplyChips';
import { ToolCall } from '../ToolCall';
import { StreamingText } from '../StreamingText';
import type { CSSProperties } from 'react';
import { Message } from './Message';

const at = new Date('2026-09-29T10:42:00');

const assistantActions = (
  <>
    <CopyButton value={sampleReply} label="Copy reply" />
    <IconButton size="sm" label="Retry">
      <RotateCcw />
    </IconButton>
    <IconButton size="sm" label="Good response">
      <ThumbsUp />
    </IconButton>
    <IconButton size="sm" label="Bad response">
      <ThumbsDown />
    </IconButton>
  </>
);

const meta = {
  title: 'Patterns/Chat/Message',
  component: Message,
  args: { from: 'assistant', timestamp: at },
  argTypes: {
    from: { control: 'inline-radio', options: ['user', 'assistant', 'system'] },
    status: { control: 'inline-radio', options: ['complete', 'streaming', 'error'] },
  },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'One turn in the conversation. Your turns are soft, accent-tinted bubbles at the end of the column. The assistant’s use the whole column: one compact speaker line (its face, its name — the turn’s heading, read once — and, quietly on hover, the model and the time), then the answer flush with everything else in the chat. The face comes alive while the speaker works. The same voice carrying on (`continued`) drops the line. Actions surface on hover or focus.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: 760, marginInline: 'auto' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Message>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  args: {
    meta: 'Opus 4.5',
    actions: assistantActions,
    children: (
      <Prose>
        <p>{sampleReply}</p>
      </Prose>
    ),
  },
};

export const User: Story = {
  args: {
    from: 'user',
    children: 'Can you make the session relay validate incoming frames before passing them on?',
    actions: <CopyButton value="…" label="Copy message" />,
  },
};

export const Streaming: Story = {
  args: {
    status: 'streaming',
    children: (
      <Prose>
        <p>I&apos;ll start by reading the current session implementation and its tests</p>
      </Prose>
    ),
  },
};

export const StreamingWithStreamingText: Story = {
  args: {
    status: 'streaming',
    children: <StreamingText as="p" streaming text="Looking at how frames are parsed today" />,
  },
};

export const Failed: Story = {
  name: 'Error',
  args: {
    status: 'error',
    error: 'The connection to Claude Code was lost.',
    onRetry: fn(),
    children: (
      <Prose>
        <p>Let me run the test suite to</p>
      </Prose>
    ),
  },
};

/** Any agent can speak: its name, and a preset or a picture for its face (Nacre `AgentAvatar`). */
export const Speakers: Story = {
  render: () => (
    <Stack gap={6}>
      <Message from="assistant" timestamp={at} meta="Opus 4.5">
        <Prose>
          <p>Conch, in its own mark.</p>
        </Prose>
      </Message>
      <Message from="assistant" speaker={{ name: 'Scout', avatar: 'compass' }} timestamp={at}>
        <Prose>
          <p>Scout wears a preset: a glyph on its colour.</p>
        </Prose>
      </Message>
      <Message
        from="assistant"
        speaker={{ name: 'Ada', avatar: '/no-such-picture.png' }}
        timestamp={at}
      >
        <Prose>
          <p>A picture that can’t load keeps Ada’s initial.</p>
        </Prose>
      </Message>
    </Stack>
  ),
};

/**
 * The same voice again with nothing of yours between (it carried on after its
 * own card): no second speaker line, the words go on where they were.
 */
export const Continued: Story = {
  render: () => (
    <Stack gap={6}>
      <Message from="assistant" timestamp={at}>
        <Prose>
          <p>I can see Friday once your calendar is connected.</p>
        </Prose>
      </Message>
      <Message from="assistant" continued timestamp={at} actions={assistantActions}>
        <Prose>
          <p>Connected. Friday is free after 3, so a haircut at 4 fits.</p>
        </Prose>
      </Message>
    </Stack>
  ),
};

/** At work on a step after its words: the face moves; nothing is written, so no caret. */
export const Working: Story = {
  args: {
    working: true,
    attached: (
      <div style={{ marginBlockStart: 'calc(var(--nc-chat-step) - var(--nc-chat-flow-gap))' }}>
        <ToolCall name="Bash" summary="pnpm test" status="running" />
      </div>
    ),
    children: (
      <Prose>
        <p>Let me run the tests.</p>
      </Prose>
    ),
  },
};

export const System: Story = {
  args: { from: 'system', children: 'Session resumed in ~/code/conch' },
};

export const Thread: Story = {
  render: () => (
    <Stack gap={6}>
      <Message from="system" timestamp={at}>
        New session · ~/code/conch
      </Message>
      <Message from="user" timestamp={at}>
        Can you make the session relay validate incoming frames?
      </Message>
      <Message from="assistant" timestamp={at} actions={assistantActions}>
        <Prose>
          <p>{sampleReply}</p>
        </Prose>
      </Message>
    </Stack>
  ),
};

/** How a part of a reply places itself (the web's `.part`): a step under what's above, lined up with the words. */
const part: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  marginBlockStart: 'calc(var(--nc-chat-step) - var(--nc-chat-flow-gap))',
  marginInlineStart: 'var(--nc-chat-indent)',
};

/**
 * What belongs to the reply goes in `attached`: its tool rows, its cards, the
 * replies to send next. They sit one step under the words, in the text column,
 * and the actions come after them, so nothing hidden ever sits between the
 * words and their card. Hover the reply to see the actions under the chips.
 */
export const WithWhatBelongsToIt: Story = {
  render: () => (
    <Message
      from="assistant"
      timestamp={at}
      actions={assistantActions}
      attached={
        <>
          <div style={part}>
            <ToolCall name="Looked at your calendar" summary="Today and tomorrow" duration={420} />
          </div>
          <div style={part}>
            <Prose>
              <p>Standup at 9:30, then the design review at 2. Tomorrow is the offsite.</p>
            </Prose>
          </div>
          <div style={part}>
            <ReplyChips
              replies={[{ text: 'Move the design review' }, { text: 'What’s on Friday?' }]}
              onSend={fn()}
            />
          </div>
        </>
      }
    >
      <Prose>
        <p>Let me look at your calendar.</p>
      </Prose>
    </Message>
  ),
};
