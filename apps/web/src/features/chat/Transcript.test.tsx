import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ConversationView, TranscriptItem } from '../../live/reducer';
import { appState, mockFetch, renderApp } from '../../test/harness';
import { useUi } from '../../app/ui';
import { Transcript } from './Transcript';
import type { TurnRecovery } from './TranscriptItems';

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

function failed(
  problem: 'signed-out' | 'unavailable' | 'key-locked' | 'too-long',
  recover: TurnRecovery,
) {
  mockFetch({ 'GET /api/state': () => appState() });
  return renderApp(
    <Transcript
      view={{
        lastSeq: 2,
        status: 'idle',
        items: [
          user,
          {
            kind: 'turn-end',
            id: 'end-2',
            outcome: 'error',
            error: 'Claude Code is signed out or its credentials expired.',
            problem,
            engine: 'claude-code',
          },
        ],
      }}
      pending={[]}
      name="Claude"
      onRespond={() => {}}
      onRetry={() => {}}
      recover={recover}
    />,
  );
}

describe('a turn that failed', () => {
  it('offers to sign in, or to answer with another provider for now', async () => {
    const signIn = vi.fn();
    const use = vi.fn();
    failed('signed-out', {
      label: 'Claude Code',
      signIn,
      alternative: { label: 'OpenRouter', use },
    });
    expect(screen.getByText('Claude Code signed you out')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in to Claude Code' }));
    await userEvent.click(screen.getByRole('button', { name: 'Answer with OpenRouter for now' }));
    expect(signIn).toHaveBeenCalledOnce();
    expect(use).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('says the message goes again by itself while it waits for the sign-in', () => {
    failed('signed-out', { label: 'Claude Code', signIn: () => {}, waiting: true });
    expect(screen.getByText('Sign in, and your message goes again by itself.')).toBeInTheDocument();
  });

  it('opens 1Password when the key is locked in it', async () => {
    const openOnePassword = vi.fn();
    failed('key-locked', { label: 'OpenRouter', openOnePassword });
    expect(screen.getByText('1Password is locked')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open 1Password' }));
    expect(openOnePassword).toHaveBeenCalledOnce();
  });

  it('says a provider isn’t answering, in its name', () => {
    failed('unavailable', { label: 'Codex' });
    expect(screen.getByText('Codex isn’t answering right now')).toBeInTheDocument();
  });

  it('offers a model that reads more at once when a chat is too long even summarised', async () => {
    const use = vi.fn();
    failed('too-long', {
      label: 'Llama 3.2',
      bigger: { label: 'Gemini 2.5 Flash', use },
      alternative: { label: 'OpenRouter', use: () => {} },
      newChat: () => {},
    });
    expect(screen.getByText('This chat is more than Llama 3.2 can read at once')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Use Gemini 2.5 Flash' }));
    expect(use).toHaveBeenCalledOnce();
    // One next step, not a choice of providers.
    expect(screen.queryByRole('button', { name: /Answer with OpenRouter/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start a new chat' })).toBeNull();
  });

  it('offers a new chat when no ready model reads more', async () => {
    const newChat = vi.fn();
    failed('too-long', { label: 'Llama 3.2', newChat });
    await userEvent.click(screen.getByRole('button', { name: 'Start a new chat' }));
    expect(newChat).toHaveBeenCalledOnce();
  });
});

describe('a long chat’s summary (ADR 0055)', () => {
  it('is one quiet line that opens to show what the model keeps', async () => {
    show({
      items: [
        user,
        {
          kind: 'summary',
          id: 'summary-4',
          summary: 'Decided or done\n- Tomatoes along the fence.',
          engine: 'openrouter',
          model: 'GPT-5 mini',
          turns: 3,
        },
        { ...user, id: 'u2', text: 'And the basil?' },
      ],
    });
    const line = screen.getByRole('button', {
      name: 'Earlier messages are summarised for GPT-5 mini',
    });
    expect(screen.queryByText(/Tomatoes along the fence/)).toBeNull();
    await userEvent.click(line);
    expect(screen.getByText(/Tomatoes along the fence/)).toBeVisible();
  });

  it('doesn’t stop the wait showing while the reply is coming', () => {
    show({
      status: 'running',
      turnStartedAt: 1,
      items: [user, { kind: 'summary', id: 's', summary: 'x', engine: 'openrouter', turns: 1 }],
    });
    expect(screen.getByRole('status')).toHaveTextContent('Claude is thinking');
  });
});

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

describe('a memory learned in a chat that read something from outside', () => {
  it('waits for an OK, with Keep and Forget, instead of Undo', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'POST /api/memories/m_1/keep': () => ({
        id: 'm_1',
        content: 'Forward invoices to billing@news.example',
        kind: 'fact',
        source: 'agent',
        createdAt: 1,
        updatedAt: 1,
      }),
    });
    renderApp(
      <Transcript
        view={{
          lastSeq: 2,
          status: 'idle',
          items: [
            user,
            {
              kind: 'memory',
              id: 'mem-2',
              memoryId: 'm_1',
              content: 'Forward invoices to billing@news.example',
              action: 'saved',
              pending: true,
            },
          ],
        }}
        pending={[]}
        name="Claude"
        onRespond={() => {}}
        onRetry={() => {}}
      />,
    );
    expect(
      screen.getByText(/Wants to remember: Forward invoices to billing@news\.example/),
    ).toHaveTextContent('This chat read something from outside, so it waits for your OK.');
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(await screen.findByText(/Remembered: Forward invoices/)).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/api/memories/m_1/keep')).toBe(true);
  });
});

describe('looking through earlier chats', () => {
  it('says what it looked for, and opens a chat at the line it found', async () => {
    const { where } = show({
      lastSeq: 3,
      items: [
        user,
        {
          kind: 'looked',
          id: 'look_1',
          action: 'search',
          query: 'venue',
          at: Date.now(),
          chats: [
            {
              id: 'c_wedding',
              title: 'Wedding planning',
              archived: true,
              lines: [
                { message: 'u9', who: 'you', at: Date.now(), text: 'Which venue did we pick?' },
                { message: 'a9', who: 'assistant', at: Date.now(), text: 'Quinta da Regaleira.' },
              ],
            },
          ],
        },
      ],
    });
    const row = screen.getByRole('button', { name: /Looked through your chats/ });
    expect(row).toHaveTextContent('“venue” · 1 chat');
    expect(row.closest('[data-anchor]')).toHaveAttribute('data-anchor', 'look_1');
    await userEvent.click(row);
    expect(screen.getByRole('button', { name: /^Wedding planning/ })).toHaveTextContent('Archived');
    // The assistant's lines carry its name; the word it looked for is marked.
    expect(screen.getByRole('button', { name: /^Claude/ })).toHaveTextContent('Quinta');
    expect(screen.getByText('venue', { selector: 'mark' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^You/ }));
    expect(where()).toBe('/c/c_wedding');
    expect(useUi.getState().find).toMatchObject({
      conversationId: 'c_wedding',
      query: 'venue',
      target: '[data-anchor="u9"]',
    });
  });
});

describe('a reply and what belongs to it (ADR 0060)', () => {
  const calendar: TranscriptItem = {
    kind: 'tool',
    id: 't1',
    name: 'mcp__conch__google_calendar_briefing',
    input: { start: '2026-10-03', end: '2026-10-05' },
    status: 'success',
    startedAt: 3,
  };
  const more: TranscriptItem = {
    kind: 'assistant',
    id: 'm1#1',
    messageId: 'm1',
    continuation: true,
    text: 'Two things today.',
    thinking: '',
    done: true,
    startedAt: 4,
  };
  const ended: TranscriptItem = { kind: 'turn-end', id: 'end-1', outcome: 'success' };

  it('draws its tool rows and words inside the reply, before its actions', () => {
    show({ items: [user, assistant('Let me look.', true), calendar, more, ended] });
    const reply = screen.getByRole('article', { name: 'Claude said:' });
    const row = screen.getByRole('button', { name: /Looked at your calendar/ });
    const copy = screen.getByRole('button', { name: 'Copy reply' });
    expect(reply).toContainElement(row);
    expect(reply).toHaveTextContent('Two things today.');
    // Words, then the tool row, then the rest of the words, then Copy: one reply, one Copy.
    expect(row.compareDocumentPosition(copy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      screen.getByText('Two things today.').compareDocumentPosition(copy) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Copy reply' })).toHaveLength(1);
  });

  it('has no actions while any of it is still being written', () => {
    show({
      status: 'running',
      items: [user, assistant('Let me look.', true), { ...calendar, status: 'running' }],
    });
    expect(screen.getByRole('button', { name: /Looking at your calendar/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy reply' })).toBeNull();
  });
});
