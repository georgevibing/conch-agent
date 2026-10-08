import type { RunTimeline, TrajectoryPreview } from '@conch/protocol';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { useUi } from '../../app/ui';
import { appState, mockFetch, renderApp } from '../../test/harness';
import { useHowItDidIt } from './api';
import { TrajectoryHost } from './TrajectoryHost';

const TIMELINE: RunTimeline = {
  conversationId: 'c1',
  title: 'Fix the login test',
  origin: 'routine',
  startedAt: 1000,
  endedAt: 9000,
  steps: [
    { id: 'asked:u1', kind: 'asked', at: 1000, turn: 0, title: 'Fix the login test', anchor: 'u1' },
    {
      id: 'tool:t1',
      kind: 'tool',
      family: 'verify',
      at: 2000,
      durationMs: 4000,
      turn: 0,
      title: 'Ran the tests',
      detail: '241 passed',
      status: 'done',
      anchor: 't1',
      peek: '241 passed',
    },
    {
      id: 'said:a1',
      kind: 'said',
      at: 7000,
      durationMs: 1000,
      turn: 0,
      title: 'Fixed it.',
      anchor: 'a1',
    },
  ],
  turns: [
    {
      index: 0,
      at: 1000,
      endAt: 9000,
      usage: { inputTokens: 1000, outputTokens: 200 },
      cost: { billing: 'metered', usd: 0.03 },
    },
  ],
  totals: {
    durationMs: 8000,
    inputTokens: 1000,
    outputTokens: 200,
    usd: 0.03,
    planTurns: 0,
    tools: 1,
    approvals: 0,
    files: 0,
    failed: 0,
  },
};

const PREVIEW: TrajectoryPreview = {
  chats: 1,
  steps: 3,
  removed: [{ kind: 'key', count: 2, examples: ['OPENAI_API_KEY=[key]'] }],
  name: 'Conch – Fix the login test – 2026-10-08.html',
  folder: { path: '/Users/ada/Downloads', shown: '~/Downloads' },
};

afterEach(() => act(() => useHowItDidIt.setState({ runFor: null, saving: null })));

describe('how it did it', () => {
  it('draws the chat’s timeline and opens the chat at a step', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/conversations/c1/timeline': () => TIMELINE,
    });
    const app = renderApp(<TrajectoryHost />);
    act(() => useHowItDidIt.getState().openRun('c1'));
    expect(await screen.findByRole('heading', { name: 'How Conch did it' })).toBeInTheDocument();
    expect(await screen.findByText(/A routine’s run/)).toBeInTheDocument();
    expect(await screen.findByRole('slider', { name: 'Step' })).toHaveAttribute(
      'aria-valuetext',
      'Step 3 of 3: Conch: Fixed it.',
    );
    await user.click(screen.getByRole('button', { name: /Ran the tests/ }));
    await user.click(screen.getByRole('button', { name: /Show in chat/ }));
    expect(app.where()).toBe('/c/c1');
    expect(useUi.getState().find).toMatchObject({
      conversationId: 'c1',
      target: '[data-anchor="t1"]',
    });
    expect(useHowItDidIt.getState().runFor).toBeNull();
  });

  it('saves the chat as a file, showing first what comes out', async () => {
    const user = userEvent.setup();
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'POST /api/trajectories/preview': () => PREVIEW,
      'POST /api/trajectories/export': () => ({
        ...PREVIEW,
        path: '/Users/ada/Downloads/x.html',
        bytes: 1200,
      }),
    });
    renderApp(<TrajectoryHost />);
    act(() => useHowItDidIt.getState().openSave({ conversationId: 'c1' }));
    expect(await screen.findByRole('heading', { name: 'Save how it did it' })).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: /Taking out 2 keys and tokens/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('~/Downloads')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved in ~/Downloads');
    const saved = calls.find((c) => c.path === '/api/trajectories/export');
    expect(saved?.body).toMatchObject({
      format: 'report',
      redact: true,
      filter: { conversationId: 'c1' },
    });
  });

  it('says plainly when nothing matches a batch', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'POST /api/trajectories/preview': () =>
        new Response(
          JSON.stringify({
            error: 'trajectory-none',
            message: 'No chats match. Try a longer stretch of time, or another agent or provider.',
          }),
          { status: 404 },
        ),
    });
    renderApp(<TrajectoryHost />);
    act(() => useHowItDidIt.getState().openSave({}));
    expect(
      await screen.findByRole('heading', { name: 'Save chats as a file' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/No chats match/)).toBeInTheDocument());
    expect(screen.getByRole('switch', { name: 'Routines and tasks too' })).toBeChecked();
  });
});
