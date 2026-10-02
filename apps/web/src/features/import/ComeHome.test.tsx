import type { ImportPlan, ImportResult, ImportStatus } from '@conch/protocol';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUi } from '../../app/ui';
import { mockFetch, renderApp } from '../../test/harness';
import { useImportProgress } from './api';
import { ComeHomeSection } from './ComeHomeSection';

const auth = { method: 'none', signedIn: true, setupRequired: false, secure: true };

const source = {
  id: 'openclaw' as const,
  label: 'OpenClaw',
  path: '/Users/ada/.openclaw',
  summary: '2 memories, 2 skills, 1 routine, 1 chat app, your profile',
};

const status = (patch: Partial<ImportStatus> = {}): ImportStatus => ({
  sources: [source],
  ...patch,
});

const plan: ImportPlan = {
  source,
  problems: ['Its scheduled jobs couldn’t all be read; the rest still come.'],
  items: [
    {
      id: 'persona:name',
      group: 'persona',
      title: 'Call your assistant “Pearl”',
      checked: true,
    },
    {
      id: 'memory:0',
      group: 'memories',
      title: 'Ada takes her tea with lemon.',
      detail: 'From MEMORY.md',
      checked: true,
    },
    {
      id: 'memory:1',
      group: 'memories',
      title: 'The build runs on Fridays.',
      detail: 'From MEMORY.md',
      checked: false,
      duplicate: true,
    },
    {
      id: 'skill:solana-helper',
      group: 'skills',
      title: 'solana helper',
      checked: false,
      warning: 'Conch found something worrying in it.',
      review: {
        verdict: 'danger',
        findings: [
          {
            kind: 'download-run',
            severity: 'danger',
            message: 'Downloads something and runs it.',
            file: 'SKILL.md',
            line: 9,
          },
        ],
      },
    },
    {
      id: 'routine:0',
      group: 'routines',
      title: 'Morning briefing',
      detail: 'Comes over as a draft.',
      preview: 'Summarise my calendar and the weather.',
      checked: true,
    },
    {
      id: 'channel:telegram',
      group: 'channels',
      title: 'Your Telegram bot',
      checked: false,
      warning: 'Stop OpenClaw first, or both will try to answer.',
    },
  ],
};

const result: ImportResult = {
  source: 'openclaw',
  counts: {
    persona: 1,
    model: 0,
    about: 0,
    memories: 1,
    skills: 0,
    routines: 1,
    channels: 1,
    keys: 0,
  },
  outcomes: [
    { id: 'persona:name', group: 'persona', title: 'Name: Pearl', ok: true },
    { id: 'memory:0', group: 'memories', title: 'Ada takes her tea', ok: true },
    { id: 'routine:0', group: 'routines', title: 'Morning briefing', ok: true },
    {
      id: 'channel:telegram',
      group: 'channels',
      title: 'Telegram bot',
      ok: true,
      message: 'Say hello to @pearl_bot in Telegram to finish: nobody else gets in.',
    },
  ],
  backupId: 'auto-1',
  undoable: true,
};

afterEach(() => {
  vi.unstubAllGlobals();
  useUi.setState({ settings: null, settingsFocus: undefined });
  useImportProgress.setState({ done: 0, total: 0, current: undefined });
});

