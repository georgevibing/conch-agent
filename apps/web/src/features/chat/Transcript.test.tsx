import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ConversationView, TranscriptItem } from '../../live/reducer';
import { appState, mockFetch, renderApp } from '../../test/harness';
import { Transcript } from './Transcript';

afterEach(() => vi.unstubAllGlobals());

const user: TranscriptItem = { kind: 'user', id: 'u1', text: 'Why does it fail?', at: 1 };
const assistant = (text: string, done: boolean): TranscriptItem => ({
  kind: 'assistant',
  id: 'm1',
  messageId: 'm1',
  continuation: false,
  text,
  thinking: '',
  done,
  startedAt: 2,
});

function show(view: Partial<ConversationView>) {
  mockFetch({ 'GET /api/state': () => appState() });
  return renderApp(
    <Transcript
      view={{ lastSeq: 1, items: [], status: 'idle', ...view }}
      pending={[]}
      name="Claude"
      onRespond={() => {}}
      onRetry={() => {}}
    />,
  );
}

describe('Transcript', () => {
  it('keeps the wait up while the model reasons in private (empty deltas)', () => {
    show({ status: 'running', turnStartedAt: 1, items: [user, assistant('', false)] });
    expect(screen.getByRole('status')).toHaveTextContent('Claude is thinking');
  });

  it('shows history at rest: no reveal, no entrance, even if it replays as unfinished', () => {
    const reply = 'Here is the whole answer, already written last week.';
    const { container } = show({ status: 'idle', items: [user, assistant(reply, false)] });
    expect(screen.getByText(reply)).toBeInTheDocument();
    expect(container.querySelector('[data-nc-fresh]')).toBeNull();
    expect(container.querySelectorAll('[data-at-rest]')).toHaveLength(2);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
