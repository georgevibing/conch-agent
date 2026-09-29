import type { SearchPreview, SearchResults } from '@conch/protocol';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUi } from '../../app/ui';
import { appState, mockFetch, renderApp } from '../../test/harness';
import { Palette } from './Palette';

afterEach(() => {
  vi.unstubAllGlobals();
  useUi.setState({ paletteOpen: false, find: null });
});

const conversation = (id: string, title: string, updatedAt = Date.now()) => ({
  id,
  title,
  preview: '',
  createdAt: updatedAt,
  updatedAt,
  status: 'idle' as const,
  options: {},
});

const results: SearchResults = {
  query: 'redeploy',
  mode: 'exact',
  total: 2,
  capped: false,
  tookMs: 1,
  groups: [
    {
      conversationId: 'c2',
      title: 'Infra notes',
      updatedAt: Date.now(),
      matches: 2,
      hits: [
        {
          conversationId: 'c2',
          anchor: 'm1',
          role: 'assistant',
          at: Date.now(),
          snippet: 'Run the redeploy script again',
          ranges: [[8, 16]],
        },
        {
          conversationId: 'c2',
          anchor: 'u2',
          role: 'user',
          at: Date.now(),
          snippet: 'redeploy failed',
          ranges: [[0, 8]],
        },
      ],
    },
  ],
};

const preview: SearchPreview = {
  conversationId: 'c2',
  title: 'Infra notes',
  createdAt: 1,
  updatedAt: Date.now(),
  messageCount: 4,
  messages: [
    {
      anchor: 'm1',
      role: 'assistant',
      at: Date.now(),
      text: 'Run the redeploy script again',
      ranges: [[8, 16]],
      focus: true,
      clippedStart: false,
      clippedEnd: false,
    },
  ],
};

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

describe('Palette search', () => {
  it('finds chats by title and messages by content, previews, and opens at the message', async () => {
    const user = userEvent.setup();
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [
        conversation('c1', 'Redeploy the staging stack'),
        conversation('c2', 'Infra notes'),
        conversation('c3', 'Plan my week'),
      ],
      'GET /api/search': () => results,
      'GET /api/search/preview': () => preview,
    });
    renderApp(
      <>
        <Palette />
        <Where />
      </>,
    );
    act(() => useUi.getState().setPalette(true));
    const box = await screen.findByRole('combobox');
    // Empty: recent chats first.
    expect(await screen.findByRole('option', { name: /Plan my week/ })).toBeInTheDocument();

    await user.type(box, 'redeploy');
    expect(
      await screen.findByRole('option', { name: /Redeploy the staging stack/ }),
    ).toBeInTheDocument();
    const hit = await screen.findByRole('option', { name: /Infra notes.*Run the redeploy script/ });
    expect(hit.querySelector('mark')?.textContent).toBe('redeploy');
    expect(screen.getByRole('option', { name: /redeploy failed/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Plan my week/ })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('2 messages in 1 chat');
    expect(calls.some((c) => c.path.startsWith('/api/search?q=redeploy'))).toBe(true);

    await user.keyboard('{ArrowDown}');
    expect(hit).toHaveAttribute('aria-selected', 'true');
    const pane = await screen.findByRole('region', { name: 'Preview' });
    await waitFor(() => expect(pane).toHaveTextContent('4 messages'));
    expect(pane).toHaveTextContent('Open at this message');

    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/c/c2'));
    expect(useUi.getState()).toMatchObject({
      paletteOpen: false,
      find: { conversationId: 'c2', query: 'redeploy', target: '[data-anchor="m1"]' },
    });
  });

  it('asks for more characters before searching messages, and says when nothing matches', async () => {
    const user = userEvent.setup();
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [conversation('c1', 'Plan my week')],
      'GET /api/search': () => ({ ...results, query: 'zzqx', groups: [], total: 0 }),
    });
    renderApp(<Palette />);
    act(() => useUi.getState().setPalette(true));
    const box = await screen.findByRole('combobox');
    await user.type(box, 'zz');
    expect(screen.getByRole('status')).toHaveTextContent('Keep typing to search messages');
    expect(calls.some((c) => c.path.startsWith('/api/search?'))).toBe(false);
    await user.type(box, 'qx');
    expect(
      await screen.findByText(/Nothing matches “zzqx”/, {}, { timeout: 4000 }),
    ).toBeInTheDocument();
  });

  it('finds skills, models from every provider, and settings by name', async () => {
    const user = userEvent.setup();
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
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
      'GET /api/skills': () => ({
        skills: [
          {
            id: 'weekly-review',
            name: 'weekly-review',
            title: 'Weekly review',
            description: 'Drafts a weekly review. Use when asked.',
            source: 'conch',
            sourceLabel: 'Conch',
            editable: true,
            mode: 'auto',
            path: '/x',
            files: [],
            updatedAt: 1,
          },
        ],
        sources: [],
      }),
      'GET /api/models': () => ({
        default: 'claude-code',
        providers: [
          {
            engine: 'claude-code',
            label: 'Claude Code',
            models: [model('opus', 'Opus 5.5')],
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
    });
    renderApp(
      <>
        <Palette />
        <Where />
      </>,
    );
    act(() => useUi.getState().setPalette(true));
    const box = await screen.findByRole('combobox');

    await user.type(box, 'weekly');
    const skill = await screen.findByRole('option', { name: /Weekly review/ });
    expect(skill).toHaveTextContent('/weekly-review');
    await user.keyboard('{Enter}');
    // Into the composer of a new chat, ready for details.
    await waitFor(() => expect(useUi.getState().composerText).toBe('/weekly-review '));

    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'qwen');
    expect(await screen.findByRole('option', { name: /Qwen3 Coder/ })).toHaveTextContent(
      'OpenRouter',
    );

    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'providers');
    expect(await screen.findByRole('option', { name: /Settings: Providers/ })).toBeInTheDocument();

    // Keywords count by whole-word prefix, not scattered letters.
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'forget');
    expect(await screen.findByRole('option', { name: /Settings: Memory/ })).toBeInTheDocument();
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'meet');
    await waitFor(() =>
      expect(screen.queryByRole('option', { name: /Settings: Memory/ })).toBeNull(),
    );
  });
});
