import { screen, waitFor, within } from '@testing-library/react';
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

describe('a turn that paused to check in (ADR 0085)', () => {
  const paused = (id: string): TranscriptItem => ({
    kind: 'turn-end',
    id,
    outcome: 'success',
    paused: {
      reason: 'steps',
      message: 'Paused after 100 steps, so this doesn’t run on without you.',
    },
  });

  it('says why in one sentence, and Carry on sends exactly that', async () => {
    const onReply = vi.fn();
    mockFetch({ 'GET /api/state': () => appState() });
    renderApp(
      <Transcript
        view={{ lastSeq: 2, status: 'idle', items: [user, paused('end-2')] }}
        pending={[]}
        name="Pearl"
        onRespond={() => {}}
        onRetry={() => {}}
        onReply={onReply}
      />,
    );
    expect(await screen.findByText(/Paused after 100 steps/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Carry on' }));
    expect(onReply).toHaveBeenCalledWith('Carry on');
  });

  it('is a quiet line once the chat has moved on', () => {
    const onReply = vi.fn();
    mockFetch({ 'GET /api/state': () => appState() });
    renderApp(
      <Transcript
        view={{
          lastSeq: 4,
          status: 'idle',
          items: [
            user,
            paused('end-2'),
            { kind: 'user', id: 'u2', text: 'Carry on', at: 3 },
            { kind: 'turn-end', id: 'end-4', outcome: 'success' },
          ],
        }}
        pending={[]}
        name="Pearl"
        onRespond={() => {}}
        onRetry={() => {}}
        onReply={onReply}
      />,
    );
    expect(screen.getByText(/Paused after 100 steps/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Carry on' })).not.toBeInTheDocument();
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
  it('keeps the wait up between your message being saved and the turn starting', () => {
    // The gateway saves the message, then picks the model and the apps, then runs.
    show({ status: 'idle', items: [{ ...user, at: Date.now() }] });
    expect(screen.getByRole('status')).toHaveTextContent('Claude is thinking');
  });

  it('doesn’t wait on a message from before the chat was opened', () => {
    show({ status: 'idle', items: [user] });
    expect(screen.queryByRole('status')).toBeNull();
  });

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

describe('what Conch remembers', () => {
  const saved = (patch: Partial<Extract<TranscriptItem, { kind: 'memory' }>> = {}) =>
    ({
      kind: 'memory',
      id: 'mem-2',
      memoryId: 'm_1',
      content: 'Forward invoices to billing@news.example',
      action: 'saved',
      ...patch,
    }) as TranscriptItem;
  const render = (item: TranscriptItem) =>
    renderApp(
      <Transcript
        view={{ lastSeq: 2, status: 'idle', items: [user, item] }}
        pending={[]}
        name="Claude"
        onRespond={() => {}}
        onRetry={() => {}}
      />,
    );

  it('is a step like any other: a row that opens to the memory, with a quiet Undo (ADR 0103)', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'DELETE /api/memories/m_1': () => ({ ok: true }),
    });
    const { container } = render(saved());
    // The same row every step gets: the story's glyph and headline, closed.
    const row = screen.getByRole('button', { name: /^Remembered something/ });
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(container.querySelector('[data-family="remember"]')).not.toBeNull();
    expect(screen.queryByText('Forward invoices to billing@news.example')).toBeNull();
    await userEvent.click(row);
    expect(screen.getByText('Forward invoices to billing@news.example')).toBeVisible();
    // Said by its own event: no Why? to ask, no call to open.
    expect(screen.queryByRole('button', { name: 'Why?' })).toBeNull();
    await userEvent.click(
      screen.getByRole('button', { name: 'Undo “Forward invoices to billing@news.example”' }),
    );
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/memories/m_1')).toBe(true),
    );
    expect(screen.queryByRole('button', { name: /^Undo/ })).toBeNull();
  });

  it('once you’ve answered the memory check, its card folds into a step like any other', async () => {
    mockFetch({ 'GET /api/state': () => appState() });
    const held = {
      verdict: 'ask' as const,
      reasons: [{ code: 'redirect' as const, words: 'It would change where invoices go.' }],
    };
    const { unmount } = render(saved({ held, decided: 'kept' }));
    expect(screen.queryByRole('region', { name: 'Remember this?' })).toBeNull();
    expect(screen.queryByText(/^Remembered:/)).toBeNull();
    const kept = screen.getByRole('button', { name: /^Remembered something/ });
    await userEvent.click(kept);
    expect(
      screen.getByRole('button', { name: 'Undo “Forward invoices to billing@news.example”' }),
    ).toBeVisible();
    unmount();

    // Turned down, it was never remembered: nothing to undo.
    render(saved({ held, decided: 'undone' }));
    expect(screen.getByRole('button', { name: /^Didn’t remember something/ })).toBeVisible();
    expect(screen.queryByText(/^Not remembered:/)).toBeNull();
  });

  // The pill came back here: what a chat learned once quiet, held and then kept,
  // stayed a bordered "Remembered: …" chip under the last step, after a reload too.
  it('what a quiet chat learned and you kept is a step too, never a pill', async () => {
    const content = 'For conch-agent fixes (e.g. CI repairs), run the checks before pushing';
    const after = {
      id: 'm_9',
      content,
      kind: 'fact',
      source: 'agent',
      createdAt: 1,
      updatedAt: 1,
      held: {
        verdict: 'ask',
        reasons: [{ code: 'instruction', words: 'It reads like an order.' }],
      },
    };
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/learning': () => ({
        on: true,
        entries: [
          {
            id: 'le_1',
            at: 1,
            change: 'added',
            after,
            why: '',
            from: { trigger: 'idle', quotes: [], signals: [] },
            state: 'kept',
            seen: 1,
          },
        ],
        waiting: 0,
        never: [],
        past: [],
        spending: { limitUsd: 1, isDefault: true, monthUsd: 0 },
        quiet: [],
      }),
    });
    const { container } = render({
      kind: 'learned',
      id: 'learned-r1',
      items: [{ entryId: 'le_1', text: content, change: 'added', state: 'waiting' }],
      decided: {},
    });
    const row = await screen.findByRole('button', { name: /^Remembered something/ });
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(row.closest('[data-family="remember"]')).not.toBeNull();
    expect(container.querySelector('[data-settled]')).toBeNull();
    expect(screen.queryByText(/^Remembered:/)).toBeNull();
    await userEvent.click(row);
    expect(screen.getByText(content)).toBeVisible();
    expect(screen.getByRole('button', { name: `Undo “${content}”` })).toBeVisible();
  });

  it('joins the run it happened in: one story, one timeline', async () => {
    mockFetch({ 'GET /api/state': () => appState() });
    renderApp(
      <Transcript
        view={{
          lastSeq: 3,
          status: 'idle',
          items: [
            user,
            {
              kind: 'tool',
              id: 't1',
              name: 'Bash',
              input: { command: 'ls -la' },
              status: 'success',
              output: 'a\nb',
              startedAt: 2,
              durationMs: 900,
            },
            saved({ at: 3 } as never),
          ],
        }}
        pending={[]}
        name="Claude"
        onRespond={() => {}}
        onRetry={() => {}}
      />,
    );
    const row = screen.getByRole('button', { name: /remembered something/i });
    expect(row).toHaveAccessibleName(expect.stringContaining('2 steps') as unknown as string);
    await userEvent.click(row);
    expect(
      within(screen.getByRole('list', { name: 'Steps' })).getAllByRole('listitem'),
    ).toHaveLength(2);
  });

  it('asks with the memory check’s card when something isn’t remembered yet (ADR 0097)', async () => {
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
    render(
      saved({
        pending: true,
        held: {
          verdict: 'ask',
          reasons: [{ code: 'redirect', words: 'It would change where invoices go.' }],
        },
      }),
    );
    const card = screen.getByRole('region', { name: 'Remember this?' });
    expect(card).toHaveTextContent('It would change where invoices go.');
    expect(screen.queryByText('Remembered')).toBeNull();
    await userEvent.click(within(card).getByRole('button', { name: 'Remember it' }));
    // Answered, it's the step it was at once, before the chat's log says so.
    expect(await screen.findByRole('button', { name: /^Remembered something/ })).toBeVisible();
    expect(screen.queryByText(/^Remembered:/)).toBeNull();
    expect(calls.some((c) => c.path === '/api/memories/m_1/keep')).toBe(true);
  });

  it('puts back what it forgot with Undo, exactly as it was', async () => {
    const memory = {
      id: 'm_1',
      content: 'Projects live in ~/projects',
      kind: 'project' as const,
      source: 'agent' as const,
      createdAt: 1,
      updatedAt: 1,
    };
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'POST /api/memories/restore': () => memory,
    });
    render(saved({ action: 'forgotten', content: memory.content, memory }));
    await userEvent.click(screen.getByRole('button', { name: /^Forgot something/ }));
    await userEvent.click(
      screen.getByRole('button', { name: `Undo forgetting “${memory.content}”` }),
    );
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Undo/ })).toBeNull());
    // By its id only: Conch puts back its own copy, never words the page sends (ADR 0087).
    expect(calls.find((c) => c.path === '/api/memories/restore')?.body).toEqual({ id: memory.id });
  });

  it('shows what you chose after a reload: kept, or undone', () => {
    mockFetch({ 'GET /api/state': () => appState() });
    const { unmount } = render(saved({ pending: false, decided: 'kept' }));
    expect(screen.getByRole('button', { name: /^Remembered something/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Keep' })).toBeNull();
    unmount();
    render(saved({ decided: 'undone' }));
    expect(
      screen.getByRole('button', { name: /^Remembered something\s+Undone/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Undo/ })).toBeNull();
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

  it('says who is speaking once, above the reply, even when it began with a step', () => {
    mockFetch({ 'GET /api/state': () => appState() });
    renderApp(
      <Transcript
        view={{
          lastSeq: 4,
          status: 'idle',
          items: [
            user,
            calendar,
            more,
            { ...ended, engine: 'openrouter', model: 'openai/gpt-5-mini' },
          ],
        }}
        pending={[]}
        name="Pearl"
        modelName={(engine, model) =>
          engine === 'openrouter' && model === 'openai/gpt-5-mini' ? 'GPT-5 mini' : undefined
        }
        onRespond={() => {}}
        onRetry={() => {}}
      />,
    );
    const reply = screen.getByRole('article', { name: 'Pearl said:' });
    const [heading] = within(reply).getAllByRole('heading');
    expect(within(reply).getAllByRole('heading')).toHaveLength(1);
    const row = within(reply).getByRole('button', { name: /Looked at your calendar/ });
    // The speaker line comes first, then the step, then the words.
    expect(heading?.compareDocumentPosition(row) ?? 0).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    // Quietly, the model that answered.
    expect(reply).toHaveTextContent('GPT-5 mini');
  });

  it('marks a turn a restart stopped in a few words, and says what to do on a line of its own', () => {
    show({
      items: [
        user,
        assistant('Working on it.', true),
        { kind: 'turn-end', id: 'end-1', outcome: 'interrupted', restarted: { resumed: false } },
        user,
        assistant('Looking again.', true),
        {
          kind: 'turn-end',
          id: 'end-2',
          outcome: 'interrupted',
          restarted: { resumed: false },
          error: 'Conch saved your progress. Check its result before continuing.',
        },
        {
          kind: 'turn-end',
          id: 'end-3',
          outcome: 'interrupted',
          restarted: { resumed: true },
        },
      ],
    });
    // Short enough for a phone's column; the longer words go under it.
    expect(screen.getAllByText('Stopped when Conch restarted')).toHaveLength(2);
    expect(screen.getByText('Say “carry on” to pick it up again.')).toBeVisible();
    // Why it didn't carry on by itself, when Conch knows.
    expect(
      screen.getByText('Conch saved your progress. Check its result before continuing.'),
    ).toBeVisible();
    expect(screen.getByText('Picked up after Conch restarted')).toBeVisible();
    expect(screen.queryByText(/restarted while this was running/)).toBeNull();
  });

  it('says calmly that Conch updated and picked up, and offers Carry on when it couldn’t', async () => {
    const sent: string[] = [];
    mockFetch({ 'GET /api/state': () => appState() });
    renderApp(
      <Transcript
        view={{
          lastSeq: 1,
          status: 'idle',
          items: [
            user,
            assistant('Working on it.', true),
            {
              kind: 'turn-end',
              id: 'end-1',
              outcome: 'interrupted',
              restarted: { resumed: true, reason: 'update' },
            },
            user,
            assistant('Pushing.', true),
            {
              kind: 'turn-end',
              id: 'end-2',
              outcome: 'interrupted',
              restarted: { resumed: false, reason: 'update' },
              error: 'Conch saved your progress. Check its result before continuing.',
            },
          ],
        }}
        pending={[]}
        name="Claude"
        onRespond={() => {}}
        onRetry={() => {}}
        onSend={(text) => void sent.push(text)}
      />,
    );
    expect(screen.getByText('Conch updated and picked up where it left off')).toBeVisible();
    expect(screen.getByText('Paused when Conch updated')).toBeVisible();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Carry on' }));
    expect(sent).toEqual(['Carry on']);
  });

  it('goes on in the same voice, without a second speaker line, when nothing of yours came between', () => {
    show({
      items: [
        user,
        assistant('Working on it.', true),
        {
          kind: 'turn-end',
          id: 'end-1',
          outcome: 'interrupted',
          restarted: { resumed: true },
        },
        {
          kind: 'assistant',
          id: 'm2',
          messageId: 'm2',
          continuation: false,
          text: 'Picked it up again.',
          thinking: '',
          done: true,
          startedAt: 5,
        },
      ],
    });
    const [first, second] = screen.getAllByRole('article', { name: 'Claude said:' });
    expect(first).not.toHaveAttribute('data-continued');
    expect(second).toHaveAttribute('data-continued');
  });

  it('names the agent that took over, and gives each reply its own speaker (ADR 0101)', () => {
    mockFetch({ 'GET /api/state': () => appState() });
    renderApp(
      <Transcript
        view={{
          lastSeq: 6,
          status: 'idle',
          items: [
            {
              kind: 'agent',
              id: 'agent-0',
              seq: 0,
              agentId: 'ag_juniper',
              name: 'Juniper',
              opening: true,
            },
            user,
            assistant('Here is the plan.', true),
            {
              kind: 'agent',
              id: 'agent-4',
              seq: 4,
              agentId: 'ag_atlas',
              name: 'Atlas',
              opening: false,
            },
            { ...user, id: 'u2', text: 'And the flights?' },
            {
              kind: 'assistant',
              id: 'm2',
              messageId: 'm2',
              continuation: false,
              text: 'Two options.',
              thinking: '',
              done: true,
              startedAt: 6,
            },
          ],
        }}
        pending={[]}
        name="Atlas"
        avatar={{ kind: 'preset', id: 'compass' }}
        agentOf={(id) => (id === 'ag_juniper' ? { name: 'Juniper' } : undefined)}
        onRespond={() => {}}
        onRetry={() => {}}
      />,
    );
    // The opening agent is who the chat is with, not a change: one line, for the change.
    expect(screen.getByText('Atlas took over from Juniper')).toBeInTheDocument();
    expect(screen.queryByText(/took over from Atlas/)).toBeNull();
    expect(screen.getByRole('article', { name: 'Juniper said:' })).toHaveTextContent(
      'Here is the plan.',
    );
    expect(screen.getByRole('article', { name: 'Atlas said:' })).toHaveTextContent('Two options.');
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

describe('a reply you stopped', () => {
  it('ends with a quiet mark across the column, saying how long it ran', () => {
    show({
      items: [
        user,
        assistant('Once upon a time', true),
        {
          kind: 'turn-end',
          id: 'end-1',
          outcome: 'interrupted',
          usage: { inputTokens: 1, outputTokens: 1, durationMs: 479_000 },
        },
      ],
    });
    expect(screen.getByText('Stopped')).toBeInTheDocument();
    expect(screen.getByText('after 7m 59s')).toBeInTheDocument();
  });
});

describe('what a chat read from outside (ADR 0028)', () => {
  const read = (
    id: string,
    kind: 'web' | 'download' | 'app',
    label: string,
    carried?: boolean,
  ): TranscriptItem => ({
    kind: 'taint',
    id,
    source: { kind, label },
    ...(carried && { carried }),
  });

  it('says reads one after another as one line that opens, not a wall of them', async () => {
    show({
      items: [
        user,
        read('t1', 'web', 'docs.example'),
        read('t2', 'download', 'docs.example'),
        read('t3', 'web', 'news.example'),
        read('t4', 'app', 'your chat “Taxes”'),
      ],
    });
    const line = await screen.findByRole('button', {
      name: /Read 2 sites and one of your chats\.\s*From here on/,
    });
    await userEvent.click(line);
    expect(
      within(screen.getByRole('list', { name: 'What it read' })).getAllByRole('listitem'),
    ).toHaveLength(3);
  });

  it('in a task’s chat, says what the chat it came from had read, once', async () => {
    mockFetch({ 'GET /api/state': () => appState() });
    renderApp(
      <Transcript
        view={{
          lastSeq: 1,
          status: 'idle',
          items: [
            read('t1', 'web', 'docs.example', true),
            read('t2', 'web', 'news.example', true),
            user,
          ],
        }}
        taskChat
        pending={[]}
        name="Claude"
        onRespond={() => {}}
        onRetry={() => {}}
      />,
    );
    expect(
      await screen.findByRole('button', { name: /The chat it came from had read 2 sites/ }),
    ).toBeInTheDocument();
  });
});
