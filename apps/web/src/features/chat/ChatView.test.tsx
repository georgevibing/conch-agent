import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUi } from '../../app/ui';
import { appState, FakeSocket, mockFetch, renderApp } from '../../test/harness';
import { ChatView } from './ChatView';

afterEach(() => {
  vi.unstubAllGlobals();
  // The composer's pickers and a new chat's choices live in a shared store.
  useUi.setState({ picker: null, draftOptions: {} });
});

describe('ChatView', () => {
  it('greets, sends a new conversation and renders the streamed reply', async () => {
    mockFetch({ 'GET /api/state': () => appState(), 'GET /api/conversations': () => [] });
    renderApp(<ChatView />);
    expect(await screen.findByRole('heading', { name: /, Ada\.$/ })).toBeInTheDocument();

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
