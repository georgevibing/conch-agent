import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toaster } from '@conch/nacre';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUi } from '../../app/ui';
import { useLiveStore } from '../../live/store';
import { appState, FakeSocket, mockFetch, renderApp } from '../../test/harness';
import { ChatView } from './ChatView';

afterEach(() => {
  vi.unstubAllGlobals();
  // The composer's pickers and a new chat's choices live in a shared store.
  useUi.setState({ picker: null, draftOptions: {} });
  // A message one test sent and never saw acknowledged mustn't still be "sending" in the next.
  useLiveStore.setState({ pending: {} });
  // Drafts and what was sent lately are kept on the device; each test starts without them.
  localStorage.clear();
  sessionStorage.clear();
});

/** Events of an open chat, in order, as the gateway would send them. */
function events(conversationId: string, from: number, list: Record<string, unknown>[]) {
  act(() => {
    for (const [i, event] of list.entries())
      FakeSocket.last?.push({
        type: 'conversation.event',
        event: { conversationId, seq: from + i, at: 1000 + from + i, ...event },
      } as never);
  });
}

const sends = () =>
  (FakeSocket.last?.sent ?? []).filter(
    (m) => (m as { type: string }).type === 'conversation.send',
  ) as { text: string; steer?: boolean }[];

describe('ChatView', () => {
  it('doesn’t take focus from a field you’re already typing in', async () => {
    mockFetch({ 'GET /api/state': () => appState(), 'GET /api/conversations': () => [] });
    const elsewhere = document.createElement('textarea');
    elsewhere.setAttribute('aria-label', 'Terminal input');
    document.body.append(elsewhere);
    elsewhere.focus();
    renderApp(<ChatView />);
    await screen.findByRole('textbox', { name: 'Message Conch' });
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  it('greets, sends a new conversation and renders the streamed reply', async () => {
    mockFetch({ 'GET /api/state': () => appState(), 'GET /api/conversations': () => [] });
    renderApp(<ChatView />);
    expect(await screen.findByRole('heading', { name: /, Ada\.$/ })).toBeInTheDocument();
    // Said once, where a chat starts.
    expect(screen.getByText(/^Conch can make mistakes/)).toBeInTheDocument();

    const box = screen.getByRole('textbox', { name: 'Message Conch' });
    await userEvent.type(box, 'Hello there{Enter}');
    const socket = FakeSocket.last;
    await waitFor(() =>
      expect(socket?.sent).toContainEqual(
        expect.objectContaining({ type: 'conversation.send', text: 'Hello there' }),
      ),
    );
    const sent = socket?.sent.find((m) => (m as { type: string }).type === 'conversation.send') as {
      clientMessageId: string;
    };
    // Optimistic bubble appears immediately.
    expect(screen.getByText('Hello there')).toBeInTheDocument();
    // Under a conversation it would only be noise.
    expect(screen.queryByText(/^Conch can make mistakes/)).not.toBeInTheDocument();

    const summary = {
      id: 'c1',
      title: 'Hello there',
      preview: '',
      createdAt: 1,
      updatedAt: 1,
      status: 'running' as const,
      options: {},
    };
    act(() => {
      socket?.push({
        type: 'conversation.created',
        clientMessageId: sent.clientMessageId,
        conversation: summary,
      });
      socket?.push({
        type: 'conversation.event',
        event: {
          type: 'user.message',
          conversationId: 'c1',
          seq: 0,
          at: 1,
          messageId: sent.clientMessageId,
          text: 'Hello there',
        },
      });
    });
    // The new-chat view hands over to /c/c1; assert the store folded the reply.
    const { useLiveStore } = await import('../../live/store');
    act(() => {
      socket?.push({
        type: 'conversation.event',
        event: {
          type: 'assistant.delta',
          conversationId: 'c1',
          seq: 1,
          at: 2,
          messageId: 'm1',
          kind: 'text',
          delta: 'Hi Ada!',
        },
      });
    });
    expect(useLiveStore.getState().views.c1?.items.at(-1)).toMatchObject({
      kind: 'assistant',
      text: 'Hi Ada!',
    });
    expect(useLiveStore.getState().created[sent.clientMessageId]).toBe('c1');
  });

  it('never shows the greeting again between the server naming a new chat and its address', async () => {
    mockFetch({ 'GET /api/state': () => appState(), 'GET /api/conversations': () => [] });
    renderApp(<ChatView />);
    await screen.findByRole('heading', { name: /, Ada\.$/ });
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Message Conch' }),
      'Hello there{Enter}',
    );
    const socket = FakeSocket.last;
    await waitFor(() =>
      expect(socket?.sent.some((m) => (m as { type: string }).type === 'conversation.send')).toBe(
        true,
      ),
    );
    const sent = socket?.sent.find((m) => (m as { type: string }).type === 'conversation.send') as {
      clientMessageId: string;
    };
    const bubble = screen.getByText('Hello there');
    // Named, before any event of the chat and before the address follows: the
    // message moves to the chat at that instant, and the splash must not come back.
    act(() => {
      socket?.push({
        type: 'conversation.created',
        clientMessageId: sent.clientMessageId,
        conversation: {
          id: 'c9',
          title: 'Hello there',
          preview: '',
          createdAt: 1,
          updatedAt: 1,
          status: 'running',
          options: {},
        },
      });
    });
    expect(screen.queryByRole('heading', { name: /, Ada\.$/ })).toBeNull();
    // The same bubble, not a new one drawn again.
    expect(screen.getByText('Hello there')).toBe(bubble);
  });

  it('shows a fix-it callout and keeps the draft when Claude Code is signed out', async () => {
    mockFetch({
      'GET /api/state': () =>
        appState({ engine: { ...appState().engine, state: 'signed-out', auth: undefined } }),
      'GET /api/conversations': () => [],
    });
    renderApp(<ChatView />);
    expect(await screen.findByText('Claude Code needs you to sign in')).toBeInTheDocument();
    const box = screen.getByRole('textbox', { name: 'Message Conch' });
    await userEvent.type(box, 'Are you there?{Enter}');
    const socket = FakeSocket.last;
    await waitFor(() => expect(socket?.sent.length).toBeGreaterThan(0));
    const sent = socket?.sent.find((m) => (m as { type: string }).type === 'conversation.send') as {
      clientMessageId: string;
    };
    act(() =>
      socket?.push({
        type: 'error',
        code: 'engine-unavailable',
        message: 'Claude Code is signed out.',
        clientMessageId: sent.clientMessageId,
      }),
    );
    await waitFor(() => expect(box).toHaveValue('Are you there?'));
  });

  it('says under the box what the mode in effect does, in the same words for every provider', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/models': () => ({
        default: 'codex-cli',
        providers: [
          {
            engine: 'codex-cli',
            label: 'Codex',
            models: [],
            commands: [],
            // It can't ask first, so "Ask first" isn't on offer: Read only is in effect.
            permissionModes: ['plan', 'auto', 'bypassPermissions'],
          },
        ],
      }),
    });
    renderApp(<ChatView />);
    expect(await screen.findByRole('button', { name: /Mode: Read only$/ })).toBeInTheDocument();
    expect(
      screen.getByText('Conch can make mistakes, and only looks and plans.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/always asks/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Mode: Read only$/ }));
    await userEvent.click(await screen.findByRole('radio', { name: /Auto/ }));
    expect(
      await screen.findByText('Conch can make mistakes, and asks only before risky steps.'),
    ).toBeInTheDocument();
  });

  it('keeps a chat on its own provider while that one is away, never showing another’s model', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [
        {
          id: 'c-away',
          title: 'Weather',
          preview: '',
          createdAt: 1,
          updatedAt: 1,
          status: 'idle',
          options: { engine: 'codex-cli', model: 'gpt-6.1-sol' },
        },
      ],
      // Codex dropped out of the list for a moment; only Claude Code answered.
      'GET /api/models': () => ({
        default: 'claude-code',
        providers: [
          {
            engine: 'claude-code',
            label: 'Claude Code',
            local: false,
            models: [
              {
                id: 'sonnet',
                label: 'Sonnet 5.5',
                description: '',
                efforts: [],
                supportsFastMode: false,
                supportsAutoMode: false,
              },
            ],
            commands: [],
            permissionModes: ['default'],
          },
        ],
      }),
    });
    renderApp(<ChatView conversationId="c-away" />, { route: '/c/c-away' });
    expect(await screen.findByRole('button', { name: /^Model: gpt-6\.1-sol/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Model: Sonnet/ })).not.toBeInTheDocument();
  });

  it('picks a model from any connected provider, found by name, for the next chat', async () => {
    const model = (id: string, label: string) => ({
      id,
      label,
      description: '',
      efforts: [],
      supportsFastMode: false,
      supportsAutoMode: false,
    });
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/models': () => ({
        default: 'claude-code',
        providers: [
          {
            engine: 'claude-code',
            label: 'Claude Code',
            models: [
              model('default', 'Default (recommended)'),
              model('opus', 'Opus 5.5'),
              model('sonnet', 'Sonnet 5.5'),
              model('haiku', 'Haiku 4.5'),
              model('fable', 'Fable 5.1'),
            ],
            commands: [],
            permissionModes: ['default', 'plan', 'bypassPermissions'],
          },
          {
            engine: 'openrouter',
            label: 'OpenRouter',
            models: [
              model('openai/gpt-5.2', 'OpenAI: GPT-5.2'),
              model('qwen/qwen3-coder', 'Qwen: Qwen3 Coder'),
              model('deepseek/deepseek-v3.2', 'DeepSeek: DeepSeek V3.2'),
              model('moonshotai/kimi-k2.5', 'MoonshotAI: Kimi K2.5'),
            ],
            commands: [],
            permissionModes: ['default'],
          },
        ],
      }),
    });
    renderApp(<ChatView />);
    await userEvent.click(await screen.findByRole('button', { name: /Model: Default/ }));
    // Both providers, one list.
    expect(await screen.findByRole('group', { name: /^Claude Code/ })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /^OpenRouter/ })).toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search models' }), 'qwen');
    await userEvent.keyboard('{Enter}');
    expect(
      await screen.findByRole('button', { name: /^Model: Qwen: Qwen3 Coder \(OpenRouter\)\./ }),
    ).toBeInTheDocument();

    await userEvent.type(screen.getByRole('textbox', { name: 'Message Conch' }), 'Hi{Enter}');
    await waitFor(() =>
      expect(FakeSocket.last?.sent).toContainEqual(
        expect.objectContaining({
          type: 'conversation.send',
          options: { engine: 'openrouter', model: 'qwen/qwen3-coder' },
        }),
      ),
    );
  });

  it('at a limit, answering with another provider once offers to do it by itself next time', async () => {
    const model = (id: string, label: string) => ({
      id,
      label,
      description: '',
      efforts: [],
      supportsFastMode: false,
      supportsAutoMode: false,
    });
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/models': () => ({
        default: 'claude-code',
        providers: [
          {
            engine: 'claude-code',
            label: 'Claude Code',
            models: [model('default', 'Default (recommended)')],
            commands: [],
            permissionModes: ['default'],
          },
          {
            engine: 'openrouter',
            label: 'OpenRouter',
            models: [model('qwen/qwen3-coder', 'Qwen: Qwen3 Coder')],
            commands: [],
            permissionModes: ['default'],
          },
        ],
      }),
      'PATCH /api/settings': () => appState(),
    });
    renderApp(
      <>
        <ChatView conversationId="c-limit" />
        <Toaster />
      </>,
      { route: '/c/c-limit' },
    );
    await screen.findByRole('textbox', { name: 'Message Conch' });
    act(() => {
      for (const [seq, event] of [
        { type: 'user.message', messageId: 'u1', text: 'Keep going' },
        {
          type: 'turn.completed',
          outcome: 'error',
          error: 'You’ve reached your limit.',
          problem: 'limit',
          engine: 'claude-code',
        },
        { type: 'status', status: 'error' },
      ].entries())
        FakeSocket.last?.push({
          type: 'conversation.event',
          event: { conversationId: 'c-limit', seq, at: 1000 + seq, ...event },
        } as never);
    });
    await userEvent.click(
      await screen.findByRole('button', { name: 'Answer with OpenRouter for now' }),
    );
    expect(
      await screen.findByText(/Next time Claude Code reaches a limit, carry on with OpenRouter/),
    ).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Always' }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          method: 'PATCH',
          path: '/api/settings',
          body: { preferences: { limitFallback: 'openrouter' } },
        }),
      ),
    );
  });

  it('Stop works the moment you send — a new chat stops as soon as it exists', async () => {
    mockFetch({ 'GET /api/state': () => appState(), 'GET /api/conversations': () => [] });
    renderApp(<ChatView />);
    await userEvent.type(
      await screen.findByRole('textbox', { name: 'Message Conch' }),
      'Write me a long story{Enter}',
    );
    const socket = FakeSocket.last;
    const sent = await waitFor(() => {
      const message = socket?.sent.find(
        (m) => (m as { type: string }).type === 'conversation.send',
      ) as { clientMessageId: string } | undefined;
      expect(message).toBeDefined();
      return message as { clientMessageId: string };
    });
    // Before the server has even created the chat.
    await userEvent.click(screen.getByRole('button', { name: /Stop/ }));
    expect(
      socket?.sent.some((m) => (m as { type: string }).type === 'conversation.interrupt'),
    ).toBe(false);
    act(() =>
      socket?.push({
        type: 'conversation.created',
        clientMessageId: sent.clientMessageId,
        conversation: {
          id: 'c-stop',
          title: 'Write me a long story',
          preview: '',
          createdAt: 1,
          updatedAt: 1,
          status: 'running',
          options: {},
        },
      }),
    );
    expect(socket?.sent).toContainEqual({
      type: 'conversation.interrupt',
      conversationId: 'c-stop',
    });
  });

  it('opens a chat whole: its outline while the log is on its way, then all of it at once', async () => {
    FakeSocket.autoSync = false;
    try {
      mockFetch({ 'GET /api/state': () => appState(), 'GET /api/conversations': () => [] });
      renderApp(<ChatView conversationId="c-open" />, { route: '/c/c-open' });
      await waitFor(() =>
        expect(FakeSocket.last?.sent).toContainEqual(
          expect.objectContaining({ type: 'conversation.subscribe', conversationId: 'c-open' }),
        ),
      );
      expect(screen.getByRole('status', { name: 'Opening the conversation' })).toBeInTheDocument();
      // A new chat's "can make mistakes" line is no part of an old chat opening.
      expect(screen.queryByText(/can make mistakes/)).toBeNull();

      // The log arrives (a live event can overtake it), and nothing is drawn piece by piece.
      events('c-open', 2, [{ type: 'user.message', messageId: 'u2', text: 'And tomorrow?' }]);
      events('c-open', 0, [
        { type: 'user.message', messageId: 'u1', text: 'What’s the weather?' },
        { type: 'turn.completed', outcome: 'success' },
      ]);
      expect(screen.queryByText('What’s the weather?')).toBeNull();
      expect(screen.getByRole('status', { name: 'Opening the conversation' })).toBeInTheDocument();

      act(() => FakeSocket.last?.push({ type: 'conversation.synced', conversationId: 'c-open' }));
      expect(screen.getByText('What’s the weather?')).toBeInTheDocument();
      expect(screen.getByText('And tomorrow?')).toBeInTheDocument();
      expect(screen.queryByRole('status', { name: 'Opening the conversation' })).toBeNull();
      expect(useLiveStore.getState().views['c-open']).toMatchObject({ lastSeq: 2, loaded: true });

      // From here on, what happens shows as it happens.
      events('c-open', 3, [{ type: 'turn.completed', outcome: 'success' }]);
      expect(useLiveStore.getState().views['c-open']?.lastSeq).toBe(3);
    } finally {
      FakeSocket.autoSync = true;
    }
  });
});

