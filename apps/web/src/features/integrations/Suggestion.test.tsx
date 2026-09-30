import type {
  CatalogEntry,
  ConversationEvent,
  Integration,
  IntegrationsList,
} from '@conch/protocol';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { reduceAll } from '../../live/reducer';
import { useLiveStore } from '../../live/store';
import { appState, FakeSocket, mockFetch, renderApp } from '../../test/harness';
import { ChatView } from '../chat/ChatView';
import { ModelsTab } from '../settings/ModelsTab';

afterEach(() => {
  vi.unstubAllGlobals();
  // Conversations live in a shared store: start every test from an empty chat.
  useLiveStore.setState({ views: {}, pending: {} });
});

const QUESTION = 'what’s assigned to me in Linear this week?';

const linear: CatalogEntry = {
  id: 'linear',
  name: 'Linear',
  tagline: 'Issues and projects',
  description: 'Find, create and update issues and projects.',
  category: 'productivity',
  auth: 'oauth',
  color: '#5E6AD2',
  local: false,
  fields: [],
  steps: [],
  examples: ['What’s assigned to me this cycle?'],
  access: ['Read issues, projects and comments'],
  featured: true,
};

const connected = (health: Integration['health']): Integration => ({
  id: 'int_linear',
  catalogId: 'linear',
  name: 'Linear',
  server: 'linear',
  transport: { type: 'http', url: 'https://mcp.linear.app/mcp' },
  auth: 'oauth',
  enabled: true,
  policy: 'ask-writes',
  health,
  tools: [],
  values: {},
  secrets: [],
  createdAt: 1,
  updatedAt: 1,
});

let seq = 0;
const logged = <T extends { type: string }>(event: T) =>
  ({ conversationId: 'c1', seq: seq++, at: Date.now(), ...event }) as unknown as ConversationEvent;

/** A finished turn in which the gateway offered Linear. */
function turn(): ConversationEvent[] {
  seq = 0;
  return [
    logged({ type: 'user.message', messageId: 'u1', text: QUESTION }),
    logged({ type: 'status', status: 'running' }),
    logged({
      type: 'integration.suggestion',
      catalogId: 'linear',
      name: 'Linear',
      description: linear.description,
      color: '#5E6AD2',
    }),
    logged({
      type: 'assistant.delta',
      messageId: 'm1',
      kind: 'text',
      delta: 'I can’t see it yet.',
    }),
    logged({ type: 'assistant.done', messageId: 'm1' }),
    logged({ type: 'turn.completed', outcome: 'success' }),
    logged({ type: 'status', status: 'idle' }),
  ];
}

function open(options: { muted?: string[] } = {}) {
  let list: IntegrationsList = { catalog: [linear], integrations: [], providers: [] };
  let muted = options.muted ?? [];
  const calls = mockFetch({
    'GET /api/state': () =>
      appState({ preferences: { ...appState().preferences, mutedSuggestions: muted } }),
    'GET /api/conversations': () => [],
    'GET /api/integrations': () => list,
    'POST /api/integrations': () => {
      const integration = connected({
        state: 'connecting',
        message: 'Waiting for you to sign in.',
      });
      list = { ...list, integrations: [integration] };
      return { integration, authorizeUrl: 'https://linear.example/authorize?x=1' };
    },
    'POST /api/conversations/c1/suggestions/linear/dismiss': () => ({ ok: true }),
    'PATCH /api/settings': (body) => {
      muted = (body as { preferences: { mutedSuggestions: string[] } }).preferences
        .mutedSuggestions;
      return appState({ preferences: { ...appState().preferences, mutedSuggestions: muted } });
    },
  });
  const popup = { closed: false, location: { href: '' }, focus: vi.fn(), close: vi.fn() };
  vi.stubGlobal(
    'open',
    vi.fn(() => popup),
  );
  const view = renderApp(<ChatView conversationId="c1" />, { route: '/c/c1' });
  const push = (events: ConversationEvent[]) =>
    act(() => {
      for (const event of events) FakeSocket.last?.push({ type: 'conversation.event', event });
    });
  return { ...view, calls, popup, push, setList: (next: IntegrationsList) => (list = next) };
}

