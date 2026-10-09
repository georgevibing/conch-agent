import { Toaster } from '@conch/nacre';
import type { ModelCatalog, UsageSnapshot } from '@conch/protocol';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUpdateSettings } from '../../api/queries';
import { useUi } from '../../app/ui';
import { ChatProvider } from '../engine/ChatProvider';
import { useTurnOptions } from '../models/useTurnOptions';
import { useLive } from '../../live/LiveProvider';
import { useLiveStore } from '../../live/store';
import {
  appState,
  baseProviders,
  FakeSocket,
  mockFetch,
  provider,
  providersList,
  renderApp,
} from '../../test/harness';
import { UsageComposerNotice } from './UsageComposerNotice';

afterEach(() => {
  vi.unstubAllGlobals();
  useUi.setState({ usageOpen: false, draftOptions: {} });
  useLiveStore.setState({ pending: {}, startedWith: undefined });
});

const HOUR = 3_600_000;

function plan(sessionUsed: number, engine = 'claude-code', source = 'Claude Max'): UsageSnapshot {
  const now = Date.now();
  return {
    engine,
    kind: 'plan',
    source,
    windows: [
      {
        id: 'session',
        label: 'Current session',
        usedPercent: sessionUsed,
        resetsAt: now + 2 * HOUR,
        severity: sessionUsed >= 90 ? 'critical' : sessionUsed >= 75 ? 'warning' : 'normal',
      },
      {
        id: 'weekly',
        label: 'This week',
        scope: 'all models',
        usedPercent: 20,
        resetsAt: now + 72 * HOUR,
        severity: 'normal',
      },
    ],
    spend: { today: 0, month: 0 },
    updatedAt: now,
  };
}

/** Claude Code, ready and the default. */
const claude = provider();

const codexReady = provider({
  id: 'codex-cli',
  name: 'Codex',
  active: false,
  status: {
    engine: 'codex-cli',
    label: 'Codex',
    state: 'ready',
    auth: { method: 'subscription', description: 'ChatGPT Plus', email: 'you@example.com' },
    install: [],
    canSignIn: true,
    checkedAt: 1,
  },
});

