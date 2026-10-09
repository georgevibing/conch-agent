import type { WaitNote } from '@conch/protocol';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appState, mockFetch, renderApp } from '../../test/harness';
import { Transcript } from '../chat/Transcript';
import { waitingFor } from './waiting';

afterEach(() => vi.unstubAllGlobals());

const wait: WaitNote = {
  waitId: 'wait_1',
  kind: 'ci',
  title: 'CI for conch #482',
  state: 'watching',
  status: '3 of 7 checks done',
  parts: [
    { name: 'lint', state: 'passed' },
    { name: 'e2e', state: 'running' },
  ],
  startedAt: Date.now() - 60_000,
  nextCheckAt: Date.now() + 30_000,
  deadline: Date.now() + 3_600_000,
  wakes: true,
};

function show(note: WaitNote) {
  const calls = mockFetch({
    'GET /api/state': () => appState(),
    'POST /api/conversations/c1/waits/wait_1': () => ({ ok: true }),
  });
  renderApp(
    <Transcript
      conversationId="c1"
      view={{
        lastSeq: 1,
        status: 'idle',
        items: [{ kind: 'wait', id: 'wait-wait_1', wait: note }],
      }}
      pending={[]}
      name="Conch"
      onRespond={() => {}}
      onRetry={() => {}}
    />,
  );
  return calls;
}

describe('a waiting row in the chat (ADR 0124)', () => {
  it('shows what it waits for, and Check now and Stop waiting reach Conch', async () => {
    const user = userEvent.setup();
    const calls = show(wait);
    expect(screen.getByText('Waiting for CI for conch #482')).toBeInTheDocument();
    expect(screen.getByText(/you can keep chatting/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Check now' }));
    await user.click(screen.getByRole('button', { name: 'Stop waiting' }));
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'POST').map((c) => c.body)).toEqual([
        { action: 'check' },
        { action: 'stop' },
      ]),
    );
  });

  it('once over, says how it went and offers nothing more to press', () => {
    show({
      ...wait,
      state: 'done',
      tone: 'good',
      status: 'CI passed: all 7 checks are green',
      endedAt: Date.now(),
    });
    expect(screen.getByText('CI passed: all 7 checks are green')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop waiting' })).not.toBeInTheDocument();
  });

  it('the composer knows what the chat still waits for', () => {
    expect(waitingFor([{ kind: 'wait', id: 'w', wait }])).toBe(wait);
    expect(
      waitingFor([{ kind: 'wait', id: 'w', wait: { ...wait, state: 'stopped' } }]),
    ).toBeUndefined();
  });
});
