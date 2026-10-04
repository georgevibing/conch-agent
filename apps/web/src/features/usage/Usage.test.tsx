import type { ModelCatalog, UsageSnapshot } from '@conch/protocol';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUi } from '../../app/ui';
import { ChatProvider } from '../engine/ChatProvider';
import { useTurnOptions } from '../models/useTurnOptions';
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
  return (
    <>
      <ChatProvider />
      <UsageComposerNotice engine={turn.options.engine} />
      <button type="button" onClick={() => turn.choose('codex-cli|gpt-6.1-sol')}>
        Pick GPT
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
