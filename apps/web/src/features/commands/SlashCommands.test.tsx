/**
 * Typing "/" in a chat, end to end through the composer: the menu, a
 * command's values with the current one marked, and the commands the gateway
 * does for every provider (`/clear` and its Undo, `/goal`, `/plan`).
 */
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toaster } from '@conch/nacre';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUi } from '../../app/ui';
import { useLiveStore } from '../../live/store';
import { appState, FakeSocket, mockFetch, renderApp } from '../../test/harness';
import { ChatView } from '../chat/ChatView';

afterEach(() => {
  vi.unstubAllGlobals();
  useUi.setState({ picker: null, draftOptions: {}, draftGoal: null });
  // Each test opens the same chat afresh.
  useLiveStore.setState({ pending: {}, views: {} });
  localStorage.clear();
  sessionStorage.clear();
});

const model = (id: string, label: string, efforts: string[] = []) => ({
  id,
  label,
  description: `${label}, for tests`,
  efforts,
  supportsFastMode: false,
  supportsAutoMode: false,
});

const chat = {
  id: 'c1',
  title: 'The garden',
  preview: '',
  createdAt: 1,
  updatedAt: 1,
  status: 'idle' as const,
  options: { effort: 'high' as const },
};

function setup(conversations: unknown[] = [chat]) {
  return mockFetch({
    'GET /api/state': () => appState(),
    'GET /api/conversations': () => conversations,
    'GET /api/models': () => ({
      default: 'claude-code',
      providers: [
        {
          engine: 'claude-code',
          label: 'Claude Code',
          models: [
            model('default', 'Default (recommended)', ['low', 'medium', 'high']),
            model('opus', 'Opus 5.5', ['low', 'medium', 'high']),
          ],
          commands: [],
          permissionModes: ['default', 'acceptEdits', 'plan', 'bypassPermissions'],
        },
        {
          engine: 'openrouter',
          label: 'OpenRouter',
          models: [model('qwen/qwen3-coder', 'Qwen: Qwen3 Coder')],
          commands: [],
          permissionModes: ['default', 'plan'],
        },
      ],
    }),
    'POST /api/conversations/c1/clear': () => ({ changed: true, message: 'Cleared.' }),
    'POST /api/conversations/c1/clear/undo': () => ({ changed: true, message: 'Back.' }),
    'PUT /api/conversations/c1/goal': () => ({ ok: true }),
  });
}

/** Events of the open chat, in order, as the gateway would send them. */
function events(from: number, list: Record<string, unknown>[]) {
  act(() => {
    for (const [i, event] of list.entries())
      FakeSocket.last?.push({
        type: 'conversation.event',
        event: { conversationId: 'c1', seq: from + i, at: 1000 + from + i, ...event },
      } as never);
  });
}

const sent = (type: string) =>
  (FakeSocket.last?.sent ?? []).filter((m) => (m as { type: string }).type === type) as Record<
    string,
    unknown
  >[];

async function open() {
  renderApp(
    <>
      <ChatView conversationId="c1" />
      <Toaster />
    </>,
    { route: '/c/c1' },
  );
  const box = await screen.findByRole('textbox', { name: 'Message Conch' });
  // The models are in: the composer knows what this chat uses.
  await screen.findByRole('button', { name: /Model: Default/ });
  return box;
}

