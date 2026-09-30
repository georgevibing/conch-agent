import type { Meta, StoryObj } from '@storybook/react-vite';
import { Paperclip } from 'lucide-react';
import { useState } from 'react';

import { IconButton } from '../../components/IconButton';
import { Composer } from '../Composer';
import { Message, MessageList } from '../Message';
import { Prose } from '../Prose';
import { OfflineNotice, RoutedNote, WaitingMessage } from './Offline';

const meta = {
  title: 'Patterns/Chat/Offline',
  component: WaitingMessage,
  parameters: {
    docs: {
      description: {
        component:
          'When the internet goes, nothing breaks: a message waits in the chat and goes by itself the moment you’re back — or the model on this computer answers now. When another provider answers (offline, or at a usage limit), one quiet line says so. Calm by design: waiting is not an error.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ display: 'grid', gap: 16, maxInlineSize: '44rem' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof WaitingMessage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Waiting: Story = {};

export const WaitingWithLocalModel: Story = {
  args: { local: { label: 'Ollama', onAnswer: () => {} } },
};

export const SeveralWaiting: Story = {
  args: { count: 3, local: { label: 'Ollama', onAnswer: () => {} } },
};

export const Sent: Story = { args: { state: 'sent' } };

export const Notices: Story = {
  render: () => (
    <>
      <OfflineNotice />
      <OfflineNotice local="Ollama" />
      <OfflineNotice action={{ label: 'Answer with Ollama', onClick: () => {} }} />
    </>
  ),
};

export const Routed: Story = {
  render: () => (
    <>
      <RoutedNote reason="offline">
        You’re offline, so Ollama answered from this computer.
      </RoutedNote>
      <RoutedNote reason="limit" action={{ label: 'Change', onClick: () => {} }}>
        Claude Code reached its limit until 15:00, so OpenRouter answered.
      </RoutedNote>
    </>
  ),
};

/** The whole story, in a chat: offline, a message waits, the model on this computer answers. */
export const InAConversation: Story = {
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div style={{ blockSize: '100vh' }}>
        <Story />
      </div>
    ),
  ],
  render: function Render() {
    const [phase, setPhase] = useState<'waiting' | 'answering' | 'answered'>('waiting');
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          blockSize: '100%',
          maxInlineSize: 820,
          marginInline: 'auto',
        }}
      >
        <MessageList>
          <div style={{ display: 'grid', gap: 20, padding: '24px 16px' }}>
            <Message from="user">Summarise the notes from this morning’s call.</Message>
            {phase === 'waiting' && (
              <WaitingMessage
                local={{
                  label: 'Ollama',
                  onAnswer: () => {
                    setPhase('answering');
                    setTimeout(() => setPhase('answered'), 900);
                  },
                }}
              />
            )}
            {phase !== 'waiting' && (
              <RoutedNote reason="offline">
                You were offline, so Ollama on this computer answered.
              </RoutedNote>
            )}
            {phase === 'answered' && (
              <Message from="assistant" status="complete">
                <Prose>
                  <p>
                    Three decisions: ship the beta on Friday, move the pricing page to next week,
                    and Sam owns the migration guide.
                  </p>
                </Prose>
              </Message>
            )}
          </div>
        </MessageList>
        <div style={{ display: 'grid', gap: 8, padding: '0 16px 20px' }}>
          <OfflineNotice />
          <Composer
            toolbar={
              <IconButton size="sm" label="Attach files">
                <Paperclip />
              </IconButton>
            }
            placeholder="Reply to Conch…"
          />
        </div>
      </div>
    );
  },
};
