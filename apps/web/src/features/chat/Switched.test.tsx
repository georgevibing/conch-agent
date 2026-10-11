import type { ConversationEvent, ConversationEventInput } from '@conch/protocol';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { reduceAll } from '../../live/reducer';
import { appState, mockFetch, renderApp } from '../../test/harness';
import { Transcript } from './Transcript';

afterEach(() => vi.unstubAllGlobals());

function log(...inputs: ConversationEventInput[]): ConversationEvent[] {
  return inputs.map(
    (e, seq) => ({ ...e, conversationId: 'c1', seq, at: 1000 + seq * 100 }) as ConversationEvent,
  );
}

const switched: ConversationEventInput[] = [
  { type: 'user.message', messageId: 'u1', text: 'Use Opus 5.5 for this' },
  {
    type: 'options',
    options: { engine: 'claude-code', model: 'opus' },
  },
  {
    type: 'model.switched',
    from: 'codex-agent',
    fromModel: 'gpt-5.5',
    to: 'claude-code',
    model: 'opus',
    message: 'Switched to Opus 5.5 on your Claude Max plan',
    by: 'assistant',
  },
  { type: 'assistant.delta', messageId: 'm1', kind: 'text', delta: 'Done.' },
  { type: 'assistant.done', messageId: 'm1' },
  { type: 'turn.completed', outcome: 'success' },
  { type: 'status', status: 'idle' },
];

function show(events: ConversationEvent[], onReply = vi.fn()) {
  const calls = mockFetch({
    'GET /api/state': () => appState(),
    'POST /api/conversations/c1/switch': () => ({ ok: true }),
  });
  renderApp(
    <Transcript
      view={reduceAll(events)}
      conversationId="c1"
      pending={[]}
      name="Ada’s helper"
      onRespond={() => {}}
      onRetry={() => {}}
      onReply={onReply}
    />,
  );
  return { calls, onReply };
}

describe('switching models when asked (ADR 0132)', () => {
  it('shows one line where the chat switched, and Switch back returns to the model before', async () => {
    const { calls } = show(log(...switched));
    const line = await screen.findByRole('note');
    expect(line).toHaveTextContent('Switched to Opus 5.5 on your Claude Max plan');
    await userEvent.click(screen.getByRole('button', { name: 'Switch back' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        path: '/api/conversations/c1/switch',
        body: { engine: 'codex-agent', model: 'gpt-5.5' },
      }),
    );
    expect(screen.queryByRole('button', { name: 'Switch back' })).toBeNull();
  });

  it('says what changed with it, and offers no Switch back once you’ve written since', async () => {
    show(
      log(
        ...switched.slice(0, 2),
        {
          type: 'model.switched',
          from: 'claude-code',
          to: 'copilot',
          model: 'gpt-5.5',
          message: 'Switched to GPT-5.5 on your GitHub Copilot plan',
          note: 'Ask first: Copilot can’t do Auto',
          by: 'assistant',
        },
        { type: 'user.message', messageId: 'u2', text: 'Thanks' },
      ),
    );
    expect(await screen.findByRole('note')).toHaveTextContent(
      'Switched to GPT-5.5 on your GitHub Copilot plan · Ask first: Copilot can’t do Auto',
    );
    expect(screen.queryByRole('button', { name: 'Switch back' })).toBeNull();
  });

  it('several models that fit come as chips, and a tap sends the chip’s words', async () => {
    const { onReply } = show(
      log(
        { type: 'user.message', messageId: 'u1', text: 'Try this with Opus' },
        { type: 'assistant.delta', messageId: 'm1', kind: 'text', delta: 'Which one?' },
        { type: 'assistant.done', messageId: 'm1' },
        {
          type: 'model.choices',
          choices: [
            {
              engine: 'claude-code',
              model: 'opus',
              text: 'Switch to Opus 5.5 on Claude Code',
              label: 'Opus 5.5',
              line: 'Switched to Opus 5.5 on your Claude Max plan',
            },
            {
              engine: 'anthropic-api',
              model: 'claude-opus-5-5',
              text: 'Switch to Claude Opus 5.5 on Anthropic API',
              label: 'Claude Opus 5.5',
              line: 'Switched to Claude Opus 5.5 on Anthropic API, about $0.03 a reply',
            },
          ],
          request: 'Try this with Opus',
        },
        { type: 'turn.completed', outcome: 'success' },
        {
          type: 'replies',
          replies: [
            { text: 'Switch to Opus 5.5 on Claude Code' },
            { text: 'Switch to Claude Opus 5.5 on Anthropic API' },
          ],
          by: 'conch',
        },
        { type: 'status', status: 'idle' },
      ),
    );
    await screen.findByRole('toolbar', { name: 'Replies to send' });
    await userEvent.click(
      screen.getByRole('button', { name: 'Switch to Claude Opus 5.5 on Anthropic API' }),
    );
    await waitFor(() =>
      expect(onReply).toHaveBeenCalledWith('Switch to Claude Opus 5.5 on Anthropic API'),
    );
  });
});