describe('the command menu in a chat', () => {
  it('goes on from /effort to the thinking levels, the current one marked, and picks one', async () => {
    setup();
    const box = await open();
    await userEvent.type(box, '/eff');
    const commands = screen.getByRole('listbox', { name: 'Commands' });
    expect(within(commands).getByRole('option', { name: /effort/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await userEvent.keyboard('{Enter}');
    expect(box).toHaveValue('/effort ');
    const levels = screen.getByRole('listbox', { name: 'effort choices' });
    const high = within(levels).getByRole('option', { name: /High/ });
    expect(high).toHaveTextContent('Current');
    expect(high).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowUp}{Enter}');
    await waitFor(() =>
      expect(sent('conversation.configure')).toContainEqual(
        expect.objectContaining({ conversationId: 'c1', options: { effort: 'medium' } }),
      ),
    );
    expect(box).toHaveValue('');
  });

  it('lists models from every provider by name, and picks one by what you type', async () => {
    setup();
    const box = await open();
    await userEvent.type(box, '/model qwen');
    const list = screen.getByRole('listbox', { name: 'model choices' });
    expect(within(list).getAllByRole('option')).toHaveLength(1);
    await userEvent.keyboard('{Enter}');
    await waitFor(() =>
      expect(sent('conversation.configure')).toContainEqual(
        expect.objectContaining({
          options: { engine: 'openrouter', model: 'qwen/qwen3-coder' },
        }),
      ),
    );
  });

  it('groups commands by what they act on, and hides the provider’s that Conch covers', async () => {
    setup();
    const box = await open();
    await userEvent.type(box, '/');
    const list = screen.getByRole('listbox', { name: 'Commands' });
    for (const group of ['This chat', 'How it answers', 'Conch'])
      expect(within(list).getByRole('group', { name: group })).toBeInTheDocument();
  });
});

describe('/clear', () => {
  it('clears the chat on the gateway, draws the line, and Undo puts it back', async () => {
    const calls = setup();
    const box = await open();
    events(0, [{ type: 'user.message', messageId: 'u1', text: 'Tomatoes?' }]);
    await userEvent.type(box, '/clear{Enter}');
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({ method: 'POST', path: '/api/conversations/c1/clear' }),
      ),
    );
    expect(box).toHaveValue('');
    events(1, [{ type: 'context.cleared' }]);
    expect(
      await screen.findByText(/Context cleared: Conch starts fresh from here/),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Undo clearing the context' }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({ method: 'POST', path: '/api/conversations/c1/clear/undo' }),
      ),
    );
    events(2, [{ type: 'context.restored', clearedSeq: 1 }]);
    await waitFor(() =>
      expect(screen.queryByText(/Context cleared: Conch starts fresh/)).not.toBeInTheDocument(),
    );
  });

  it('can’t be undone from the line once something new was sent', async () => {
    setup();
    await open();
    events(0, [
      { type: 'user.message', messageId: 'u1', text: 'One' },
      { type: 'context.cleared' },
      { type: 'user.message', messageId: 'u2', text: 'Two' },
    ]);
    expect(await screen.findByText(/Context cleared/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo clearing the context' })).toBeNull();
  });
});

describe('/goal', () => {
  it('sets the goal on the gateway, and shows it quietly above the composer', async () => {
    const calls = setup();
    const box = await open();
    await userEvent.type(box, '/go{Enter}');
    expect(box).toHaveValue('/goal ');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Write what this chat is for, then press Enter.',
    );
    await userEvent.type(box, 'Ship the release notes{Enter}');
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          method: 'PUT',
          path: '/api/conversations/c1/goal',
          body: { goal: 'Ship the release notes' },
        }),
      ),
    );
    events(0, [{ type: 'goal', goal: 'Ship the release notes' }]);
    expect(
      await screen.findByRole('button', { name: 'Goal: Ship the release notes. Change it' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Goal set:/)).toBeInTheDocument();
  });

  it('goes with a new chat’s first message', async () => {
    setup([]);
    renderApp(<ChatView />);
    const box = await screen.findByRole('textbox', { name: 'Message Conch' });
    await userEvent.type(box, '/goal Plan the garden{Enter}');
    expect(
      await screen.findByRole('button', { name: 'Goal: Plan the garden. Change it' }),
    ).toBeInTheDocument();
    await userEvent.type(box, 'Hello{Enter}');
    await waitFor(() =>
      expect(sent('conversation.send')).toContainEqual(
        expect.objectContaining({ text: 'Hello', goal: 'Plan the garden' }),
      ),
    );
  });
});

describe('/plan', () => {
  it('turns plan mode on and off, back to the mode before', async () => {
    setup();
    const box = await open();
    await userEvent.type(box, '/plan{Enter}');
    await waitFor(() =>
      expect(sent('conversation.configure')).toContainEqual(
        expect.objectContaining({ options: { permissionMode: 'plan' } }),
      ),
    );
    events(0, [{ type: 'options', options: { effort: 'high', permissionMode: 'plan' } }]);
    await userEvent.type(box, '/plan off{Enter}');
    await waitFor(() =>
      expect(sent('conversation.configure')).toContainEqual(
        expect.objectContaining({ options: { permissionMode: 'default' } }),
      ),
    );
  });

  it('sends what to plan in plan mode, in one step', async () => {
    setup();
    const box = await open();
    await userEvent.type(box, '/plan tidy up this folder{Enter}');
    await waitFor(() =>
      expect(sent('conversation.send')).toContainEqual(
        expect.objectContaining({
          text: 'tidy up this folder',
          options: expect.objectContaining({ permissionMode: 'plan' }),
        }),
      ),
    );
  });
});
