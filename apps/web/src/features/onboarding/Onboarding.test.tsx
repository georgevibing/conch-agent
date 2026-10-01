import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appState, baseEngine, baseProviders, mockFetch, renderApp } from '../../test/harness';
import { Onboarding } from './Onboarding';

afterEach(() => vi.unstubAllGlobals());

describe('Onboarding', () => {
  it('walks welcome → connect → personality → about → done, saving as it goes', async () => {
    let state = appState({ onboarded: false, profile: { name: '', about: '' } });
    const calls = mockFetch({
      'GET /api/state': () => state,
      'GET /api/engine': () => baseEngine,
      'GET /api/providers': () => baseProviders,
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
      await screen.findByRole('heading', { name: 'Choose what powers me' }),
    ).toBeInTheDocument();
    // A provider that's already connected carries you onward by itself.
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
      'GET /api/providers': () => baseProviders,
    });
    const user = userEvent.setup();
    renderApp(<Onboarding />);
    await user.click(await screen.findByRole('button', { name: 'Get started' }));
    await screen.findByRole('heading', { name: 'Give me a personality' }, { timeout: 4000 });
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    await user.click(await screen.findByRole('button', { name: 'Skip for now' }));
    expect(await screen.findByRole('button', { name: 'Start chatting' })).toBeInTheDocument();
  });

  it('offers to bring your things when another assistant is here, and Not now carries on', async () => {
    mockFetch({
      'GET /api/state': () => appState({ onboarded: false }),
      'GET /api/engine': () => baseEngine,
      'GET /api/providers': () => baseProviders,
      'GET /api/import': () => ({
        sources: [
          {
            id: 'hermes',
            label: 'Hermes',
            path: '/Users/ada/.hermes',
            summary: '2 memories, 1 skill, 1 routine',
          },
        ],
      }),
      'GET /api/import/hermes': () => ({
        source: {
          id: 'hermes',
          label: 'Hermes',
          path: '/Users/ada/.hermes',
          summary: '2 memories, 1 skill, 1 routine',
        },
        items: [
          { id: 'memory:0', group: 'memories', title: 'Prefers metric units.', checked: true },
        ],
        problems: [],
      }),
      'GET /api/auth': () => ({ method: 'none', signedIn: true, setupRequired: false }),
    });
    const user = userEvent.setup();
    renderApp(<Onboarding />);
    await user.click(await screen.findByRole('button', { name: 'Get started' }));
    expect(
      await screen.findByRole(
        'heading',
        { name: 'Bring your things from Hermes?' },
        { timeout: 4000 },
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Take a look' }));
    expect(await screen.findByRole('checkbox', { name: /Prefers metric units/ })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    expect(
      await screen.findByRole('heading', { name: 'Give me a personality' }),
    ).toBeInTheDocument();
  });
});