describe('connect from the chat', () => {
  it('offers Linear under the reply, connects in place, then asks again', async () => {
    const { calls, popup, push } = open();
    await waitFor(() => expect(FakeSocket.last).toBeDefined());
    push(turn());

    const card = await screen.findByRole('group', { name: 'Linear isn’t connected yet' });
    // Under the reply it came with, not above it.
    const reply = screen.getByText('I can’t see it yet.');
    expect(reply.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await userEvent.click(within(card).getByRole('button', { name: 'Connect Linear' }));
    const dialog = await screen.findByRole('dialog', { name: 'Connect Linear' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue with Linear' }));
    await waitFor(() => expect(popup.location.href).toBe('https://linear.example/authorize?x=1'));
    expect(calls).toContainEqual(
      expect.objectContaining({ method: 'POST', path: '/api/integrations?display=popup' }),
    );
    // Nothing leaves the chat.
    expect(window.location.pathname).not.toMatch(/integrations/);

    // The sign-in finishes in the popup; the gateway says so over the live connection.
    act(() =>
      FakeSocket.last?.push({
        type: 'integration.changed',
        integration: connected({ state: 'ok', checkedAt: 2, okAt: 2 }),
      }),
    );
    const done = await screen.findByRole('dialog', { name: 'Linear is connected' });
    expect(within(done).queryByText('Try asking')).toBeNull();
    await userEvent.click(within(done).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const settled = screen.getByRole('group', { name: 'Linear is connected' });
    const again = within(settled).getByRole('button', { name: 'Ask again' });
    expect(again).toHaveFocus();
    await userEvent.click(again);
    await waitFor(() =>
      expect(FakeSocket.last?.sent).toContainEqual(
        expect.objectContaining({
          type: 'conversation.send',
          conversationId: 'c1',
          text: QUESTION,
        }),
      ),
    );
  });

  it('“Not now” puts it away for this chat, and it stays away after a reload', async () => {
    const { calls, push } = open();
    await waitFor(() => expect(FakeSocket.last).toBeDefined());
    push(turn());
    const card = await screen.findByRole('group', { name: 'Linear isn’t connected yet' });
    await userEvent.click(within(card).getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByRole('group', { name: /Linear/ })).toBeNull());
    expect(calls).toContainEqual(
      expect.objectContaining({
        method: 'POST',
        path: '/api/conversations/c1/suggestions/linear/dismiss',
      }),
    );
    await waitFor(
      () => expect(screen.getByRole('textbox', { name: 'Message Conch' })).toHaveFocus(),
      {
        timeout: 2000,
      },
    );

    // Replayed from the log: a dismissed offer shows nothing at all.
    const view = reduceAll([
      ...turn(),
      logged({ type: 'integration.suggestion.dismissed', catalogId: 'linear' }),
    ]);
    expect(view.items.find((i) => i.kind === 'integration-suggestion')).toMatchObject({
      dismissed: true,
      askedIn: 'u1',
    });
  });

  it('“Don’t suggest Linear” is remembered, and can be undone right there', async () => {
    const { calls, push } = open();
    await waitFor(() => expect(FakeSocket.last).toBeDefined());
    push(turn());
    const card = await screen.findByRole('group', { name: 'Linear isn’t connected yet' });
    await userEvent.click(within(card).getByRole('button', { name: 'Don’t suggest Linear' }));
    expect(await screen.findByText('Conch won’t suggest Linear again.')).toBeInTheDocument();
    expect(calls).toContainEqual(
      expect.objectContaining({
        method: 'PATCH',
        path: '/api/settings',
        body: { preferences: { mutedSuggestions: ['linear'] } },
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(
      await screen.findByRole('group', { name: 'Linear isn’t connected yet' }),
    ).toBeInTheDocument();
    expect(calls.at(-1)).toMatchObject({ body: { preferences: { mutedSuggestions: [] } } });
  });

  it('shows nothing for an app muted before', async () => {
    const { push } = open({ muted: ['linear'] });
    await waitFor(() => expect(FakeSocket.last).toBeDefined());
    push(turn());
    await screen.findByText('I can’t see it yet.');
    expect(screen.queryByRole('group', { name: /Linear/ })).toBeNull();
  });

  it('waits for the reply before offering', async () => {
    const { push } = open();
    await waitFor(() => expect(FakeSocket.last).toBeDefined());
    const events = turn();
    push(events.slice(0, 4));
    await waitFor(() => expect(useLiveStore.getState().views.c1?.status).toBe('running'));
    expect(screen.queryByRole('group', { name: /Linear/ })).toBeNull();
    push(events.slice(4));
    expect(
      await screen.findByRole('group', { name: 'Linear isn’t connected yet' }),
    ).toBeInTheDocument();
  });
});

describe('Settings → Models & modes', () => {
  it('lists the apps you muted, each with a way back', async () => {
    let muted = ['linear', 'google-calendar'];
    const calls = mockFetch({
      'GET /api/state': () =>
        appState({ preferences: { ...appState().preferences, mutedSuggestions: muted } }),
      'GET /api/integrations': () => ({ catalog: [linear], integrations: [], providers: [] }),
      'GET /api/models': () => ({
        default: 'claude-code',
        providers: [
          {
            engine: 'claude-code',
            label: 'Claude Code',
            models: [],
            commands: [],
            permissionModes: ['default'],
          },
        ],
      }),
      'PATCH /api/settings': (body) => {
        muted = (body as { preferences: { mutedSuggestions: string[] } }).preferences
          .mutedSuggestions;
        return appState({ preferences: { ...appState().preferences, mutedSuggestions: muted } });
      },
    });
    renderApp(<ModelsTab />);
    const list = await screen.findByRole('list', { name: 'Apps not suggested' });
    expect(within(list).getByText('Linear')).toBeInTheDocument();
    // An app only a provider's account reaches may not be in this catalog: still named.
    expect(within(list).getByText('Google Calendar')).toBeInTheDocument();
    await userEvent.click(within(list).getByRole('button', { name: 'Suggest Linear again' }));
    await waitFor(() =>
      expect(calls.at(-1)).toMatchObject({
        method: 'PATCH',
        body: { preferences: { mutedSuggestions: ['google-calendar'] } },
      }),
    );
    await waitFor(() => expect(within(list).queryByText('Linear')).toBeNull());
  });
});
