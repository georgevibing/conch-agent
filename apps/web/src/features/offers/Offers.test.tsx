import type {
  CatalogEntry,
  ConversationEvent,
  Integration,
  IntegrationsList,
  Offer,
  Skill,
} from '@conch/protocol';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { reduceAll } from '../../live/reducer';
import { useLiveStore } from '../../live/store';
import { appState, baseProviders, FakeSocket, mockFetch, renderApp } from '../../test/harness';
import { ChatView } from '../chat/ChatView';
import { ModelsTab } from '../settings/ModelsTab';

afterEach(() => {
  vi.unstubAllGlobals();
  // Conversations live in a shared store: start every test from an empty chat.
  useLiveStore.setState({ views: {}, pending: {} });
});

const QUESTION = 'what’s on my plate this week?';

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
  examples: ['What’s assigned to me this cycle?', 'File a bug for what we just found', 'A third'],
  access: ['Read issues, projects and comments'],
  featured: true,
};

const weekly: Skill = {
  id: 'weekly-review',
  name: 'weekly-review',
  title: 'Weekly review',
  description: 'Plans the week.',
  source: 'conch',
  sourceLabel: 'Conch',
  editable: true,
  mode: 'off',
  path: '/home/ada/.conch/skills/weekly-review',
  files: [],
  updatedAt: 1,
  permissions: {
    capabilities: ['files'],
    words: ['change files in your work folder'],
    declared: true,
    commands: [],
  },
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

const offer = (patch: Partial<Offer> = {}): Offer => ({
  offerId: 'of_1',
  kind: 'app',
  target: 'linear',
  name: 'Linear',
  description: linear.description,
  why: 'Your Linear issues would show what’s on your plate.',
  color: '#5E6AD2',
  by: 'assistant',
  resume: { request: QUESTION },
  ...patch,
});

let seq = 0;
const logged = <T extends { type: string }>(event: T) =>
  ({ conversationId: 'c1', seq: seq++, at: Date.now(), ...event }) as unknown as ConversationEvent;

/** A finished turn in which the assistant offered something. */
function turn(made: Offer | null = offer()): ConversationEvent[] {
  seq = 0;
  return [
    logged({ type: 'user.message', messageId: 'u1', text: QUESTION }),
    logged({ type: 'status', status: 'running' }),
    logged({
      type: 'assistant.delta',
      messageId: 'm1',
      kind: 'text',
      delta: 'I can’t see it yet.',
    }),
    ...(made ? [logged({ type: 'offer', offer: made })] : []),
    logged({ type: 'assistant.done', messageId: 'm1' }),
    logged({ type: 'turn.completed', outcome: 'success' }),
    logged({ type: 'status', status: 'idle' }),
  ];
}

/** The chat carried on: the quiet line, and the answer. */
function carriedOn(offerId = 'of_1'): ConversationEvent[] {
  return [
    logged({ type: 'offer.resolved', offerId, outcome: 'accepted' }),
    logged({ type: 'status', status: 'running' }),
    logged({ type: 'assistant.delta', messageId: 'm2', kind: 'text', delta: 'Three issues.' }),
    logged({ type: 'assistant.done', messageId: 'm2' }),
    logged({ type: 'turn.completed', outcome: 'success' }),
    logged({ type: 'status', status: 'idle' }),
  ];
}

function open(
  options: {
    muted?: string[];
    route?: string;
    integrations?: Integration[];
    skill?: Skill;
    extra?: Record<string, (body: unknown) => unknown>;
  } = {},
) {
  let list: IntegrationsList = {
    catalog: [linear],
    integrations: options.integrations ?? [],
    providers: [],
  };
  let muted = options.muted ?? [];
  const calls = mockFetch({
    'GET /api/state': () =>
      appState({ preferences: { ...appState().preferences, mutedSuggestions: muted } }),
    'GET /api/conversations': () => [],
    'GET /api/integrations': () => list,
    'GET /api/skills': () => ({ skills: [options.skill ?? weekly], sources: [] }),
    'POST /api/integrations': () => {
      const integration = connected({
        state: 'connecting',
        message: 'Waiting for you to sign in.',
      });
      list = { ...list, integrations: [integration] };
      return { integration, authorizeUrl: 'https://linear.example/authorize?x=1' };
    },
    'POST /api/conversations/c1/offers/of_1/accept': () => ({ ok: true, state: 'started' }),
    'POST /api/conversations/c1/offers/of_1/dismiss': () => ({ ok: true }),
    'POST /api/conversations/c1/suggestions/linear/dismiss': () => ({ ok: true }),
    'PATCH /api/settings': (body) => {
      muted = (body as { preferences: { mutedSuggestions: string[] } }).preferences
        .mutedSuggestions;
      return appState({ preferences: { ...appState().preferences, mutedSuggestions: muted } });
    },
    ...options.extra,
  });
  const popup = { closed: false, location: { href: '' }, focus: vi.fn(), close: vi.fn() };
  vi.stubGlobal(
    'open',
    vi.fn(() => popup),
  );
  const view = renderApp(<ChatView conversationId="c1" />, { route: options.route ?? '/c/c1' });
  const push = (events: ConversationEvent[]) =>
    act(() => {
      for (const event of events) FakeSocket.last?.push({ type: 'conversation.event', event });
    });
  return { ...view, calls, popup, push };
}

const accepted = (calls: { method: string; path: string }[]) =>
  calls.filter((c) => c.method === 'POST' && c.path === '/api/conversations/c1/offers/of_1/accept');

describe('offers in the chat (ADR 0060)', () => {
  it('offers Linear under the reply, connects in place, and the chat carries on by itself', async () => {
    const { calls, popup, push } = open();
    await waitFor(() => expect(FakeSocket.last).toBeDefined());
    push(turn());

    const card = await screen.findByRole('group', { name: 'Linear isn’t connected yet' });
    expect(card).toHaveTextContent('Your Linear issues would show what’s on your plate.');
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
    expect(accepted(calls)).toHaveLength(0);

    // The sign-in finishes in the popup; the gateway says so over the live connection.
    act(() =>
      FakeSocket.last?.push({
        type: 'integration.changed',
        integration: connected({ state: 'ok', checkedAt: 2, okAt: 2 }),
      }),
    );
    // Nobody presses anything more: the offer is taken once.
    await waitFor(() => expect(accepted(calls)).toHaveLength(1));
    expect(accepted(calls)[0]).toMatchObject({ body: {} });
    push(carriedOn());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const line = await screen.findByText(
      (_, el) =>
        el?.getAttribute('role') === 'status' && el.textContent === 'Connected Linear·carrying on',
    );
    const answer = screen.getByText('Three issues.');
    // The quiet line, then the answer it carried on with; no new message of yours.
    expect(line.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByText(QUESTION)).toHaveLength(1);
    expect(accepted(calls)).toHaveLength(1);

    // What else it can do, sent exactly as it reads.
    const also = await screen.findByRole('group', { name: 'Also try' });
    expect(within(also).getAllByRole('button')).toHaveLength(2);
    await userEvent.click(
      within(also).getByRole('button', { name: 'What’s assigned to me this cycle?' }),
    );
    await waitFor(() =>
      expect(FakeSocket.last?.sent).toContainEqual(
        expect.objectContaining({
          type: 'conversation.send',
          conversationId: 'c1',
          text: 'What’s assigned to me this cycle?',
        }),
      ),
    );
  });

  it('connects an image provider in place and resumes once without changing the chat model', async () => {
    const { calls, push } = open({
      extra: {
        'GET /api/providers': () => baseProviders,
        'PUT /api/providers/openrouter/key': () => ({
          ...baseProviders,
          providers: baseProviders.providers.map((p) =>
            p.id === 'openrouter'
              ? {
                  ...p,
                  ready: true,
                  status: { ...p.status, state: 'ready' },
                  key: { source: 'conch', hint: '…test', savedAt: 2 },
                }
              : p,
          ),
        }),
      },
    });
    await waitFor(() => expect(FakeSocket.last).toBeDefined());
    push(
      turn(
        offer({
          kind: 'provider',
          target: 'openrouter',
          name: 'OpenRouter',
          description: 'Make and edit pictures.',
          why: 'Create your picture.',
        }),
      ),
    );
    const card = await screen.findByRole('group', { name: 'OpenRouter isn’t connected yet' });
    await userEvent.click(within(card).getByRole('button', { name: 'Connect OpenRouter' }));
    const dialog = await screen.findByRole('dialog', { name: 'Connect OpenRouter' });
    await userEvent.click(within(dialog).getByLabelText('OpenRouter key'));
    await userEvent.paste('sk-or-v1-fixture-not-a-real-key');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(accepted(calls)).toHaveLength(1), { timeout: 5000 });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls.some((c) => c.path.endsWith('/use'))).toBe(false);
    push(carriedOn());
    await screen.findByText('Three issues.');
    expect(accepted(calls)).toHaveLength(1);
  });

  it('does not resume an image request when connection is cancelled', async () => {
    const { calls, push } = open({ extra: { 'GET /api/providers': () => baseProviders } });
    await waitFor(() => expect(FakeSocket.last).toBeDefined());
    push(turn(offer({ kind: 'provider', target: 'openrouter', name: 'OpenRouter' })));
    await userEvent.click(await screen.findByRole('button', { name: 'Connect OpenRouter' }));
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(accepted(calls)).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Connect OpenRouter' })).toBeEnabled();
  });

  it('back from signing in on a phone, the chat takes the offer by itself', async () => {
    const { calls, push, where } = open({
      route: '/c/c1?offer=of_1&result=connected',
      integrations: [connected({ state: 'ok', checkedAt: 2, okAt: 2 })],
    });
    await waitFor(() => expect(FakeSocket.last).toBeDefined());
    push(turn());
    await waitFor(() => expect(accepted(calls)).toHaveLength(1));
    // The address is tidied.
    await waitFor(() => expect(where()).toBe('/c/c1'));
  });

  it('a Conch app you switched off turns on right here, and the chat carries on (ADR 0061)', async () => {
    const tally = (enabled: boolean): Integration => ({
      id: 'capp_tally',
      conchApp: 'tally',
      name: 'Tally',
      server: 'app_tally',
      transport: { type: 'host', how: 'Runs sealed off on this computer' },
      auth: 'none',
      enabled,
      policy: 'ask-writes',
      health: enabled ? { state: 'ok', checkedAt: 2 } : { state: 'off', action: 'turn-on' },
      tools: [],
      values: {},
      secrets: [],
      createdAt: 1,
      updatedAt: 1,
    });
    const { calls, push } = open({
      integrations: [tally(false)],
      extra: {
        'PATCH /api/integrations/capp_tally': () => tally(true),
        'GET /api/conch-apps': () => ({
          apps: [
            {
              id: 'tally',
              integrationId: 'capp_tally',
              manifest: {
                conch: 1,
                id: 'tally',
                name: 'Tally',
                tagline: 'Counts things',
                description: '',
                version: '1.0.0',
                icon: { glyph: 'calculator', color: 'teal' },
                kind: 'personal',
                pages: [],
                reaches: [],
                settings: [],
                instructions: '',
                examples: [],
              },
              tools: [],
              source: { kind: 'made' },
              signature: { state: 'unsigned' },
              hash: 'h',
              addedAt: 1,
              updatedAt: 1,
            },
          ],
        }),
      },
    });
    await waitFor(() => expect(FakeSocket.last).toBeDefined());
    push(
      turn(
        offer({
          target: 'capp_tally',
          name: 'Tally',
          description: 'Count things for you.',
          why: undefined,
          color: undefined,
        }),
      ),
    );
    const card = await screen.findByRole('group', { name: 'Tally is off' });
    expect(within(card).queryByRole('button', { name: /Connect/ })).toBeNull();
    await userEvent.click(within(card).getByRole('button', { name: 'Turn on Tally' }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          method: 'PATCH',
          path: '/api/integrations/capp_tally',
          body: { enabled: true },
        }),
      ),
    );
    // No catalog dialog: it's on, so the chat carries on, once.
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(accepted(calls)).toHaveLength(1));
  });

  it('connected elsewhere, it waits for one press to carry on', async () => {
    const { calls, push } = open({
      integrations: [connected({ state: 'ok', checkedAt: 2, okAt: 2 })],
    });
    await waitFor(() => expect(FakeSocket.last).toBeDefined());
    push(turn());
    const card = await screen.findByRole('group', { name: 'Linear is connected' });
    expect(accepted(calls)).toHaveLength(0);
    await userEvent.click(within(card).getByRole('button', { name: 'Carry on' }));
    await waitFor(() => expect(accepted(calls)).toHaveLength(1));
  });

  it('a skill shows what it may do, then turns on and carries on', async () => {
    const { calls, push } = open();
    await waitFor(() => expect(FakeSocket.last).toBeDefined());
    push(
      turn(
        offer({
          kind: 'skill',
          target: 'weekly-review',
          name: 'Weekly review',
          description: 'Plans the week.',
          why: 'Your Weekly review skill plans a week the way you like it.',
          skillMode: 'off',
          color: undefined,
        }),
      ),
    );
    const card = await screen.findByRole('group', { name: 'The “Weekly review” skill is off' });
    await userEvent.click(within(card).getByRole('button', { name: 'Turn on Weekly review' }));
    expect(await screen.findByText('change files in your work folder')).toBeVisible();
    expect(accepted(calls)).toHaveLength(0);
    await userEvent.click(within(card).getByRole('button', { name: 'Turn on Weekly review' }));
    await waitFor(() =>
      expect(accepted(calls)).toEqual([expect.objectContaining({ body: { skill: 'on' } })]),
    );
  });

  it('a skill people share is read in a dialog, added in one press, and the chat carries on (ADR 0074)', async () => {
    const listing = {
      id: 'clawhub:ada/meeting-notes',
      source: 'clawhub',
      sourceLabel: 'ClawHub',
      name: 'meeting-notes',
      title: 'Meeting notes',
      description: 'Turns notes into decisions.',
      publisher: { name: 'Ada' },
      trust: 'verified',
      url: 'https://clawhub.ai/ada/skills/meeting-notes',
    };
    const { calls, push } = open({
      extra: {
        'GET /api/skills/market/listing': () => listing,
        'POST /api/skills/market/preview': () => ({
          previewId: 'mp_abcdefghijkl',
          listing,
          pin: { kind: 'version', version: '1.0.0', sha256: 'a'.repeat(64) },
          review: { verdict: 'clean', findings: [], hash: 'h', checkedAt: 1 },
          permissions: { declared: true, capabilities: [], words: [] },
          instructions: 'Read the notes.',
          files: [],
          license: { kind: 'open', name: 'MIT-0' },
        }),
        'POST /api/skills/market/install': () => ({
          ...weekly,
          id: 'market-clawhub_meeting-notes',
          name: 'meeting-notes',
          title: 'Meeting notes',
          source: 'market',
          sourceLabel: 'ClawHub',
          editable: false,
          mode: 'auto',
          instructions: 'Read the notes.',
        }),
      },
    });
    await waitFor(() => expect(FakeSocket.last).toBeDefined());
    push(
      turn(
        offer({
          kind: 'market',
          target: listing.id,
          name: 'Meeting notes',
          description: 'Turns notes into decisions.',
          why: 'It turns notes like these into actions.',
          color: undefined,
          market: { sourceLabel: 'ClawHub', publisher: 'Ada', trust: 'verified', installs: 120 },
        }),
      ),
    );
    const card = await screen.findByRole('group', { name: 'A skill for this: “Meeting notes”' });
    expect(within(card).getByText(/ClawHub · Ada · 120 people use it/)).toBeInTheDocument();
    await userEvent.click(within(card).getByRole('button', { name: 'Look at it Meeting notes' }));
    const dialog = await screen.findByRole('dialog', { name: 'Read it before you add it' });
    expect(await within(dialog).findByText(/Pinned to version 1.0.0/)).toBeInTheDocument();
    expect(accepted(calls)).toHaveLength(0);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add and carry on' }));
    await waitFor(() => expect(accepted(calls)).toHaveLength(1));
    expect(calls.find((c) => c.path === '/api/skills/market/install')?.body).toEqual({
      previewId: 'mp_abcdefghijkl',
      mode: 'auto',
    });
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
        path: '/api/conversations/c1/offers/of_1/dismiss',
      }),
    );
    await waitFor(
      () => expect(screen.getByRole('textbox', { name: 'Message Conch' })).toHaveFocus(),
      { timeout: 2000 },
    );

    // Replayed from the log.
    const view = reduceAll([
      ...turn(),
      logged({ type: 'offer.resolved', offerId: 'of_1', outcome: 'dismissed' }),
    ]);
    expect(view.items.find((i) => i.kind === 'offer')).toMatchObject({
      resolution: 'dismissed',
      askedIn: 'u1',
    });
  });

  it('“Don’t suggest Linear” is remembered, and can be undone right there', async () => {
    const { calls, push } = open();
    await waitFor(() => expect(FakeSocket.last).toBeDefined());
    push(turn());
    const card = await screen.findByRole('group', { name: 'Linear isn’t connected yet' });
    await userEvent.click(within(card.parentElement ?? card).getByRole('button', { name: 'More' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Don’t suggest Linear' }));
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
    expect(calls.filter((c) => c.method === 'PATCH').at(-1)).toMatchObject({
      body: { preferences: { mutedSuggestions: [] } },
    });
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

  it('a newer message overtakes it: a small line, nothing to press', async () => {
    const { push } = open();
    await waitFor(() => expect(FakeSocket.last).toBeDefined());
    push([
      ...turn(),
      logged({ type: 'offer.resolved', offerId: 'of_1', outcome: 'expired' }),
      logged({ type: 'user.message', messageId: 'u2', text: 'never mind' }),
    ]);
    expect(
      await screen.findByText(
        (_, el) =>
          el?.getAttribute('role') === 'note' && el.textContent === 'Offered to connect Linear',
      ),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: /Linear/ })).toBeNull();
  });

  it('draws offers from older logs with the same card, put away the old way', async () => {
    const { calls, push } = open();
    await waitFor(() => expect(FakeSocket.last).toBeDefined());
    seq = 0;
    push([
      logged({ type: 'user.message', messageId: 'u1', text: QUESTION }),
      logged({
        type: 'integration.suggestion',
        catalogId: 'linear',
        name: 'Linear',
        description: linear.description,
        color: '#5E6AD2',
      }),
      logged({ type: 'assistant.delta', messageId: 'm1', kind: 'text', delta: 'I can’t see it.' }),
      logged({ type: 'turn.completed', outcome: 'success' }),
      logged({ type: 'status', status: 'idle' }),
    ]);
    const card = await screen.findByRole('group', { name: 'Linear isn’t connected yet' });
    expect(card).toHaveTextContent('Connect it and Conch can find, create and update issues');
    await userEvent.click(within(card).getByRole('button', { name: 'Not now' }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({ path: '/api/conversations/c1/suggestions/linear/dismiss' }),
      ),
    );
    const view = reduceAll([
      logged({ type: 'user.message', messageId: 'u1', text: QUESTION }),
      logged({
        type: 'integration.suggestion',
        catalogId: 'linear',
        name: 'Linear',
        description: 'x',
      }),
      logged({ type: 'integration.suggestion.dismissed', catalogId: 'linear' }),
    ]);
    expect(view.items.find((i) => i.kind === 'offer')).toMatchObject({
      id: 'legacy-linear',
      legacy: true,
      resolution: 'dismissed',
      offer: { kind: 'app', target: 'linear', by: 'cue' },
    });
  });

  it('a taken offer moves to where the chat carried on, and starts a turn there', () => {
    const view = reduceAll([...turn(), ...carriedOn()]);
    const kinds = view.items.map((i) => i.kind);
    expect(kinds.indexOf('offer')).toBeGreaterThan(kinds.indexOf('turn-end'));
    const answer = view.items.findLast((i) => i.kind === 'assistant');
    // A turn of its own: the answer has its own header.
    expect(answer).toMatchObject({ text: 'Three issues.', continuation: false });
  });
});

describe('Settings → Models', () => {
  it('lists the apps and skills you muted, each with a way back', async () => {
    let muted = ['linear', 'google-calendar', 'skill:weekly-review'];
    const calls = mockFetch({
      'GET /api/state': () =>
        appState({ preferences: { ...appState().preferences, mutedSuggestions: muted } }),
      'GET /api/integrations': () => ({ catalog: [linear], integrations: [], providers: [] }),
      'GET /api/skills': () => ({ skills: [weekly], sources: [] }),
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
    const list = await screen.findByRole('list', { name: 'Not suggested' });
    expect(within(list).getByText('Linear')).toBeInTheDocument();
    // An app only a provider's account reaches may not be in this catalog: still named.
    expect(within(list).getByText('Google Calendar')).toBeInTheDocument();
    expect(await within(list).findByText('Weekly review')).toBeInTheDocument();
    await userEvent.click(within(list).getByRole('button', { name: 'Suggest Linear again' }));
    await waitFor(() =>
      expect(calls.at(-1)).toMatchObject({
        method: 'PATCH',
        body: { preferences: { mutedSuggestions: ['google-calendar', 'skill:weekly-review'] } },
      }),
    );
    await waitFor(() => expect(within(list).queryByText('Linear')).toBeNull());
  });
});
