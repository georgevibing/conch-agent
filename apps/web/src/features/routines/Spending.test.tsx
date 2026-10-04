/** What routines spend, in the app (ADR 0057). */
import type { Routine, RoutineSpending } from '@conch/protocol';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUi } from '../../app/ui';
import { appState, FakeSocket, mockFetch, renderApp } from '../../test/harness';
import { RoutinesView } from './RoutinesView';
import { moreRoom, runCostText, runLimitText } from './spendWords';
import { SpendingSection } from './SpendingSection';

afterEach(() => vi.unstubAllGlobals());

const nextMonth = new Date(2026, 10, 1).getTime();

const routine: Routine = {
  id: 'r_1',
  title: 'Morning briefing',
  summary: 'Today at a glance.',
  prompt: 'Summarise my day.',
  schedule: { type: 'daily', time: '08:00' },
  timezone: 'UTC',
  status: 'active',
  trust: 'ask',
  catchUp: true,
  options: {},
  createdBy: 'user',
  createdAt: 1,
  updatedAt: 1,
  scheduleText: 'Every day at 8:00 AM',
  runCount: 3,
  spend: {
    billing: 'metered',
    text: 'About $14 a month',
    monthlyUsd: 14.1,
    basis: 'runs',
    runLimit: { usd: 1.83, custom: false },
  },
};

const spending = (over: Partial<RoutineSpending> = {}): RoutineSpending => ({
  limitUsd: 20,
  isDefault: true,
  monthUsd: 3.2,
  projectedUsd: 14.1,
  ...over,
});

describe('what routines spend', () => {
  it('lets a person choose when routines on a plan wait, or never, and says what that means now', async () => {
    const onPlan: Routine = {
      ...routine,
      spend: { billing: 'plan', text: 'Runs on your Claude Max plan' },
    };
    const plans = [{ source: 'Claude Max', usedPercent: 81, waiting: 1 }];
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/routines': () => [onPlan],
      'GET /api/routines/spending': () => spending({ planRoomPercent: 80, plans }),
      'PUT /api/routines/spending': (body) => ({
        ...spending({ plans }),
        planRoomPercent: (body as { planRoomPercent: number | null }).planRoomPercent,
      }),
    });
    const user = userEvent.setup();
    renderApp(<RoutinesView />);
    expect(
      await screen.findByText('Your Claude Max plan is 81% used, so routines on it wait.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /Never wait/ }));
    // The line follows the choice at once, before the save comes back.
    expect(
      screen.getByText('Your Claude Max plan is 81% used, so the routine waiting for it goes now.'),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'PUT').at(-1)?.body).toEqual({
        planRoomPercent: null,
      }),
    );
  });

  it('keeps the choice out of sight while no routine runs on a plan', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/routines': () => [routine],
      'GET /api/routines/spending': () => spending(),
    });
    renderApp(<RoutinesView />);
    expect(await screen.findByText('About $14 a month')).toBeInTheDocument();
    expect(screen.queryByText('Room for your own chats')).not.toBeInTheDocument();
  });

  it('shows what each routine costs, and what they spent this month', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/routines': () => [routine],
      'GET /api/routines/spending': () => spending(),
    });
    renderApp(<RoutinesView />);
    expect(await screen.findByText('About $14 a month')).toBeInTheDocument();
    expect(
      await screen.findByText(/They’ve spent \$3\.20 of this month’s \$20\./),
    ).toBeInTheDocument();
    expect(screen.queryByText('Your routines are paused')).not.toBeInTheDocument();
  });

  it('says once, quietly, when they paused at the limit, with the two choices', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/routines': () => [routine],
      'GET /api/routines/spending': () =>
        spending({ monthUsd: 20.4, paused: { until: nextMonth, dismissed: false } }),
      'POST /api/routines/spending/keep-paused': () =>
        spending({ monthUsd: 20.4, paused: { until: nextMonth, dismissed: true } }),
    });
    const user = userEvent.setup();
    renderApp(<RoutinesView />);
    expect(await screen.findByText('Your routines are paused')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Raise the limit' }));
    expect(useUi.getState().settingsFocus).toBe('routines');

    await user.click(screen.getByRole('button', { name: 'Keep paused' }));
    await waitFor(() =>
      expect(screen.queryByText('Your routines are paused')).not.toBeInTheDocument(),
    );
    expect(calls.some((c) => c.path === '/api/routines/spending/keep-paused')).toBe(true);
  });

  it('follows the month live', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/routines': () => [routine],
      'GET /api/routines/spending': () => spending(),
    });
    renderApp(<RoutinesView />);
    await screen.findByText(/They’ve spent \$3\.20/);
    act(() =>
      FakeSocket.last?.push({
        type: 'routines.spending',
        spending: spending({ monthUsd: 20.4, paused: { until: nextMonth, dismissed: false } }),
      }),
    );
    expect(await screen.findByText('Your routines are paused')).toBeInTheDocument();
  });

  it('lets a person change the monthly limit, or turn it off', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/routines/spending': () => spending(),
      'PUT /api/routines/spending': (body) => spending({ ...(body as object), isDefault: false }),
    });
    const user = userEvent.setup();
    renderApp(<SpendingSection />);
    expect(await screen.findByText('$16.80 left of $20')).toBeInTheDocument();
    const amount = screen.getByRole('textbox', { name: /Limit per month/ });
    await user.clear(amount);
    await user.type(amount, '35');
    await waitFor(
      () => expect(calls.filter((c) => c.method === 'PUT').at(-1)?.body).toEqual({ limitUsd: 35 }),
      { timeout: 3000 },
    );
    await user.click(screen.getByRole('switch', { name: /Limit what routines spend/ }));
    // The gauge follows the switch at once, not when the save comes back.
    expect(screen.getByText('$3.20 spent')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    await waitFor(
      () =>
        expect(calls.filter((c) => c.method === 'PUT').at(-1)?.body).toEqual({ limitUsd: null }),
      { timeout: 3000 },
    );
  });
});

describe('spending words', () => {
  it('says what a run cost in a few words, and nothing it can’t say', () => {
    expect(runCostText({ billing: 'metered', usd: 0.61 })).toBe('$0.61');
    expect(runCostText({ billing: 'plan', planPercent: 4.2 })).toBe('4% of your plan');
    expect(runCostText({ billing: 'plan', planPercent: 0.3 })).toBe('A little of your plan');
    expect(runCostText({ billing: 'plan' })).toBeUndefined();
    expect(runCostText({ billing: 'free' })).toBe('Free');
    expect(runCostText({ billing: 'metered' })).toBeUndefined();
  });

  it('says what a run may use, and “more” is three times that', () => {
    expect(runLimitText({ usd: 1.83, custom: false })).toBe('$1.83');
    expect(runLimitText({ tokens: 900_000, custom: false })).toBe('900 thousand tokens');
    expect(moreRoom({ usd: 1.83, custom: false })).toBe(6);
    expect(moreRoom({ usd: 3, custom: false }, 3.2)).toBe(10);
  });
});
