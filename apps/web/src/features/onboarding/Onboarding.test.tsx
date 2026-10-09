import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { here } from '../../app/navigation';
import { appState, baseEngine, baseProviders, mockFetch, renderApp } from '../../test/harness';
import { Onboarding } from './Onboarding';

/**
 * The welcome (ADR 0068): three calm screens. Hello and a name, a mind to
 * think with, somewhere to start. What it saves as it goes, what can wait,
 * the way back, and where it ends. What it no longer asks is offered on the
 * new chat (`BringHints.test.tsx`).
 */

vi.setConfig({ testTimeout: 20_000 });
beforeEach(() => sessionStorage.clear());
afterEach(() => vi.unstubAllGlobals());

/** No provider ready yet, so the mind step waits for the person. */
const noneReady = {
  ...baseProviders,
  providers: baseProviders.providers.map((p) => ({ ...p, active: false })),
};

/** The history entry's state when the welcome was marked done. */
let landedWith: unknown;

/** The first agent (ADR 0101), as the gateway makes it from the personality. */
const first = {
  id: 'ag_conch',
  name: 'Conch',
  role: '',
  avatar: { kind: 'preset', id: 'shell' },
  persona: { tone: 'warm', personality: '' },
  instructions: '',
  isDefault: true,
  order: 0,
  createdAt: 1,
  updatedAt: 1,
};

function routes(extra: Record<string, (body: unknown) => unknown> = {}) {
  // What the gateway keeps: each save lands on top of the last, as it would.
  let saved = appState({ onboarded: false, profile: { name: '', about: '', facts: [] } });
  return mockFetch({
    'GET /api/state': () => saved,
    'GET /api/agents': () => ({ agents: [first], defaultId: first.id }),
    'GET /api/engine': () => baseEngine,
    'GET /api/providers': () => noneReady,
    'GET /api/import': () => ({ sources: [] }),
    'PATCH /api/settings': (body) => {
      // Where the app was when the welcome was marked done: the chat opens from there.
      if ((body as { onboarded?: boolean }).onboarded) landedWith = here()?.state;
      return (saved = { ...saved, ...(body as object) });
    },
    ...extra,
  });
}

const patched = (calls: ReturnType<typeof routes>) =>
  calls.filter((c) => c.method === 'PATCH').map((c) => c.body);

const clean = async (container: HTMLElement) =>
  (await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })).violations;

describe('the welcome', () => {
  it('asks the basics, saving each as it goes, and ends somewhere to start', async () => {
    const calls = routes();
    const user = userEvent.setup();
    const { container } = renderApp(<Onboarding />);

    // Hello and a name together: who it is, where things are kept, and what to call you.
    expect(await screen.findByRole('heading', { name: 'Hi, I’m Conch.' })).toBeInTheDocument();
    expect(screen.getByText(/Everything stays on this computer/)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Step 1 of 3' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
    const name = screen.getByRole('textbox', { name: 'Your name' });
    expect(name).toHaveFocus();
    expect(await clean(container)).toEqual([]);
    await user.type(name, 'Ada{Enter}');
    await waitFor(() =>
      expect(patched(calls)).toContainEqual({
        profile: expect.objectContaining({ name: 'Ada', about: '' }),
      }),
    );

    // A mind to think with: nothing ready here, so it can wait.
    expect(
      await screen.findByRole('heading', { name: 'Now, a mind to think with.' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Step 2 of 3' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'I’ll do this later' }));

    // Ready: by name, with three things to ask first. Nothing else was asked on the way.
    expect(
      await screen.findByRole('heading', { name: 'You’re all set, Ada.' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Step 3 of 3' })).toBeInTheDocument();
    expect(await clean(container)).toEqual([]);
    const starters = screen.getByRole('list', { name: 'Something to ask first' });
    expect(within(starters).getAllByRole('button')).toHaveLength(3);
    expect(patched(calls)).not.toContainEqual({ onboarded: true });
    // The first agent keeps the name and voice it came with: Settings → Agents changes them.
    expect(calls.some((c) => c.path.startsWith('/api/agents/'))).toBe(false);
    await user.click(within(starters).getByRole('button', { name: 'Help me plan my week' }));
    await waitFor(() => expect(patched(calls)).toContainEqual({ onboarded: true }));
    // The chat that replaces the welcome finds the words already waiting for its composer.
    expect(landedWith).toEqual({ draft: 'Help me plan my week' });
  });

  it('can skip the name and the mind, and still ends ready', async () => {
    const calls = routes();
    const user = userEvent.setup();
    renderApp(<Onboarding />);
    await user.click(await screen.findByRole('button', { name: 'Let’s begin' }));
    await user.click(await screen.findByRole('button', { name: 'I’ll do this later' }));
    expect(await screen.findByRole('heading', { name: 'You’re all set.' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open Conch' }));
    await waitFor(() => expect(patched(calls)).toContainEqual({ onboarded: true }));
  });

  it('goes back a step, with what was typed still there', async () => {
    routes();
    const user = userEvent.setup();
    renderApp(<Onboarding />);
    await user.type(await screen.findByRole('textbox', { name: 'Your name' }), 'Ada{Enter}');
    await screen.findByRole('heading', { name: 'Now, a mind to think with.' });
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('textbox', { name: 'Your name' })).toHaveValue('Ada');
  });

  it('carries on by itself once a provider is ready', async () => {
    routes({ 'GET /api/providers': () => baseProviders });
    const user = userEvent.setup();
    renderApp(<Onboarding />);
    await user.click(await screen.findByRole('button', { name: 'Let’s begin' }));
    await screen.findByRole('heading', { name: 'Now, a mind to think with.' });
    expect(screen.queryByRole('button', { name: 'I’ll do this later' })).not.toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: 'You’re all set.' }, { timeout: 5000 }),
    ).toBeInTheDocument();
  });

  it('starts from what an earlier welcome kept in About you', async () => {
    routes({
      'GET /api/state': () =>
        appState({
          onboarded: false,
          profile: {
            name: 'Ada',
            about: 'I’d mostly like a hand with email and my calendar.',
            facts: [],
          },
        }),
    });
    const user = userEvent.setup();
    renderApp(<Onboarding />);
    // Replay welcome: the name is already there.
    expect(await screen.findByRole('textbox', { name: 'Your name' })).toHaveValue('Ada');
    await user.click(screen.getByRole('button', { name: 'Let’s begin' }));
    await user.click(await screen.findByRole('button', { name: 'I’ll do this later' }));
    const starters = await screen.findByRole('list', { name: 'Something to ask first' });
    expect(
      within(starters).getByRole('button', { name: 'What needs my attention in my inbox today?' }),
    ).toBeInTheDocument();
  });

  it('never stops to offer imports: those wait on the new chat', async () => {
    routes({
      'GET /api/import': () => ({
        sources: [{ id: 'openclaw', label: 'OpenClaw', summary: '3 memories', path: '/x' }],
      }),
    });
    const user = userEvent.setup();
    renderApp(<Onboarding />);
    expect(await screen.findByRole('list', { name: 'Step 1 of 3' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Let’s begin' }));
    await user.click(await screen.findByRole('button', { name: 'I’ll do this later' }));
    expect(await screen.findByRole('heading', { name: 'You’re all set.' })).toBeInTheDocument();
    expect(screen.queryByText(/OpenClaw/)).not.toBeInTheDocument();
  });
});
