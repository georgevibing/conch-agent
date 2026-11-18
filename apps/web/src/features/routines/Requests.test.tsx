/** Another agent asks to pause routines (ADR 0154): asked on the Routines page, answered by a press. */
import type { Routine, RoutineRequest } from '@conch/protocol';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appState, mockFetch, renderApp } from '../../test/harness';
import { RoutinesView } from './RoutinesView';

afterEach(() => vi.unstubAllGlobals());

const recap: Routine = {
  id: 'r_1',
  title: 'Weekly fitness recap',
  summary: 'Your week of workouts.',
  prompt: 'Recap.',
  schedule: { type: 'weekly', days: ['sun'], time: '19:00' },
  timezone: 'UTC',
  status: 'active',
  trust: 'ask',
  catchUp: true,
  options: {},
  createdBy: 'user',
  createdAt: 1,
  updatedAt: 1,
  scheduleText: 'Every Sunday at 7:00 PM',
  runCount: 0,
};

const request: RoutineRequest = {
  id: 'rq_1',
  from: 'Hermes',
  via: 'agent',
  action: 'pause',
  routines: [{ id: 'r_1', title: 'Weekly fitness recap' }],
  reason: 'I run it for you now',
  conversationId: 'c_peer',
  state: 'waiting',
  createdAt: 1,
};

describe('requests to pause routines', () => {
  it('asks you at the top of Routines; Pause it answers, and the card goes', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/routines': () => [recap],
      'GET /api/routines/spending': () => ({ limitUsd: 20, isDefault: true, monthUsd: 0 }),
      'GET /api/routines/requests': () => [request],
      'POST /api/routines/requests/rq_1/answer': () => ({
        ...request,
        state: 'approved',
        decidedAt: 2,
      }),
    });
    const user = userEvent.setup();
    renderApp(<RoutinesView />);
    expect(
      await screen.findByText('Hermes asks to pause “Weekly fitness recap”'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Hermes says: “I run it for you now”/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Pause it' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ approve: true }),
    );
    await waitFor(() =>
      expect(
        screen.queryByText('Hermes asks to pause “Weekly fitness recap”'),
      ).not.toBeInTheDocument(),
    );
  });

  it('says why a routine is paused', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/routines': () => [
        {
          ...recap,
          status: 'paused',
          pausedBecause: { reason: 'Moved to Hermes', by: 'terminal', at: 1 },
        },
      ],
      'GET /api/routines/spending': () => ({ limitUsd: 20, isDefault: true, monthUsd: 0 }),
    });
    renderApp(<RoutinesView />);
    expect(await screen.findByText('Paused: Moved to Hermes')).toBeInTheDocument();
  });
});
