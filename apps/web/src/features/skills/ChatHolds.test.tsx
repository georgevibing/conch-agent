import type { SkillHold } from '@conch/protocol';
import { Toaster } from '@conch/nacre';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUi } from '../../app/ui';
import { appState, mockFetch, renderApp } from '../../test/harness';
import { ChatHolds, holdEntries } from './ChatHolds';

afterEach(() => {
  vi.unstubAllGlobals();
  useUi.setState({ stopHolding: undefined });
});

const hold: SkillHold = {
  skillId: 'quick-setup',
  name: 'quick-setup',
  title: 'Quick setup',
  seq: 1,
  permissions: {
    declared: true,
    capabilities: ['commands'],
    commands: ['git'],
    words: ['run commands (only `git`)'],
  },
};

describe('what the chat is held to', () => {
  it('one line per skill, with the newest list it came in with', () => {
    const wider = {
      ...hold,
      seq: 4,
      permissions: { ...hold.permissions, commands: undefined, words: ['run commands'] },
    } as SkillHold;
    expect(holdEntries([hold, wider])).toEqual([
      expect.objectContaining({ skillId: 'quick-setup', words: ['run commands'] }),
    ]);
    // An older chat's hold, without a list of its own, uses the skill's.
    const known = { ...holdEntries([hold])[0], words: ['from the skill'] } as never;
    expect(holdEntries([{ ...hold, permissions: undefined }], () => known)[0]?.words).toEqual([
      'from the skill',
    ]);
  });

  it('stops holding when you say so, and only then', async () => {
    const user = userEvent.setup();
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/skills': () => ({ skills: [], sources: [] }),
      'POST /api/conversations/c1/skills/quick-setup/stop-holding': () => ({ ok: true }),
    });
    renderApp(<ChatHolds conversationId="c1" holds={[hold]} running={false} />);
    await user.click(
      screen.getByRole('button', { name: 'Stop holding this chat to Quick setup’s list' }),
    );
    await user.click(await screen.findByRole('button', { name: 'Keep holding' }));
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    await user.click(
      screen.getByRole('button', { name: 'Stop holding this chat to Quick setup’s list' }),
    );
    await user.click(await screen.findByRole('button', { name: 'Stop holding' }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          method: 'POST',
          path: '/api/conversations/c1/skills/quick-setup/stop-holding',
        }),
      ),
    );
  });

  it('opens the question when ⌘K asks, and says why when it can’t', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/skills': () => ({ skills: [], sources: [] }),
      'POST /api/conversations/c1/skills/quick-setup/stop-holding': () =>
        new Response(
          JSON.stringify({
            error: 'busy',
            message: 'Wait for this answer to finish, then try again.',
          }),
          { status: 409 },
        ),
    });
    renderApp(
      <>
        <ChatHolds conversationId="c1" holds={[hold]} running={false} />
        <Toaster />
      </>,
    );
    act(() => useUi.setState({ stopHolding: { conversationId: 'c1', skillId: 'quick-setup' } }));
    await user.click(await screen.findByRole('button', { name: 'Stop holding' }));
    expect(
      await screen.findByText('Wait for this answer to finish, then try again.'),
    ).toBeVisible();
    // The question stays, to try again.
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });
});
