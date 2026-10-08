import type { Agent } from '@conch/protocol';
import { Toaster } from '@conch/nacre';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUi } from '../../app/ui';
import { appState, mockFetch, renderApp } from '../../test/harness';
import { Settings } from '../settings/Settings';
import { useHiddenAgents } from './hidden';

/**
 * Settings → Agents (ADR 0101): the wall of faces, an agent's own page that
 * saves itself, and deleting one with a moment to change your mind.
 */

vi.setConfig({ testTimeout: 20_000 });
afterEach(() => {
  vi.unstubAllGlobals();
  act(() => {
    useUi.setState({ settingsFocus: undefined });
    useHiddenAgents.setState({ ids: [] });
  });
});

const agent = (patch: Partial<Agent> & Pick<Agent, 'id' | 'name'>): Agent => ({
  role: '',
  avatar: { kind: 'preset', id: 'shell' },
  persona: { tone: 'warm', personality: '' },
  instructions: '',
  isDefault: false,
  order: 0,
  createdAt: 1,
  updatedAt: 1,
  ...patch,
});

function routes() {
  let agents = [
    agent({ id: 'ag_conch', name: 'Conch', isDefault: true }),
    agent({
      id: 'ag_atlas',
      name: 'Atlas',
      role: 'Plans trips',
      avatar: { kind: 'preset', id: 'compass' },
      order: 1,
    }),
  ];
  const calls = mockFetch({
    'GET /api/state': () => appState({ profile: { name: 'Ada', about: '', facts: [] } }),
    'GET /api/agents': () => ({ agents, defaultId: 'ag_conch' }),
    'GET /api/agents/avatar/generate': () => ({ available: false }),
    'PATCH /api/agents/ag_atlas': (body) => {
      const change = body as Partial<Agent>;
      agents = agents.map((a) => (a.id === 'ag_atlas' ? { ...a, ...change } : a));
      return agents[1];
    },
  });
  return calls;
}

const patches = (calls: { method: string; path: string; body: unknown }[]) =>
  calls.filter((c) => c.method === 'PATCH' && c.path === '/api/agents/ag_atlas').map((c) => c.body);

async function axeClean(container: HTMLElement) {
  const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
  return result.violations.map((v) => v.id);
}

