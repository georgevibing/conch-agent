import { act, screen, waitFor } from '@testing-library/react';
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
  ) as { text: string }[];

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
            // It can't ask first, so "Ask first" isn't on offer: Plan only is in effect.
            permissionModes: ['plan', 'acceptEdits', 'bypassPermissions'],
          },
        ],
      }),
    });
    renderApp(<ChatView />);
    expect(await screen.findByRole('button', { name: 'Mode: Plan only' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Conch can make mistakes, and only reads and plans: it won’t change anything.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/always asks/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Mode: Plan only' }));
    await userEvent.click(await screen.findByRole('radio', { name: /Edit freely/ }));
    expect(
      await screen.findByText(
        'Conch can make mistakes, and changes files in this folder without asking.',
      ),
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
            permissionModes: ['default', 'acceptEdits', 'plan', 'bypassPermissions'],
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
      await screen.findByRole('button', { name: 'Model: Qwen: Qwen3 Coder (OpenRouter)' }),
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

  it('queues what you send while it works, and sends it when the reply is over', async () => {
    const { box } = await open('c-queue');
    events('c-queue', 0, [
      { type: 'user.message', messageId: 'u1', text: 'Fix the bug' },
      { type: 'status', status: 'running' },
    ]);
    await userEvent.type(box, 'Then run the tests');
    await userEvent.click(screen.getByRole('button', { name: 'Send when Conch is done' }));
    expect(box).toHaveValue('');
    expect(screen.getByRole('status', { name: 'Queued message' })).toHaveTextContent(
      /Then run the tests/,
    );
    expect(screen.getByText('Sends when Conch is done')).toBeInTheDocument();
    // More written meanwhile joins it.
    await userEvent.type(box, 'and the linter{Enter}');
    expect(sends()).toEqual([]);
    // Still writing when it goes: that stays in the box.
    await userEvent.type(box, 'one more thing');
    events('c-queue', 2, [
      { type: 'turn.completed', outcome: 'success' },
      { type: 'status', status: 'idle' },
    ]);
    await waitFor(() =>
      expect(sends()).toEqual([
        expect.objectContaining({ text: 'Then run the tests\n\nand the linter' }),
      ]),
    );
    expect(screen.queryByText('Sends when Conch is done')).toBeNull();
    expect(box).toHaveValue('one more thing');
  });

  it('puts a queued message back in the box when the reply is stopped', async () => {
    const { box } = await open('c-stopq');
    events('c-stopq', 0, [
      { type: 'user.message', messageId: 'u1', text: 'Write a story' },
      { type: 'status', status: 'running' },
    ]);
    await userEvent.type(box, 'Make it funny{Enter}');
    expect(box).toHaveValue('');
    events('c-stopq', 2, [
      { type: 'turn.completed', outcome: 'interrupted' },
      { type: 'status', status: 'idle' },
    ]);
    await waitFor(() => expect(box).toHaveValue('Make it funny'));
    expect(sends()).toEqual([]);
  });

  it('takes a queued message back to change it', async () => {
    const { box } = await open('c-editq');
    events('c-editq', 0, [
      { type: 'user.message', messageId: 'u1', text: 'Write a story' },
      { type: 'status', status: 'running' },
    ]);
    await userEvent.type(box, 'Make it funny{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Edit queued message' }));
    expect(box).toHaveValue('Make it funny');
    expect(box).toHaveFocus();
    expect(screen.queryByText('Sends when Conch is done')).toBeNull();
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
