/**
 * A step that matters, allowed from the chat's own card on another device
 * (ADR 0108): the gateway holds it back, the card waits again, Conch asks you
 * to confirm it's you right there, then sends the same answer again.
 */
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useLive } from '../../live/LiveProvider';
import { useLiveStore } from '../../live/store';
import { FakeSocket, mockFetch, renderApp } from '../../test/harness';
import { ConfirmToAllow } from './ConfirmToAllow';

afterEach(() => vi.unstubAllGlobals());

function Card() {
  const live = useLive();
  return (
    <button type="button" onClick={() => live.respond('c1', 'p1', 'allow')}>
      Allow
    </button>
  );
}

const settings = {
  method: 'password',
  username: 'ada',
  suggestedUsername: 'ada',
  keys: [],
  passkeys: [],
  passkeysHere: false,
  sessions: [],
  devices: [],
  requests: [],
  approval: { on: false, here: false, canApprove: true },
  checkup: [],
  exposure: 'local',
  port: 4317,
  urls: [],
  verified: true,
};

const decision = () =>
  useLiveStore.getState().views.c1?.items.find((i) => i.kind === 'permission' && i.id === 'p1');

describe('confirming it’s you from the chat’s card (ADR 0108)', () => {
  it('asks for your password when the gateway wants it, then allows', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/auth': () => ({
        method: 'password',
        signedIn: true,
        setupRequired: false,
        secure: true,
      }),
      'GET /api/access': () => settings,
      'POST /api/access/verify': () => settings,
    });
    renderApp(
      <>
        <Card />
        <ConfirmToAllow />
      </>,
    );
    await waitFor(() => expect(FakeSocket.last?.readyState).toBe(1));
    act(() =>
      FakeSocket.last?.push({
        type: 'conversation.event',
        event: {
          seq: 1,
          at: 1,
          conversationId: 'c1',
          type: 'permission.requested',
          permissionId: 'p1',
          toolName: 'Bash',
          input: { command: 'git push' },
          summary: 'Run `git push`',
        },
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Allow' }));
    expect(decision()).toMatchObject({ decision: 'allow' });
    act(() =>
      FakeSocket.last?.push({
        type: 'error',
        code: 'verify-required',
        message: 'Confirm it’s you to allow this. It deletes or sends something.',
        conversationId: 'c1',
        permissionId: 'p1',
      }),
    );
    // The card waits again while you confirm.
    expect(decision()).not.toHaveProperty('decision');
    const confirm = await screen.findByRole('dialog', { name: 'Confirm it’s you' });
    await user.type(within(confirm).getByLabelText('Password'), 'purple otters juggle at dawn');
    await user.click(within(confirm).getByRole('button', { name: 'Confirm' }));
    await waitFor(() =>
      expect(
        FakeSocket.last?.sent.filter((c) => (c as { type: string }).type === 'permission.respond'),
      ).toHaveLength(2),
    );
    expect(FakeSocket.last?.sent.at(-1)).toMatchObject({
      type: 'permission.respond',
      permissionId: 'p1',
      decision: 'allow',
    });
    expect(useLiveStore.getState().stepUp).toBeUndefined();
  });
});