describe('Settings → Agents', () => {
  it('is a wall of faces; a press opens one, whose page saves itself', async () => {
    const calls = routes();
    const { where, container } = renderApp(<Settings />, { route: '/settings/agents' });
    const wall = await screen.findByRole('list', { name: 'Your agents' });
    expect(within(wall).getByRole('button', { name: 'Conch, default' })).toBeVisible();
    expect(within(wall).getByRole('button', { name: 'New agent' })).toBeVisible();
    expect(await axeClean(container)).toEqual([]);

    await userEvent.click(within(wall).getByRole('button', { name: 'Atlas' }));
    expect(where()).toBe('/settings/agents/ag_atlas');
    const name = await screen.findByRole('textbox', { name: 'Name' });
    expect(name).toHaveValue('Atlas');
    expect(await axeClean(container)).toEqual([]);

    // A name being retyped waits: empty says so, and nothing is saved.
    await userEvent.clear(name);
    expect(screen.getByText('It needs a name.')).toBeVisible();
    await act(() => new Promise((resolve) => setTimeout(resolve, 800)));
    expect(patches(calls)).toEqual([]);
    expect(screen.queryByText('Couldn’t save')).toBeNull();
    // Another agent's name is said too.
    await userEvent.type(name, 'conch');
    expect(screen.getByText('You already have an agent called conch.')).toBeVisible();

    // A good one saves a moment later, and says so.
    await userEvent.clear(name);
    await userEvent.type(name, 'Sage');
    await waitFor(() => expect(patches(calls)).toHaveLength(1));
    expect(patches(calls)[0]).toMatchObject({ name: 'Sage', role: 'Plans trips' });
    expect(await screen.findByText('Saved')).toBeVisible();

    // A tone is a press, heard in its voice.
    await userEvent.click(screen.getByRole('radio', { name: 'Calm' }));
    expect(await screen.findByText(/Hi Ada, I’m Sage\. No rush/)).toBeVisible();
    await waitFor(() =>
      expect(patches(calls).at(-1)).toMatchObject({ persona: { tone: 'calm', personality: '' } }),
    );

    // A face is saved at once.
    await userEvent.click(screen.getByRole('radio', { name: 'Owl' }));
    await waitFor(() =>
      expect(patches(calls).at(-1)).toEqual({ avatar: { kind: 'preset', id: 'owl' } }),
    );
  });

  it('opens an agent by name from anywhere (⌘K, the picker)', async () => {
    routes();
    const { where } = renderApp(<Settings />, { route: '/settings/agents' });
    await screen.findByRole('list', { name: 'Your agents' });
    act(() => useUi.getState().openSettings('agents', 'ag_atlas'));
    await waitFor(() => expect(where()).toBe('/settings/agents/ag_atlas'));
    expect(await screen.findByRole('textbox', { name: 'Name' })).toHaveValue('Atlas');
  });

  it('deletes with Undo, and tells the gateway nothing until Undo has gone', async () => {
    const calls = routes();
    renderApp(
      <>
        <Settings />
        <Toaster />
      </>,
      { route: '/settings/agents' },
    );
    const wall = await screen.findByRole('list', { name: 'Your agents' });
    await userEvent.click(within(wall).getByRole('button', { name: 'More for Atlas' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(within(wall).queryByRole('button', { name: 'Atlas' })).toBeNull());
    // The toast sits beside Settings' modal page, which jsdom reads as unreachable.
    const press = userEvent.setup({ pointerEventsCheck: 0 });
    await press.click(await screen.findByRole('button', { name: 'Undo' }));
    await within(wall).findByRole('button', { name: 'Atlas' });
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
    expect(
      within(screen.getByRole('list', { name: 'Your agents' })).getByRole('button', {
        name: 'Atlas',
      }),
    ).toBeVisible();
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });
});

describe('long instructions (ADR 0101)', () => {
  const handbook = 'Keep every reply short. '.repeat(1_500).trim();

  it('are shown whole, with a quiet word under them, never a cut', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/agents': () => ({
        agents: [
          agent({ id: 'ag_james', name: 'James Claw', isDefault: true, instructions: handbook }),
        ],
        defaultId: 'ag_james',
      }),
      'GET /api/agents/avatar/generate': () => ({ available: false }),
    });
    const { container } = renderApp(<Settings />, { route: '/settings/agents/ag_james' });
    const box = await screen.findByRole('textbox', { name: 'Instructions' });
    expect((box as HTMLTextAreaElement).value).toBe(handbook);
    expect(box).toHaveAccessibleDescription(
      'These instructions are long (≈9k tokens). Every reply carries them, so small models may struggle.',
    );
    expect(box).not.toHaveAttribute('maxlength', '8000');
    expect(await axeClean(container)).toEqual([]);
  });

  it('offers the rest of one an older Conch cut short, and brings it in with a press', async () => {
    const start = 'Rule one: tidy the inbox.';
    const whole = `${start}\n\nRule two: say what you moved.`;
    let agents = [
      agent({
        id: 'ag_james',
        name: 'James Claw',
        isDefault: true,
        instructions: start,
        imported: { from: 'openclaw', id: 'main', at: 1 },
      }),
    ];
    let rest = [
      {
        agentId: 'ag_james',
        name: 'James Claw',
        source: 'openclaw',
        label: 'OpenClaw',
        chars: 29,
        review: false,
      },
    ];
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/agents': () => ({ agents, defaultId: 'ag_james' }),
      'GET /api/agents/avatar/generate': () => ({ available: false }),
      'GET /api/import/rest': () => ({ agents: rest }),
      'POST /api/import/rest/ag_james': () => {
        agents = agents.map((a) => ({ ...a, instructions: whole }));
        rest = [];
        return agents[0];
      },
      'PATCH /api/agents/ag_james': () => agents[0],
    });
    renderApp(
      <>
        <Settings />
        <Toaster />
      </>,
      { route: '/settings/agents/ag_james' },
    );
    expect(await screen.findByText('The end of its instructions stayed in OpenClaw')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Bring the rest in' }));
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Instructions' })).toHaveValue(whole),
    );
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/import/rest/ag_james')).toBe(
      true,
    );
    await waitFor(() =>
      expect(screen.queryByText('The end of its instructions stayed in OpenClaw')).toBeNull(),
    );
  });
});
