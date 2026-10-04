import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { here } from '../../app/navigation';
import { appState, baseEngine, baseProviders, mockFetch, renderApp } from '../../test/harness';
import { Onboarding } from './Onboarding';

/**
 * The welcome (ADR 0068): the basics, one calm thing at a time. What it saves
 * as it goes, what can be skipped, the way back, and where it ends.
 */

vi.setConfig({ testTimeout: 20_000 });
beforeEach(() => sessionStorage.clear());
afterEach(() => vi.unstubAllGlobals());

/** No provider ready yet, so the mind step waits for the person. */
const noneReady = {
  ...baseProviders,
  providers: baseProviders.providers.map((p) => ({ ...p, active: false })),
};

const catalog = ['github', 'gmail', 'notion', 'slack', 'linear', 'todoist', 'google-calendar'].map(
  (id) => ({
    id,
    name: id === 'github' ? 'GitHub' : id[0]?.toUpperCase() + id.slice(1),
    tagline: '',
    description: '',
    category: 'productivity',
    auth: id === 'gmail' || id === 'google-calendar' ? 'google' : 'oauth',
    local: false,
    fields: [],
    steps: [],
    examples: [],
    access: [],
    featured: true,
  }),
);

/** The history entry's state when the welcome was marked done. */
let landedWith: unknown;

