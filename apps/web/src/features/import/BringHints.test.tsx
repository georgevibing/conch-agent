import type { NewChatTip } from '@conch/protocol';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUi } from '../../app/ui';
import { appState, mockFetch, renderApp } from '../../test/harness';
import { NewChatTips } from '../chat/NewChatTips';
import { PAST_CHATS_FOCUS } from './pastChats';

/**
 * What the welcome no longer stops for, offered on the new chat instead: another
 * assistant's things and past chats, each a short line while there's something
 * to bring, opening the place in Settings → What Conch knows where it's looked at first.
 * Connecting apps comes before them, so it's put away here.
 */

afterEach(() => vi.unstubAllGlobals());

const openclaw = { id: 'openclaw', label: 'OpenClaw', summary: '3 memories', path: '/x' };
const hermes = { id: 'hermes', label: 'Hermes', summary: '2 memories', path: '/y' };
const claude = { id: 'claude-code', label: 'Claude Code', found: 1284, projects: [] };
const codex = { id: 'codex', label: 'Codex', found: 130, projects: [] };

const putAway = (...tipsPutAway: NewChatTip[]) => {
  const state = appState();
  return {
    'GET /api/state': () => ({ ...state, preferences: { ...state.preferences, tipsPutAway } }),
  };
};

describe('bringing things in, from the new chat', () => {
  it('offers another assistant’s things until they’ve come over', async () => {
    mockFetch({ ...putAway('connect-apps'), 'GET /api/import': () => ({ sources: [openclaw] }) });
    const user = userEvent.setup();
    const { where } = renderApp(<NewChatTips />);
    await user.click(
      await screen.findByRole('button', { name: 'Bring your things from OpenClaw' }),
    );
    await waitFor(() => expect(where()).toBe('/settings/memory/from-openclaw'));
  });

  it('counts several assistants on the line, and names them in full', async () => {
    mockFetch({
      ...putAway('connect-apps'),
      'GET /api/import': () => ({ sources: [openclaw, hermes] }),
    });
    renderApp(<NewChatTips />);
    const tip = await screen.findByRole('button', {
      name: 'Bring your things from OpenClaw and Hermes',
    });
    expect(tip).toHaveTextContent(/^Bring your things from 2 assistants$/);
  });

  it('says nothing once they have come over', async () => {
    const calls = mockFetch({
      ...putAway('connect-apps', 'past-chats', 'chat-apps'),
      'GET /api/import': () => ({
        sources: [{ ...openclaw, imported: { at: 1, count: 3 } }],
      }),
    });
    renderApp(<NewChatTips />);
    await waitFor(() => expect(calls.some((c) => c.path === '/api/import')).toBe(true));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('offers past chats in a few words, names the apps in full, and opens where they come in', async () => {
    mockFetch({
      ...putAway('connect-apps', 'come-home'),
      'GET /api/import/chats': () => ({
        sources: [
          { ...claude, fresh: 1284 },
          { ...codex, fresh: 130 },
        ],
        brought: 0,
      }),
    });
    const user = userEvent.setup();
    renderApp(<NewChatTips />);
    const tip = await screen.findByRole('button', {
      name: 'Bring in 1,414 past chats from Claude Code and Codex',
    });
    // The line itself fits a phone: the apps are in its name and its tooltip.
    expect(tip).toHaveTextContent(/^Bring in 1,414 past chats$/);
    await user.click(tip);
    expect(useUi.getState().settingsFocus).toBe(PAST_CHATS_FOCUS);
  });

  it('says nothing once some are in: new ones come by themselves', async () => {
    const calls = mockFetch({
      ...putAway('connect-apps', 'come-home', 'chat-apps'),
      'GET /api/import/chats': () => ({ sources: [{ ...claude, fresh: 4 }], brought: 1280 }),
    });
    renderApp(<NewChatTips />);
    await waitFor(() => expect(calls.some((c) => c.path === '/api/import/chats')).toBe(true));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
