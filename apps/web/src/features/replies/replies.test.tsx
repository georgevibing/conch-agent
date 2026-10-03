import type { ConversationEvent, ConversationEventInput } from '@conch/protocol';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { reduceAll, type ConversationView } from '../../live/reducer';
import { appState, mockFetch, renderApp } from '../../test/harness';
import { Transcript } from '../chat/Transcript';

afterEach(() => vi.unstubAllGlobals());

function log(...inputs: ConversationEventInput[]): ConversationEvent[] {
  return inputs.map(
    (e, seq) => ({ ...e, conversationId: 'c1', seq, at: 1000 + seq * 100 }) as ConversationEvent,
  );
}

const turn: ConversationEventInput[] = [
  { type: 'user.message', messageId: 'u1', text: 'Draft the invite' },
  { type: 'assistant.delta', messageId: 'm1', kind: 'text', delta: 'Here it is.' },
  { type: 'assistant.done', messageId: 'm1' },
  { type: 'turn.completed', outcome: 'success' },
  {
    type: 'replies',
    replies: [{ text: 'Make it shorter' }, { text: 'Add Ada to the invite' }],
    by: 'assistant',
  },
  { type: 'status', status: 'idle' },
];

describe('replies to send next in the log (ADR 0055)', () => {
  it('belong to the latest reply, through the chat closing the turn', () => {
    const view = reduceAll(log(...turn, { type: 'title', title: 'The invite' }));
    expect(view.replies).toMatchObject({
      seq: 4,
      by: 'assistant',
      replies: [{ text: 'Make it shorter' }, { text: 'Add Ada to the invite' }],
    });
  });

  it('go as soon as anything newer is in the chat', () => {
    // A message from another device…
    expect(
      reduceAll(log(...turn, { type: 'user.message', messageId: 'u2', text: 'Thanks' })).replies,
    ).toBeUndefined();
    // …a new turn starting with nothing typed (carrying on)…
    expect(reduceAll(log(...turn, { type: 'status', status: 'running' })).replies).toBeUndefined();
    // …or a card.
    expect(
      reduceAll(
        log(...turn, {
          type: 'memory.saved',
          memory: {
            id: 'm_1',
            content: 'Ada leads design',
            kind: 'fact',
            createdAt: 1,
            updatedAt: 1,
          },
        } as ConversationEventInput),
      ).replies,
    ).toBeUndefined();
  });

  it('a later set replaces the earlier one', () => {
    const view = reduceAll(
      log(...turn, { type: 'replies', replies: [{ text: 'Show it as a chart' }], by: 'conch' }),
    );
    expect(view.replies?.replies).toEqual([{ text: 'Show it as a chart' }]);
    expect(view.replies?.by).toBe('conch');
  });
});

function show(view: ConversationView, onReply = vi.fn(), pending = false) {
  mockFetch({ 'GET /api/state': () => appState() });
  renderApp(
    <Transcript
      view={view}
      pending={pending ? [{ clientMessageId: 'p1', text: 'Make it shorter', at: Date.now() }] : []}
      name="Ada’s helper"
      onRespond={() => {}}
      onRetry={() => {}}
      onReply={onReply}
    />,
  );
  return onReply;
}

describe('the chips under the reply', () => {
  it('show after the reply, and a tap sends their words', async () => {
    const onReply = show(reduceAll(log(...turn)));
    const group = await screen.findByRole('toolbar', { name: 'Replies to send' });
    expect(group).toHaveTextContent('Make it shorter');
    await userEvent.click(screen.getByRole('button', { name: 'Add Ada to the invite' }));
    await waitFor(() => expect(onReply).toHaveBeenCalledWith('Add Ada to the invite'));
    expect(onReply).toHaveBeenCalledOnce();
  });

  it('wait while a reply is being written', async () => {
    const running = reduceAll(log(...turn));
    show({ ...running, status: 'running' });
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
  });

  it('are gone while your message is on its way', () => {
    show(reduceAll(log(...turn)), vi.fn(), true);
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
  });

  it('never show without a way to send them', async () => {
    mockFetch({ 'GET /api/state': () => appState() });
    renderApp(
      <Transcript
        view={reduceAll(log(...turn))}
        pending={[]}
        name="Ada’s helper"
        onRespond={() => {}}
        onRetry={() => {}}
      />,
    );
    await screen.findByText('Here it is.');
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
  });
});