function routes(extra: Record<string, (body: unknown) => unknown> = {}) {
  // What the gateway keeps: each save lands on top of the last, as it would.
  let saved = appState({ onboarded: false, profile: { name: '', about: '' } });
  return mockFetch({
    'GET /api/state': () => saved,
    'GET /api/engine': () => baseEngine,
    'GET /api/providers': () => noneReady,
    'GET /api/import': () => ({ sources: [] }),
    'GET /api/integrations': () => ({ catalog, integrations: [], providers: [] }),
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

    // Hello: who it is, and where things are kept.
    expect(await screen.findByRole('heading', { name: 'Hi, I’m Conch.' })).toBeInTheDocument();
    expect(screen.getByText(/Everything stays on this computer/)).toBeInTheDocument();
    expect(await clean(container)).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Let’s begin' }));

    // A name, typed large, and Enter.
    const name = await screen.findByRole('textbox', { name: 'Your name' });
    expect(name).toHaveFocus();
    expect(screen.getByRole('list', { name: 'Step 1 of 5' })).toBeInTheDocument();
    await user.type(name, 'Ada{Enter}');
    expect(patched(calls)).toContainEqual({ profile: { name: 'Ada', about: '' } });

    // What you'd like a hand with: tapped, then written into About you as one sentence.
    expect(
      await screen.findByRole('heading', { name: 'Nice to meet you, Ada.' }),
    ).toBeInTheDocument();
    const help = screen.getByRole('group', { name: 'What you’d like a hand with' });
    await user.click(within(help).getByRole('button', { name: 'Coding' }));
    await user.click(within(help).getByRole('button', { name: 'Email and calendar' }));
    expect(await clean(container)).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() =>
      expect(patched(calls)).toContainEqual({
        profile: {
          name: 'Ada',
          about: 'I’d mostly like a hand with coding and email and my calendar.',
        },
      }),
    );

    // How it should sound: hearing a voice is choosing it.
    expect(await screen.findByRole('heading', { name: 'How should I sound?' })).toBeInTheDocument();
    expect(await screen.findByText(/Lovely to meet you, Ada/)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Concise' }));
    expect(await screen.findByText(/Hi Ada\. Ready when you are\./)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sounds good' }));
    await waitFor(() =>
      expect(patched(calls)).toContainEqual({
        persona: { name: 'Conch', tone: 'concise', instructions: '' },
      }),
    );

    // A mind to think with: nothing ready here, so it can wait.
    expect(
      await screen.findByRole('heading', { name: 'Now, a mind to think with.' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'I’ll do this later' }));

    // Apps: what the picks call for first, and never one that needs a Google Cloud project.
    const apps = await screen.findByRole('list', { name: 'Apps to connect' });
    const tiles = within(apps)
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(tiles.slice(0, 2)).toEqual(['GitHub', 'Gmail']);
    expect(tiles).not.toContain('Google-calendar');
    expect(await clean(container)).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));

    // Ready: by name, with three things to ask first made from the picks.
    expect(
      await screen.findByRole('heading', { name: 'You’re all set, Ada.' }),
    ).toBeInTheDocument();
    const starters = screen.getByRole('list', { name: 'Something to ask first' });
    expect(within(starters).getAllByRole('button')).toHaveLength(3);
    expect(
      within(starters).getByRole('button', { name: 'What needs my attention in my inbox today?' }),
    ).toBeInTheDocument();
    expect(patched(calls)).not.toContainEqual({ onboarded: true });
    await user.click(within(starters).getByRole('button', { name: 'Help me plan my week' }));
    await waitFor(() => expect(patched(calls)).toContainEqual({ onboarded: true }));
    // The chat that replaces the welcome finds the words already waiting for its composer.
    expect(landedWith).toEqual({ draft: 'Help me plan my week' });
  });

  it('can skip everything but the hello, and still ends ready', async () => {
    const calls = routes();
    const user = userEvent.setup();
    renderApp(<Onboarding />);
    await user.click(await screen.findByRole('button', { name: 'Let’s begin' }));
    await user.click(await screen.findByRole('button', { name: 'Skip' }));
    expect(await screen.findByRole('heading', { name: 'Nice to meet you.' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    await user.click(await screen.findByRole('button', { name: 'Sounds good' }));
    await user.click(await screen.findByRole('button', { name: 'I’ll do this later' }));
    await user.click(await screen.findByRole('button', { name: 'Skip for now' }));
    expect(await screen.findByRole('heading', { name: 'You’re all set.' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open Conch' }));
    await waitFor(() => expect(patched(calls)).toContainEqual({ onboarded: true }));
  });

  it('goes back a step, with what was typed still there', async () => {
    routes();
    const user = userEvent.setup();
    renderApp(<Onboarding />);
    await user.click(await screen.findByRole('button', { name: 'Let’s begin' }));
    await user.type(await screen.findByRole('textbox', { name: 'Your name' }), 'Ada{Enter}');
    await screen.findByRole('heading', { name: 'Nice to meet you, Ada.' });
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('textbox', { name: 'Your name' })).toHaveValue('Ada');
  });

  it('carries on by itself once a provider is ready', async () => {
    routes({ 'GET /api/providers': () => baseProviders });
    const user = userEvent.setup();
    renderApp(<Onboarding />);
    await user.click(await screen.findByRole('button', { name: 'Let’s begin' }));
    await user.click(await screen.findByRole('button', { name: 'Skip' }));
    await user.click(await screen.findByRole('button', { name: 'Skip' }));
    await user.click(await screen.findByRole('button', { name: 'Sounds good' }));
    await screen.findByRole('heading', { name: 'Now, a mind to think with.' });
    expect(screen.queryByRole('button', { name: 'I’ll do this later' })).not.toBeInTheDocument();
    expect(
      await screen.findByRole(
        'heading',
        { name: 'Bring the apps you live in.' },
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();
  });

  it('offers to bring things from another assistant, only when there is one', async () => {
    routes({
      'GET /api/import': () => ({
        sources: [{ id: 'openclaw', label: 'OpenClaw', summary: '3 memories', path: '/x' }],
      }),
    });
    const user = userEvent.setup();
    renderApp(<Onboarding />);
    await user.click(await screen.findByRole('button', { name: 'Let’s begin' }));
    expect(await screen.findByRole('list', { name: 'Step 1 of 6' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    await user.click(await screen.findByRole('button', { name: 'Skip' }));
    await user.click(await screen.findByRole('button', { name: 'Sounds good' }));
    await user.click(await screen.findByRole('button', { name: 'I’ll do this later' }));
    await user.click(await screen.findByRole('button', { name: 'Skip for now' }));
    expect(
      await screen.findByRole('heading', { name: 'Bring your things from OpenClaw?' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    expect(await screen.findByRole('heading', { name: 'You’re all set.' })).toBeInTheDocument();
  });
});
