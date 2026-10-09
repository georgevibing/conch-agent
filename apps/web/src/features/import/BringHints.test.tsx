import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUi } from '../../app/ui';
import { mockFetch, renderApp } from '../../test/harness';
import { ComeHomeHint, PastChatsHint } from './BringHints';
import { PAST_CHATS_FOCUS } from './pastChats';

/**
 * What the welcome no longer stops for, offered on the new chat instead: another
 * assistant's things and past chats, each a quiet line while there's something
 * to bring, opening the place in Settings → Memory where it's looked at first.
 */

afterEach(() => vi.unstubAllGlobals());

const openclaw = { id: 'openclaw', label: 'OpenClaw', summary: '3 memories', path: '/x' };
const claude = { id: 'claude-code', label: 'Claude Code', found: 1284, projects: [] };

describe('bringing things in, from the new chat', () => {
  it('offers another assistant’s things until they’ve come over', async () => {
    mockFetch({ 'GET /api/import': () => ({ sources: [openclaw] }) });
    const user = userEvent.setup();
    const { where } = renderApp(<ComeHomeHint />);
    await user.click(
      await screen.findByRole('button', { name: 'Bring your things from OpenClaw' }),
    );
    await waitFor(() => expect(where()).toBe('/settings/memory/from-openclaw'));
  });

  it('says nothing once they have come over', async () => {
    const calls = mockFetch({
      'GET /api/import': () => ({
        sources: [{ ...openclaw, imported: { at: 1, count: 3 } }],
      }),
    });
    renderApp(<ComeHomeHint />);
    await waitFor(() => expect(calls.some((c) => c.path === '/api/import')).toBe(true));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('offers past chats from other apps, and opens where they come in', async () => {
    mockFetch({
      'GET /api/import/chats': () => ({ sources: [{ ...claude, fresh: 1284 }], brought: 0 }),
    });
    const user = userEvent.setup();
    renderApp(<PastChatsHint />);
    await user.click(
      await screen.findByRole('button', { name: 'Bring in 1,284 past chats from Claude Code' }),
    );
    expect(useUi.getState().settingsFocus).toBe(PAST_CHATS_FOCUS);
  });

  it('says nothing once some are in: new ones come by themselves', async () => {
    const calls = mockFetch({
      'GET /api/import/chats': () => ({ sources: [{ ...claude, fresh: 4 }], brought: 1280 }),
    });
    renderApp(<PastChatsHint />);
    await waitFor(() => expect(calls.some((c) => c.path === '/api/import/chats')).toBe(true));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
