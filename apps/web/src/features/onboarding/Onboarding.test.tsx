import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appState, baseEngine, mockFetch, renderApp } from '../../test/harness';
import { Onboarding } from './Onboarding';

afterEach(() => vi.unstubAllGlobals());

describe('Onboarding', () => {
  it('walks welcome → connect → personality → about → done, saving as it goes', async () => {
    let state = appState({ onboarded: false, profile: { name: '', about: '' } });
    const calls = mockFetch({
      'GET /api/state': () => state,
      'GET /api/engine': () => baseEngine,
      'PATCH /api/settings': (body) => {
        const patch = body as { profile?: object; persona?: object; onboarded?: boolean };
        state = {
          ...state,
          ...(patch.onboarded !== undefined && { onboarded: patch.onboarded }),
          persona: { ...state.persona, ...patch.persona },
          profile: { ...state.profile, ...patch.profile },
        };
        return state;
      },
    });
    const user = userEvent.setup();
    renderApp(<Onboarding />);

    await user.click(await screen.findByRole('button', { name: 'Get started' }));
    expect(
      await screen.findByRole('heading', { name: 'Let’s connect to Claude' }),
    ).toBeInTheDocument();
    // Ready engines advance on their own.
    expect(
      await screen.findByRole('heading', { name: 'Give me a personality' }, { timeout: 4000 }),
    ).toBeInTheDocument();

    await user.clear(screen.getByRole('textbox', { name: 'What should I be called?' }));
    await user.type(screen.getByRole('textbox', { name: 'What should I be called?' }), 'Pearl');
    await user.click(screen.getByRole('radio', { name: /Concise/ }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          method: 'PATCH',
          body: { persona: expect.objectContaining({ name: 'Pearl', tone: 'concise' }) },
        }),
      ),
    );

    await user.type(await screen.findByRole('textbox', { name: 'What should I call you?' }), 'Ada');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { name: 'All set, Ada.' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Start chatting' }));
    await waitFor(() =>
      expect(calls).toContainEqual(expect.objectContaining({ body: { onboarded: true } })),
    );
  });

  it('lets every optional step be skipped', async () => {
    mockFetch({
      'GET /api/state': () => appState({ onboarded: false }),
      'GET /api/engine': () => baseEngine,
    });
    const user = userEvent.setup();
    renderApp(<Onboarding />);
    await user.click(await screen.findByRole('button', { name: 'Get started' }));
    await screen.findByRole('heading', { name: 'Give me a personality' }, { timeout: 4000 });
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    await user.click(await screen.findByRole('button', { name: 'Skip for now' }));
    expect(await screen.findByRole('button', { name: 'Start chatting' })).toBeInTheDocument();
  });
});