describe('The message box', () => {
  const open = async (id: string) => {
    mockFetch({ 'GET /api/state': () => appState(), 'GET /api/conversations': () => [] });
    const view = renderApp(<ChatView conversationId={id} />, { route: `/c/${id}` });
    const box = await screen.findByRole('textbox', { name: 'Message Conch' });
    await waitFor(() => expect(FakeSocket.last?.readyState).toBe(1));
    return { box, ...view };
  };

  it('brings back what you sent with ↑, and walks forward with ↓', async () => {
    const { box } = await open('c-up');
    events('c-up', 0, [
      { type: 'user.message', messageId: 'u1', text: 'Plan my week' },
      { type: 'turn.completed', outcome: 'success' },
      { type: 'user.message', messageId: 'u2', text: 'Make it shorter' },
      { type: 'turn.completed', outcome: 'success' },
      { type: 'status', status: 'idle' },
    ]);
    await userEvent.click(box);
    await userEvent.keyboard('{ArrowUp}');
    expect(box).toHaveValue('Make it shorter');
    await userEvent.keyboard('{ArrowUp}');
    expect(box).toHaveValue('Plan my week');
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(box).toHaveValue('');
  });

  it('queues each message you send while it works, and sends them one at a time', async () => {
    const { box } = await open('c-queue');
    events('c-queue', 0, [
      { type: 'user.message', messageId: 'u1', text: 'Fix the bug' },
      { type: 'status', status: 'running' },
    ]);
    await userEvent.type(box, 'Then run the tests');
    await userEvent.click(
      screen.getByRole('button', { name: 'Queue it: sends when Conch is done' }),
    );
    expect(box).toHaveValue('');
    await userEvent.type(box, 'And the linter{Enter}');
    const queue = screen.getByRole('region', { name: '2 messages waiting' });
    expect(
      within(queue)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      expect.stringContaining('Then run the tests'),
      expect.stringContaining('And the linter'),
    ]);
    expect(queue).toHaveTextContent('Sends one at a time when Conch is done');
    expect(sends()).toEqual([]);
    // Still writing when it goes: that stays in the box.
    await userEvent.type(box, 'one more thing');
    events('c-queue', 2, [
      { type: 'turn.completed', outcome: 'success' },
      { type: 'status', status: 'idle' },
    ]);
    await waitFor(() =>
      expect(sends()).toEqual([expect.objectContaining({ text: 'Then run the tests' })]),
    );
    expect(box).toHaveValue('one more thing');
    // The next waits for that reply.
    expect(screen.getByRole('region', { name: 'A message waiting' })).toHaveTextContent(
      'And the linter',
    );
    const sent = sends() as unknown as { clientMessageId: string }[];
    events('c-queue', 4, [
      { type: 'user.message', messageId: sent[0]?.clientMessageId, text: 'Then run the tests' },
      { type: 'status', status: 'running' },
      { type: 'turn.completed', outcome: 'success' },
      { type: 'status', status: 'idle' },
    ]);
    await waitFor(() => expect(sends()).toHaveLength(2));
    expect(sends()[1]).toMatchObject({ text: 'And the linter' });
    expect(screen.queryByRole('region', { name: /waiting/ })).toBeNull();
  });

  it('changes the order of what waits with the arrow keys on its handle', async () => {
    const { box } = await open('c-order');
    events('c-order', 0, [
      { type: 'user.message', messageId: 'u1', text: 'Fix the bug' },
      { type: 'status', status: 'running' },
    ]);
    await userEvent.type(box, 'First{Enter}');
    await userEvent.type(box, 'Second{Enter}');
    const handle = screen.getByRole('button', { name: /^Move “Second”, 2 of 2/ });
    handle.focus();
    await userEvent.keyboard('{ArrowUp}');
    const queue = screen.getByRole('region', { name: '2 messages waiting' });
    expect(
      within(queue)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([expect.stringContaining('Second'), expect.stringContaining('First')]);
    expect(within(queue).getByRole('status')).toHaveTextContent('Moved to 1 of 2.');
  });

  it('steers with one: stops the reply and sends it now, and the rest keep waiting', async () => {
    const { box } = await open('c-steer');
    events('c-steer', 0, [
      { type: 'user.message', messageId: 'u1', text: 'Refactor the parser' },
      { type: 'status', status: 'running' },
    ]);
    await userEvent.type(box, 'Use the new API{Enter}');
    await userEvent.type(box, 'Then add tests{Enter}');
    const queue = screen.getByRole('region', { name: '2 messages waiting' });
    const [first] = within(queue).getAllByRole('button', {
      name: 'Steer: stop Conch and send this now',
    });
    await userEvent.click(first as HTMLElement);
    // One step: the gateway stops the reply and then sends it, so nothing lands between.
    expect(sends()).toEqual([expect.objectContaining({ text: 'Use the new API', steer: true })]);
    // The stopped reply's end isn't a reason to hold the rest back, nor to send them yet.
    events('c-steer', 2, [
      { type: 'turn.completed', outcome: 'interrupted' },
      { type: 'status', status: 'idle' },
    ]);
    expect(sends()).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'A message waiting' })).toHaveTextContent(
      'Then add tests',
    );
    // The steered message's own reply ends: the next one goes, as any queued one would.
    const steered = sends()[0] as unknown as { clientMessageId: string };
    events('c-steer', 4, [
      { type: 'user.message', messageId: steered.clientMessageId, text: 'Use the new API' },
      { type: 'status', status: 'running' },
      { type: 'turn.completed', outcome: 'success' },
      { type: 'status', status: 'idle' },
    ]);
    await waitFor(() => expect(sends()).toHaveLength(2));
    expect(sends()[1]).toMatchObject({ text: 'Then add tests' });
  });

  it('steers with what is in the box on mod+Enter instead of queueing it', async () => {
    const { box } = await open('c-steer2');
    events('c-steer2', 0, [
      { type: 'user.message', messageId: 'u1', text: 'Refactor the parser' },
      { type: 'status', status: 'running' },
    ]);
    await userEvent.type(box, 'Stop, use the old one{Control>}{Enter}{/Control}');
    expect(sends()).toEqual([
      expect.objectContaining({ text: 'Stop, use the old one', steer: true }),
    ]);
    expect(box).toHaveValue('');
    expect(screen.queryByRole('region', { name: /waiting/ })).toBeNull();
  });

  it('holds the queue when you stop the reply, and sends one when you say', async () => {
    const { box } = await open('c-stopq');
    events('c-stopq', 0, [
      { type: 'user.message', messageId: 'u1', text: 'Write a story' },
      { type: 'status', status: 'running' },
    ]);
    await userEvent.type(box, 'Make it funny{Enter}');
    events('c-stopq', 2, [
      { type: 'turn.completed', outcome: 'interrupted' },
      { type: 'status', status: 'idle' },
    ]);
    const queue = await screen.findByRole('region', { name: 'A message waiting' });
    await waitFor(() => expect(queue).toHaveTextContent('Waiting: the reply was stopped'));
    expect(sends()).toEqual([]);
    await userEvent.click(within(queue).getByRole('button', { name: 'Send this now' }));
    // Nothing runs: a plain send, no steer.
    expect(sends()).toEqual([expect.objectContaining({ text: 'Make it funny' })]);
    expect(sends()[0]).not.toHaveProperty('steer');
  });

  it('takes a queued message back to change it', async () => {
    const { box } = await open('c-editq');
    events('c-editq', 0, [
      { type: 'user.message', messageId: 'u1', text: 'Write a story' },
      { type: 'status', status: 'running' },
    ]);
    await userEvent.type(box, 'Make it funny{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Edit: take it back into the box' }));
    expect(box).toHaveValue('Make it funny');
    expect(box).toHaveFocus();
    expect(screen.queryByRole('region', { name: /waiting/ })).toBeNull();
  });

  it('keeps what you were writing in a chat when you come back to it', async () => {
    const { box, unmount } = await open('c-draft');
    await userEvent.type(box, 'half a thought');
    unmount();
    const again = await open('c-draft');
    expect(again.box).toHaveValue('half a thought');
    await userEvent.clear(again.box);
    again.unmount();
    expect((await open('c-draft')).box).toHaveValue('');
  });

  it('writes in the box when you start typing anywhere in the chat', async () => {
    const { box } = await open('c-type');
    box.blur();
    expect(box).not.toHaveFocus();
    await userEvent.keyboard('h');
    expect(box).toHaveFocus();
  });
});

