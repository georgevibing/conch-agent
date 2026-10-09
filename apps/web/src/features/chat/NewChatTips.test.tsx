import type { NewChatTip, UpdateSettingsBody } from '@conch/protocol';
import { Toaster } from '@conch/nacre';
import { screen, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appState, mockFetch, renderApp } from '../../test/harness';
import { GeneralTab } from '../settings/GeneralTab';
import { NewChatTips, pickTip, type Tip, type TipFound } from './NewChatTips';

/**
 * The tips under the box on a new chat: one at a time, in order, each short
 * enough for a phone, each put away for good with its ×, on every device.
 */

afterEach(() => vi.unstubAllGlobals());

const openclaw = { id: 'openclaw', label: 'OpenClaw', summary: '3 memories', path: '/x' };
const claude = { id: 'claude-code', label: 'Claude Code', found: 130, projects: [] };
const codex = { id: 'codex', label: 'Codex', found: 0, projects: [] };

/** A new Conch with everything to offer, and what the person put away before (the server's copy). */
function world(initially: NewChatTip[] = []) {
  let putAway = initially;
  const state = () => {
    const base = appState();
    return { ...base, preferences: { ...base.preferences, tipsPutAway: putAway } };
  };
  const calls = mockFetch({
    'GET /api/state': state,
    'PATCH /api/settings': (body) => {
      putAway = (body as UpdateSettingsBody).preferences?.tipsPutAway ?? putAway;
      return state();
    },
    'GET /api/integrations': () => ({ catalog: [], integrations: [], providers: [] }),
    'GET /api/channels': () => ({ channels: [], catalog: [] }),
    'GET /api/import': () => ({ sources: [openclaw] }),
    'GET /api/import/chats': () => ({
      sources: [
        { ...claude, fresh: 130 },
        { ...codex, fresh: 0 },
      ],
      brought: 0,
    }),
  });
  return { calls, putAway: () => putAway };
}

const tip = (id: NewChatTip): Tip => ({ id, label: id, open: () => {} });

describe('which tip shows', () => {
  const none: Record<NewChatTip, TipFound> = {
    'connect-apps': null,
    'come-home': null,
    'past-chats': null,
    'chat-apps': null,
  };

  it('is the first in order that isn’t put away', () => {
    const all = {
      'connect-apps': tip('connect-apps'),
      'come-home': tip('come-home'),
      'past-chats': tip('past-chats'),
      'chat-apps': tip('chat-apps'),
    };
    expect(pickTip(all, new Set())?.id).toBe('connect-apps');
    expect(pickTip(all, new Set(['connect-apps']))?.id).toBe('come-home');
    expect(pickTip(all, new Set(['connect-apps', 'come-home']))?.id).toBe('past-chats');
    expect(pickTip(all, new Set(['connect-apps', 'come-home', 'past-chats']))?.id).toBe(
      'chat-apps',
    );
    expect(pickTip(all, new Set(Object.keys(all) as NewChatTip[]))).toBeNull();
    expect(pickTip({ ...none, 'chat-apps': tip('chat-apps') }, new Set())?.id).toBe('chat-apps');
  });

  it('waits for one still being found out, rather than showing a later one and swapping', () => {
    const found = { ...none, 'come-home': undefined, 'chat-apps': tip('chat-apps') };
    expect(pickTip(found, new Set())).toBeUndefined();
    // Unless it's put away: then it's never looked for.
    expect(pickTip(found, new Set(['come-home']))?.id).toBe('chat-apps');
  });
});

describe('the tips on a new chat', () => {
  it('shows one at a time, however many have something to offer', async () => {
    world();
    const { container } = renderApp(<NewChatTips />);
    await screen.findByRole('button', { name: 'Connect Gmail, GitHub and more' });
    expect(
      screen.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent),
    ).toEqual(['Connect Gmail, GitHub and more', 'Don’t show this tip again']);
    const { violations } = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(violations).toEqual([]);
  });

  it('keeps every line short enough for a phone', async () => {
    const lines: string[] = [];
    for (const away of [
      [],
      ['connect-apps'],
      ['connect-apps', 'come-home'],
      ['connect-apps', 'come-home', 'past-chats'],
    ] as NewChatTip[][]) {
      world(away);
      const { unmount } = renderApp(<NewChatTips />);
      const go = await screen.findByRole('button', { name: /^(Connect|Bring|Talk)/ });
      lines.push(go.textContent);
      unmount();
    }
    expect(lines).toEqual([
      'Connect Gmail, GitHub and more',
      'Bring your things from OpenClaw',
      'Bring in 130 past chats',
      'Talk to it from your chat apps',
    ]);
    // About 360px at the hint's size, with its arrow and its ×.
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(32);
  });

  it('puts a tip away for good, stays quiet for this chat, and shows the next on a later one', async () => {
    const { calls, putAway } = world();
    const user = userEvent.setup();
    const first = renderApp(<NewChatTips />);
    await screen.findByRole('button', { name: 'Connect Gmail, GitHub and more' });
    await user.click(screen.getByRole('button', { name: 'Don’t show this tip again' }));

    // Saved with the settings, so every device and every reload knows.
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
        preferences: { tipsPutAway: ['connect-apps'] },
      }),
    );
    expect(putAway()).toEqual(['connect-apps']);
    // Nothing takes its place here: a × never summons the next ask.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    first.unmount();

    // A later new chat (or another device) reads it from the server.
    renderApp(<NewChatTips />);
    expect(
      await screen.findByRole('button', { name: 'Bring your things from OpenClaw' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Connect Gmail/ })).not.toBeInTheDocument();
  });

  it('brings a tip put away back with Undo', async () => {
    const { putAway } = world();
    const user = userEvent.setup();
    renderApp(
      <>
        <NewChatTips />
        <Toaster />
      </>,
    );
    await screen.findByRole('button', { name: 'Connect Gmail, GitHub and more' });
    await user.click(screen.getByRole('button', { name: 'Don’t show this tip again' }));
    await waitFor(() => expect(putAway()).toEqual(['connect-apps']));
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(putAway()).toEqual([]));
    expect(
      await screen.findByRole('button', { name: 'Connect Gmail, GitHub and more' }),
    ).toBeInTheDocument();
  });

  it('says nothing once every tip is put away, and doesn’t look for past chats', async () => {
    const { calls } = world(['connect-apps', 'come-home', 'past-chats', 'chat-apps']);
    renderApp(<NewChatTips />);
    await waitFor(() => expect(calls.some((c) => c.path === '/api/state')).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(calls.some((c) => c.path.startsWith('/api/import'))).toBe(false);
  });
});

describe('showing tips again', () => {
  it('brings every tip put away back from Settings → General', async () => {
    const { putAway } = world(['connect-apps', 'past-chats']);
    const user = userEvent.setup();
    renderApp(<GeneralTab workspace="/home/ada/.conch/workspace" />);
    expect(await screen.findByText(/2 tips are put away/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show tips again' }));
    await waitFor(() => expect(putAway()).toEqual([]));
    expect(screen.queryByRole('button', { name: 'Show tips again' })).not.toBeInTheDocument();
  });
});
