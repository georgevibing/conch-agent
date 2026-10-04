import type { ProfileFact } from '@conch/protocol';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appState, mockFetch, renderApp } from '../../test/harness';
import { AboutYou, summarise } from './AboutYou';

afterEach(() => vi.unstubAllGlobals());

const about = 'SDM at Amazon. Father to Lina. Graphics programmer by night.';

describe('About you, as a portrait', () => {
  it('sums you up in a line: what you do, where you live, who’s close', () => {
    const facts: ProfileFact[] = [
      { id: '1', kind: 'person', text: 'Lina' },
      { id: '2', kind: 'work', text: 'SDM at Amazon' },
      { id: '3', kind: 'home', text: 'Berlin' },
      { id: '4', kind: 'person', text: 'Jouda' },
      { id: '5', kind: 'person', text: 'Poly' },
    ];
    expect(summarise(facts)).toBe('SDM at Amazon · Berlin · Lina, Jouda +1');
    expect(summarise([])).toBe('');
  });

  it('reads your own words into cards you keep, saves them, and shows what every chat starts with', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/memories': () => [],
      'PATCH /api/settings': () => appState(),
      'POST /api/profile/understand': () => ({
        facts: [
          { id: 'a', kind: 'work', text: 'SDM at Amazon' },
          { id: 'b', kind: 'person', text: 'Lina', detail: 'daughter' },
        ],
      }),
    });
    renderApp(<AboutYou initial={{ name: 'George', about, facts: [] }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Lay it out as cards' }));
    expect(await screen.findByRole('status')).toHaveTextContent('I read 2 cards in your words');
    expect(calls.find((c) => c.path === '/api/profile/understand')?.body).toEqual({ about });

    await userEvent.click(screen.getByRole('button', { name: 'Keep all' }));
    expect(
      within(screen.getByRole('region', { name: 'People' })).getByRole('button', {
        name: 'Lina, daughter',
      }),
    ).toBeVisible();
    expect(screen.getByText('SDM at Amazon · Lina')).toBeVisible();
    await waitFor(
      () =>
        expect(calls.filter((c) => c.method === 'PATCH').at(-1)?.body).toMatchObject({
          profile: {
            name: 'George',
            facts: [
              { kind: 'work', text: 'SDM at Amazon' },
              { kind: 'person', text: 'Lina', detail: 'daughter' },
            ],
          },
        }),
      { timeout: 3000 },
    );

    await userEvent.click(screen.getByRole('button', { name: 'What every chat starts with' }));
    expect(await screen.findByText(/People in their life: Lina \(daughter\)\./)).toBeVisible();
  });

  it('doesn’t offer what’s on a card already', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/memories': () => [],
      'POST /api/profile/understand': () => ({
        facts: [{ id: 'a', kind: 'work', text: 'sdm at amazon' }],
      }),
    });
    renderApp(
      <AboutYou
        initial={{
          name: 'George',
          about,
          facts: [{ id: 'w', kind: 'work', text: 'SDM at Amazon' }],
        }}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Lay it out as cards' }));
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(screen.getAllByRole('button', { name: 'SDM at Amazon' })).toHaveLength(1);
  });
});