describe('Come home', () => {
  it('shows nothing when there’s no other assistant here', async () => {
    const calls = mockFetch({
      'GET /api/import': () => ({ sources: [] }),
      'GET /api/auth': () => auth,
    });
    renderApp(<ComeHomeSection />);
    await waitFor(() => expect(calls.some((c) => c.path === '/api/import')).toBe(true));
    expect(screen.queryByRole('heading', { name: /Bring your things/ })).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('previews exactly what comes over, brings the ticked things, then offers Undo', async () => {
    const user = userEvent.setup();
    const calls = mockFetch({
      'GET /api/import': () => status(),
      'GET /api/import/openclaw': () => plan,
      'POST /api/import': () => result,
      'POST /api/import/undo': () => ({ removed: 3, restored: 1 }),
      'GET /api/auth': () => auth,
    });
    renderApp(<ComeHomeSection />);
    const offer = await screen.findByRole('region', { name: 'Bring your things from OpenClaw' });
    expect(offer).toHaveTextContent('2 memories, 2 skills');
    await user.click(within(offer).getByRole('button', { name: 'Take a look' }));

    const dialog = await screen.findByRole('dialog', { name: 'Bring your things from OpenClaw' });
    await within(dialog).findByRole('region', { name: 'Memories' });
    expect(dialog).toHaveTextContent('/Users/ada/.openclaw');
    // The worrying skill and the bot start unticked, and say why.
    expect(within(dialog).getByRole('checkbox', { name: /solana helper/ })).not.toBeChecked();
    expect(dialog).toHaveTextContent('Downloads something and runs it.');
    expect(within(dialog).getByRole('checkbox', { name: /Telegram bot/ })).not.toBeChecked();
    expect(dialog).toHaveTextContent('Stop OpenClaw first');
    expect(dialog).toHaveTextContent('couldn’t all be read');

    await user.click(within(dialog).getByRole('checkbox', { name: /Telegram bot/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Bring 4 things over' }));

    const summary = await within(dialog).findByRole('region', {
      name: 'Your things from OpenClaw are here',
    });
    expect(calls.find((c) => c.method === 'POST' && c.path === '/api/import')?.body).toEqual({
      source: 'openclaw',
      items: ['persona:name', 'memory:0', 'routine:0', 'channel:telegram'],
    });
    expect(summary).toHaveTextContent('1 memory');
    expect(summary).toHaveTextContent('1 routine, as a draft');
    expect(summary).toHaveTextContent('Say hello to @pearl_bot');
    expect(summary).toHaveTextContent('The routine is a draft');
    expect(summary).toHaveTextContent('backed itself up first');

    await user.click(within(summary).getByRole('button', { name: 'Undo' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path === '/api/import/undo')).toBe(true),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('groups another agent’s things, and sends a half Slack bot to finish in Channels (ADR 0042)', async () => {
    const user = userEvent.setup();
    const atlas = { id: 'work', name: 'Atlas' };
    mockFetch({
      'GET /api/import': () => status(),
      'GET /api/import/openclaw': () => ({
        ...plan,
        problems: [],
        items: [
          {
            id: 'model',
            group: 'model',
            title: 'Use Claude Opus, as in OpenClaw',
            detail: 'New chats start with Opus on Claude Code.',
            checked: true,
          },
          {
            id: 'agent:work:persona',
            group: 'skills',
            title: 'Talk as Atlas',
            checked: true,
            agent: atlas,
          },
          {
            id: 'agent:work:memory:1',
            group: 'memories',
            title: 'Charles reviews every pull request.',
            checked: true,
            agent: atlas,
          },
          { id: 'channel:slack', group: 'channels', title: 'Your Slack bot', checked: false },
        ],
      }),
      'POST /api/import': () => ({
        ...result,
        counts: { ...result.counts, model: 1, channels: 0 },
        outcomes: [
          {
            id: 'model',
            group: 'model',
            title: 'Model: Claude Opus 4.6',
            ok: true,
            message: 'New chats start with Opus on Claude Code.',
          },
          {
            id: 'channel:slack',
            group: 'channels',
            title: 'Slack bot',
            ok: true,
            message:
              'Slack needs one more key, the app-level token: Conch shows you where to get it.',
            finish: 'slack-key',
          },
        ],
      }),
      'GET /api/auth': () => auth,
    });
    renderApp(<ComeHomeSection />);
    await user.click(await screen.findByRole('button', { name: 'Take a look' }));
    const dialog = await screen.findByRole('dialog', { name: 'Bring your things from OpenClaw' });
    const agent = await within(dialog).findByRole('region', { name: 'Atlas' });
    expect(agent).toHaveTextContent('Talk as Atlas');
    expect(agent).toHaveTextContent('Charles reviews');
    expect(within(dialog).getByRole('region', { name: 'Model' })).toHaveTextContent(
      'Use Claude Opus, as in OpenClaw',
    );
    await user.click(within(dialog).getByRole('checkbox', { name: /Your Slack bot/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Bring 4 things over' }));
    const summary = await within(dialog).findByRole('region', {
      name: 'Your things from OpenClaw are here',
    });
    expect(summary).toHaveTextContent('1 model choice');
    expect(summary).toHaveTextContent('New chats start with Opus');
    expect(within(summary).getByRole('link', { name: 'Finish connecting Slack' })).toHaveAttribute(
      'href',
      '/channels/new/slack?from=openclaw',
    );
  });

  it('shows progress while things come over', async () => {
    const user = userEvent.setup();
    let finish: () => void = () => undefined;
    mockFetch({
      'GET /api/import': () => status(),
      'GET /api/import/openclaw': () => plan,
      'GET /api/auth': () => auth,
    });
    // The import itself waits, as a real one does while things come over.
    const routes = globalThis.fetch;
    vi.stubGlobal('fetch', (input: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? new Promise<Response>((resolve) => {
            finish = () => resolve(new Response(JSON.stringify(result), { status: 200 }));
          })
        : routes(input, init),
    );
    renderApp(<ComeHomeSection />);
    await user.click(await screen.findByRole('button', { name: 'Take a look' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(await within(dialog).findByRole('button', { name: /Bring 3 things over/ }));
    act(() => useImportProgress.setState({ done: 1, total: 3, current: 'Morning briefing' }));
    expect(
      await within(dialog).findByRole('progressbar', { name: 'Bringing your things over' }),
    ).toHaveAttribute('aria-valuenow', '1');
    expect(dialog).toHaveTextContent('Morning briefing');
    act(() => finish());
    expect(await within(dialog).findByText('Welcome home')).toBeInTheDocument();
  });

  it('opens straight away from ⌘K or Repair everything, and Undo stays for the last import', async () => {
    const user = userEvent.setup();
    useUi.setState({ settingsFocus: 'come-home' });
    const calls = mockFetch({
      'GET /api/import': () =>
        status({
          sources: [{ ...source, imported: { at: Date.now() - 60_000, count: 6 } }],
          last: { at: Date.now() - 60_000, source: 'openclaw', count: 6 },
        }),
      'GET /api/import/openclaw': () => plan,
      'POST /api/import/undo': () => ({ removed: 6, restored: 0 }),
      'GET /api/auth': () => auth,
    });
    renderApp(<ComeHomeSection />);
    const dialog = await screen.findByRole('dialog', { name: 'Bring your things from OpenClaw' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(useUi.getState().settingsFocus).toBeUndefined();
    expect(screen.getByText(/Brought over 6 things/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo that import' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path === '/api/import/undo')).toBe(true),
    );
  });
});