const catalog: ModelCatalog = {
  default: 'claude-code',
  providers: [
    {
      engine: 'claude-code',
      label: 'Claude Code',
      local: false,
      models: [
        {
          id: 'sonnet',
          label: 'Sonnet',
          description: '',
          efforts: [],
          supportsFastMode: false,
          supportsAutoMode: false,
        },
      ],
      commands: [],
      permissionModes: ['default'],
    },
    {
      engine: 'codex-cli',
      label: 'Codex',
      local: false,
      models: [
        {
          id: 'gpt-6.1-sol',
          label: 'GPT-6.1-Sol',
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
};

/** The new-chat header and composer notice, with a way to pick a model like the picker does. */
function NewChat() {
  const turn = useTurnOptions();
  const live = useLive();
  return (
    <>
      <ChatProvider />
      <UsageComposerNotice engine={turn.options.engine} />
      <button type="button" onClick={() => turn.choose('codex-cli|gpt-6.1-sol')}>
        Pick GPT
      </button>
      <button type="button" onClick={() => live.send('Hello', undefined, turn.takeDraft())}>
        Send
      </button>
    </>
  );
}

function routes(extra: Record<string, (body: unknown) => unknown> = {}) {
  return mockFetch({
    'GET /api/state': () => appState(),
    'GET /api/conversations': () => [],
    'GET /api/models': () => catalog,
    'GET /api/providers': () => providersList({ providers: [claude, codexReady] }),
    ...extra,
  });
}

describe('the chat’s provider in the header', () => {
  it('names who answers and what’s left of their limit, live, and warns above the composer', async () => {
    const calls = routes({ 'GET /api/usage': () => plan(38) });
    renderApp(<NewChat />);
    const meter = await screen.findByRole('button', { name: /^Claude Code\. Usage/ });
    await waitFor(() => expect(meter).toHaveTextContent('Claude Code62% left'));
    expect(calls.some((c) => c.path.includes('/api/usage?engine=claude-code'))).toBe(true);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    act(() => FakeSocket.last?.push({ type: 'usage.changed', usage: plan(88) }));
    await waitFor(() => expect(meter).toHaveTextContent('12% left'));
    expect(await screen.findByRole('status')).toHaveTextContent(/12% of your current session left/);
  });

  it('puts the line away for that limit until it resets, saved for every device', async () => {
    const calls = routes({
      'GET /api/usage': () => plan(88),
      'PATCH /api/settings': (body) =>
        appState({
          preferences: {
            ...appState().preferences,
            ...(body as { preferences: object }).preferences,
          },
        }),
    });
    renderApp(<NewChat />);
    expect(await screen.findByRole('status')).toHaveTextContent(/12% of your current session/);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    const saved = calls.find((c) => c.method === 'PATCH' && c.path === '/api/settings');
    expect(saved?.body).toEqual({
      preferences: {
        limitsPutAway: [{ engine: 'claude-code', window: 'session', resetsAt: expect.any(Number) }],
      },
    });
    // Closer still, and then used up: it stays away this cycle.
    act(() => FakeSocket.last?.push({ type: 'usage.changed', usage: plan(97) }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('stays away after a reload, and comes back in the next cycle', async () => {
    const usage = plan(88);
    const session = usage.windows[0];
    if (!session) throw new Error('no session');
    const put = { engine: 'claude-code', window: 'session', resetsAt: session.resetsAt };
    const calls = routes({
      'GET /api/state': () =>
        appState({ preferences: { ...appState().preferences, limitsPutAway: [put] } }),
      'GET /api/usage': () => usage,
      'PATCH /api/settings': () => appState(),
    });
    renderApp(<NewChat />);
    await screen.findByRole('button', { name: /^Claude Code\. Usage/ });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Claude Code\. Usage/ })).toHaveTextContent(
        '12% left',
      ),
    );
    expect(screen.queryByRole('status')).toBeNull();
    // The session reset (healthy again): the entry is let go, so the next one can speak.
    act(() => FakeSocket.last?.push({ type: 'usage.changed', usage: plan(5) }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === 'PATCH' &&
            JSON.stringify(c.body) === JSON.stringify({ preferences: { limitsPutAway: [] } }),
        ),
      ).toBe(true),
    );
    const next = plan(80);
    act(() =>
      FakeSocket.last?.push({
        type: 'usage.changed',
        usage: {
          ...next,
          windows: next.windows.map((w) =>
            w.id === 'session' ? { ...w, resetsAt: (session.resetsAt ?? 0) + 5 * HOUR } : w,
          ),
        },
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(/20% of your current session/);
  });

  it('follows the model chosen for the chat to the other provider’s limits', async () => {
    const calls = routes({
      'GET /api/usage': () => plan(38),
    });
    renderApp(<NewChat />);
    await screen.findByRole('button', { name: /^Claude Code\. Usage/ });
    // Another provider's limits move meanwhile: they don't touch this chat's chip.
    act(() =>
      FakeSocket.last?.push({
        type: 'usage.changed',
        usage: plan(91, 'codex-cli', 'ChatGPT Plus'),
      }),
    );
    expect(screen.getByRole('button', { name: /^Claude Code\. Usage/ })).toHaveTextContent(
      '62% left',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Pick GPT' }));
    const codex = await screen.findByRole('button', { name: /^Codex\. Usage/ });
    expect(codex).toHaveTextContent('Codex9% left');
    // The notice above the composer is about Codex now.
    expect(await screen.findByRole('status')).toHaveTextContent(/9% of your current session left/);
    expect(calls.some((c) => c.path.includes('engine=codex-cli'))).toBe(false);
  });

  it('stays on the chosen provider while a new chat is being made, never flashing the default’s limits', async () => {
    routes({
      'GET /api/usage': () => plan(82, 'claude-code', 'Claude Max'),
    });
    renderApp(<NewChat />);
    // The default provider is low: its notice shows on a new chat.
    expect(await screen.findByRole('status')).toHaveTextContent(/18% of your current session left/);
    act(() =>
      FakeSocket.last?.push({
        type: 'usage.changed',
        usage: plan(10, 'codex-cli', 'ChatGPT Plus'),
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Pick GPT' }));
    expect(await screen.findByRole('button', { name: /^Codex\. Usage/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    // Sent: the draft is gone, but the chat hasn't got its id yet.
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByRole('button', { name: /^Codex\. Usage/ })).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('opens who you’re signed in as and the full limits, from the chip and from /usage', async () => {
    routes({ 'GET /api/usage': () => plan(38) });
    renderApp(<NewChat />);
    await userEvent.click(await screen.findByRole('button', { name: /^Claude Code\. Usage/ }));
    const panel = await screen.findByRole('dialog', { name: 'Claude Code for this chat' });
    expect(panel).toHaveTextContent('Claude Max · you@example.com');
    expect(panel).toHaveTextContent(/This week/);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    act(() => useUi.getState().setUsageOpen(true));
    expect(await screen.findByRole('dialog', { name: 'Claude Code for this chat' })).toBeVisible();
  });

  it('lets another provider be where new chats start', async () => {
    const calls = routes({
      'GET /api/usage': () => plan(38, 'codex-cli', 'ChatGPT Plus'),
      'POST /api/providers/codex-cli/use': () =>
        providersList({
          active: 'codex-cli',
          providers: [
            { ...claude, active: false },
            { ...codexReady, active: true },
          ],
        }),
    });
    renderApp(<NewChat />);
    await userEvent.click(await screen.findByRole('button', { name: 'Pick GPT' }));
    await userEvent.click(await screen.findByRole('button', { name: /^Codex\. Usage/ }));
    const panel = await screen.findByRole('dialog', { name: 'Codex for this chat' });
    expect(panel).toHaveTextContent('New chats start with Claude Code.');
    await userEvent.click(screen.getByRole('button', { name: 'Use Codex' }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === 'POST' && c.path === '/api/providers/codex-cli/use'),
      ).toBe(true),
    );
  });

  it('asks for a sign-in only when the chat’s provider needs one', async () => {
    const calls = routes({
      'GET /api/providers': () =>
        providersList({
          providers: [
            claude,
            { ...codexReady, ready: false, status: { ...codexReady.status, state: 'signed-out' } },
          ],
        }),
      'GET /api/usage': () => plan(38),
    });
    renderApp(<NewChat />);
    await userEvent.click(await screen.findByRole('button', { name: 'Pick GPT' }));
    const chip = await screen.findByRole('button', { name: 'Codex: Sign in' });
    expect(chip).toHaveAttribute('data-severity', 'warning');
    expect(calls.some((c) => c.path.includes('engine=codex-cli'))).toBe(false);
  });

  it('offers to connect a provider when none is', async () => {
    routes({
      'GET /api/providers': () =>
        providersList({
          providers: baseProviders.providers.map((p) => ({ ...p, ready: false })),
        }),
    });
    const openSettings = vi.fn();
    const before = useUi.getState().openSettings;
    useUi.setState({ openSettings });
    renderApp(<ChatProvider />);
    await userEvent.click(await screen.findByRole('button', { name: 'Connect a provider' }));
    expect(openSettings).toHaveBeenCalledWith('providers');
    useUi.setState({ openSettings: before });
  });
});

/** The new chat, with the mode picked for it and made the default, as the composer chip does. */
function NewChatWithModes() {
  const turn = useTurnOptions();
  const save = useUpdateSettings();
  return (
    <>
      <UsageComposerNotice engine={turn.options.engine} />
      <button
        type="button"
        onClick={() => {
          turn.set({ permissionMode: 'bypassPermissions' });
          save.mutate({ preferences: { permissionMode: 'bypassPermissions' } });
        }}
      >
        Full trust
      </button>
    </>
  );
}

/** A gateway that keeps your settings as the real one does: each save merged in, in turn. */
function savedSettings() {
  let preferences = appState().preferences;
  return {
    state: () => appState({ preferences }),
    save: (body: unknown) => {
      preferences = { ...preferences, ...(body as { preferences: object }).preferences };
      return appState({ preferences });
    },
  };
}

const savesMode = (body: unknown) =>
  'permissionMode' in (body as { preferences: object }).preferences;

describe('the line put away, whatever else changes', () => {
  it('stays away when the mode changes to Full trust', async () => {
    const gateway = savedSettings();
    const calls = routes({
      'GET /api/state': gateway.state,
      'GET /api/usage': () => plan(97),
      'PATCH /api/settings': gateway.save,
    });
    renderApp(<NewChatWithModes />);
    expect(await screen.findByRole('status')).toHaveTextContent(/3% of your current session/);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    await userEvent.click(screen.getByRole('button', { name: 'Full trust' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(2));
    act(() => FakeSocket.last?.push({ type: 'usage.changed', usage: plan(97) }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('isn’t brought back by a settings answer that lands late, from before the ×', async () => {
    const gateway = savedSettings();
    let answerMode: () => void = () => undefined;
    routes({
      'GET /api/state': gateway.state,
      'GET /api/usage': () => plan(97),
      'PATCH /api/settings': (body) => {
        // The mode is saved first, but its answer (without the ×) arrives last.
        const answer = gateway.save(body);
        if (!savesMode(body)) return answer;
        return new Promise((resolve) => (answerMode = () => resolve(answer)));
      },
    });
    renderApp(<NewChatWithModes />);
    expect(await screen.findByRole('status')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Full trust' }));
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    await act(async () => answerMode());
    await act(async () => undefined);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('isn’t brought back by another save answered while the × is on its way', async () => {
    const gateway = savedSettings();
    let answerPut: () => void = () => undefined;
    let modeAnswered = false;
    routes({
      'GET /api/state': gateway.state,
      'GET /api/usage': () => plan(97),
      'PATCH /api/settings': (body) => {
        if (savesMode(body)) {
          modeAnswered = true;
          // Answered from the settings as they were: the × hasn't reached the gateway yet.
          return appState({
            preferences: { ...appState().preferences, permissionMode: 'bypassPermissions' },
          });
        }
        return new Promise((resolve) => (answerPut = () => resolve(gateway.save(body))));
      },
    });
    renderApp(<NewChatWithModes />);
    expect(await screen.findByRole('status')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await userEvent.click(screen.getByRole('button', { name: 'Full trust' }));
    await waitFor(() => expect(modeAnswered).toBe(true));
    await act(async () => undefined);
    expect(screen.queryByRole('status')).toBeNull();
    await act(async () => answerPut());
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('comes back, and says so, when the × didn’t save', async () => {
    routes({
      'GET /api/usage': () => plan(97),
      'PATCH /api/settings': () =>
        new Response(JSON.stringify({ error: 'oops', message: 'No' }), { status: 500 }),
    });
    renderApp(
      <>
        <NewChatWithModes />
        <Toaster />
      </>,
    );
    expect(await screen.findByText(/3% of your current session/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(await screen.findByText('That didn’t save. Try again.')).toBeInTheDocument();
    expect(screen.getByText(/3% of your current session/)).toBeInTheDocument();
  });
});

describe('a limit at its reset', () => {
  function resetting(at: number): UsageSnapshot {
    const usage = plan(97);
    return {
      ...usage,
      windows: usage.windows.map((w) => (w.id === 'session' ? { ...w, resetsAt: at } : w)),
    };
  }

  it('says “in under a minute” just before, and the × holds through the reset', async () => {
    const calls = routes({
      'GET /api/usage': () => resetting(Date.now() + 20_000),
      'PATCH /api/settings': (body) =>
        appState({
          preferences: {
            ...appState().preferences,
            ...(body as { preferences: object }).preferences,
          },
        }),
    });
    renderApp(<NewChatWithModes />);
    expect(await screen.findByRole('status')).toHaveTextContent(/resets in under a minute/);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    const saved = calls.find((c) => c.method === 'PATCH')?.body as {
      preferences: { limitsPutAway: { resetsAt: number }[] };
    };
    expect(saved.preferences.limitsPutAway[0]?.resetsAt).toBeGreaterThan(Date.now() + 60_000);
  });

  it('never says “resets now”: a reading from before the reset waits for fresh numbers', async () => {
    let read = 0;
    const calls = routes({
      // The gateway's cached reading is from before the reset; asked afresh, it's a new cycle.
      'GET /api/usage': () => (read++ === 0 ? resetting(Date.now() - 60_000) : plan(5)),
      'PATCH /api/settings': () => appState(),
    });
    renderApp(<NewChatWithModes />);
    await waitFor(() =>
      expect(calls.filter((c) => c.path.startsWith('/api/usage'))).toHaveLength(2),
    );
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText(/resets now/)).toBeNull();
  });
});
