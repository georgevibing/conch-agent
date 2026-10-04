import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appState, mockFetch, renderApp } from '../../test/harness';
import { TurnLimitsSection } from './TurnLimitsSection';

afterEach(() => vi.unstubAllGlobals());

describe('Long turns (ADR 0085)', () => {
  it('is off until chosen, with no numbers to set', async () => {
    mockFetch({ 'GET /api/state': () => appState() });
    renderApp(<TurnLimitsSection />);
    expect(await screen.findByRole('switch', { name: /Pause long turns/ })).not.toBeChecked();
    expect(screen.getByText(/A turn runs until it’s done/)).toBeVisible();
    expect(screen.queryByLabelText('Steps')).toBeNull();
  });

  it('turns on with Conch’s starting numbers, and saves what’s changed', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'PATCH /api/settings': () => appState(),
    });
    renderApp(<TurnLimitsSection />);
    await userEvent.click(await screen.findByRole('switch', { name: /Pause long turns/ }));
    const steps = await screen.findByLabelText('Steps');
    expect(steps).toHaveValue('100');
    await userEvent.clear(steps);
    await userEvent.type(steps, '250');
    await waitFor(
      () =>
        expect(calls).toContainEqual(
          expect.objectContaining({
            method: 'PATCH',
            path: '/api/settings',
            body: {
              preferences: {
                turnLimits: { on: true, steps: 250, tokens: 2_000_000, minutes: 30 },
              },
            },
          }),
        ),
      { timeout: 3_000 },
    );
  });

  it('never saves a number that isn’t one', async () => {
    const calls = mockFetch({
      'GET /api/state': () =>
        appState({
          preferences: {
            ...appState().preferences,
            turnLimits: { on: true, steps: 100, tokens: 2_000_000, minutes: 30 },
          },
        }),
      'PATCH /api/settings': () => appState(),
    });
    renderApp(<TurnLimitsSection />);
    const minutes = await screen.findByLabelText('Minutes');
    await userEvent.clear(minutes);
    await userEvent.type(minutes, 'soon');
    expect(await screen.findByText(/whole number from 1 to 1,440/)).toBeVisible();
    await new Promise((r) => setTimeout(r, 800));
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
  });
});