describe('Chats started elsewhere', () => {
  it('subscribes when you open a chat another tab or a channel started', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/channels': () => ({ channels: [], catalog: [] }),
    });
    const { useState } = await import('react');
    function Later() {
      const [open, setOpen] = useState(false);
      return open ? (
        <ChatView conversationId="c9" />
      ) : (
        <button type="button" onClick={() => setOpen(true)}>
          open
        </button>
      );
    }
    renderApp(<Later />);
    await waitFor(() => expect(FakeSocket.last?.readyState).toBe(1));
    const socket = FakeSocket.last;
    // Telegram started it: this tab never sent its first message.
    act(() =>
      socket?.push({
        type: 'conversation.created',
        clientMessageId: 'u_from_telegram',
        conversation: {
          id: 'c9',
          title: 'From my phone',
          preview: '',
          createdAt: 1,
          updatedAt: 1,
          status: 'running',
          options: {},
          origin: { kind: 'channel', channelId: 'ch_1', channel: 'telegram' },
        },
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'open' }));
    await waitFor(() =>
      expect(socket?.sent).toContainEqual(
        expect.objectContaining({ type: 'conversation.subscribe', conversationId: 'c9' }),
      ),
    );
  });
});

describe('Tasks started together', () => {
  it('are one card in the chat, and each opens over it in a sheet you step through', async () => {
    const user = userEvent.setup();
    const helper = (id: string, title: string, patch: Record<string, unknown> = {}) => ({
      id,
      kind: 'helper',
      title,
      prompt: title,
      status: 'running',
      options: {},
      createdAt: id === 'a' ? 1 : 2,
      startedAt: Date.now() - 10_000,
      steps: [],
      group: 'g1',
      parentConversationId: 'c-batch',
      conversationId: `c-${id}`,
      rev: 1,
      ...patch,
    });
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/tasks': () => ({
        concurrent: 3,
        tasks: [
          helper('a', 'Check the tests', { current: 'Running `npm test`' }),
          helper('b', 'Read the README', {
            status: 'done',
            summary: 'It explains setup well.',
            finishedAt: Date.now(),
          }),
        ],
      }),
    });
    const { where } = renderApp(<ChatView conversationId="c-batch" />, { route: '/c/c-batch' });
    await waitFor(() => expect(FakeSocket.last?.readyState).toBe(1));
    const note = (taskId: string, title: string, state: string) => ({
      type: 'task',
      taskId,
      title,
      kind: 'helper',
      state,
      group: 'g1',
    });
    events('c-batch', 0, [
      note('a', 'Check the tests', 'running'),
      note('b', 'Read the README', 'running'),
      note('b', 'Read the README', 'done'),
    ]);
    const card = await screen.findByRole('article', { name: '2 tasks' });
    await waitFor(() => expect(card).toHaveTextContent('1 working · 1 done'));
    expect(card).toHaveTextContent('It explains setup well.');
    await user.click(within(card).getByRole('button', { name: /Read the README/ }));
    await waitFor(() => expect(where()).toBe('/c/c-batch?task=b'));
    const sheet = await screen.findByRole('dialog', { name: 'Read the README' });
    const tabs = within(sheet).getByRole('tablist', { name: '2 tasks started together' });
    // What's working first.
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((t) => t.getAttribute('aria-label')),
    ).toEqual(['Check the tests: Working', 'Read the README: Done']);
    await user.click(within(tabs).getByRole('tab', { name: 'Check the tests: Working' }));
    await waitFor(() => expect(where()).toBe('/c/c-batch?task=a'));
    expect(await screen.findByRole('dialog', { name: 'Check the tests' })).toBeInTheDocument();
    expect(FakeSocket.last?.sent).toContainEqual(
      expect.objectContaining({ type: 'conversation.subscribe', conversationId: 'c-a' }),
    );
    await user.keyboard('{Escape}');
    await waitFor(() => expect(where()).toBe('/c/c-batch'));
  });
});
