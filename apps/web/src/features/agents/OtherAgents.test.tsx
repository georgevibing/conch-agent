import type { Agent, McpOverview, OutsideAgent } from '@conch/protocol';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appState, mockFetch, renderApp } from '../../test/harness';
import { Settings } from '../settings/Settings';

/**
 * Settings → Agents → other agents (ADR 0112): one paste adds an outside
 * agent; letting another agent in to yours is a pairing with its key shown once.
 */

vi.setConfig({ testTimeout: 20_000 });
afterEach(() => vi.unstubAllGlobals());

const sage: Agent = {
  id: 'ag_conch',
  name: 'Sage',
  role: 'Plans trips',
  avatar: { kind: 'preset', id: 'shell' },
  persona: { tone: 'warm', personality: '' },
  instructions: '',
  isDefault: true,
  order: 0,
  createdAt: 1,
  updatedAt: 1,
};

const overview: McpOverview = {
  clients: [],
  targets: [],
  remote: false,
  choices: [],
  endpoint: 'http://127.0.0.1:4317/mcp',
};

function routes() {
  let outside: OutsideAgent[] = [];
  const calls = mockFetch({
    'GET /api/state': () => appState(),
    'GET /api/agents': () => ({ agents: [sage], defaultId: 'ag_conch' }),
    'GET /api/agents/avatar/generate': () => ({ available: false }),
    'GET /api/agents/outside': () => ({ agents: outside }),
    'POST /api/agents/outside/look': () => ({
      name: 'Travel Agent',
      description: 'Finds flights',
      skills: [{ name: 'Flights', description: '' }],
      by: 'Example Travel',
      host: 'agents.example.com',
      protocol: '1.0',
      private: false,
      needsKey: false,
      keyed: false,
    }),
    'POST /api/agents/outside': () => {
      const added: OutsideAgent = {
        id: 'oa_travel1',
        name: 'Travel Agent',
        description: 'Finds flights',
        card: 'https://agents.example.com/.well-known/agent-card.json',
        endpoint: 'https://agents.example.com/a2a',
        protocol: '1.0',
        skills: [],
        keyed: false,
        private: false,
        addedAt: 1,
      };
      outside = [added];
      return added;
    },
    'GET /api/mcp': () => overview,
    'GET /api/access': () => ({ method: 'none', suggestedUsername: 'ada', keys: [], passkeys: [] }),
    'POST /api/mcp/clients': () => ({
      client: {
        id: 'mcpc_peer',
        name: 'Ana’s assistant',
        app: 'other',
        scopes: ['agent:ag_conch'],
        createdAt: 1,
        http: true,
        remote: false,
      },
      setup: {
        command: 'node',
        args: [],
        json: '{}',
        url: 'http://127.0.0.1:4317/mcp',
        key: 'cmcp.mcpc_peer.' + 'k'.repeat(43),
      },
    }),
  });
  return calls;
}

describe('Settings → Agents → other agents', () => {
  it('adds an outside agent from one paste, showing what it says before it’s added', async () => {
    const calls = routes();
    renderApp(<Settings />, { route: '/settings/agents' });
    const box = await screen.findByRole('textbox', { name: 'Add an outside agent' });
    await userEvent.click(box);
    await userEvent.paste('https://agents.example.com');
    const found = await screen.findByRole('region', {
      name: 'Travel Agent, found at agents.example.com',
    });
    expect(within(found).getByText('It says it’s run by Example Travel.')).toBeVisible();
    await userEvent.click(within(found).getByRole('button', { name: 'Add Travel Agent' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path === '/api/agents/outside')).toBe(true),
    );
    const list = await screen.findByRole('list', { name: 'Outside agents' });
    expect(within(list).getByText('Travel Agent')).toBeVisible();
  });

  it('lets another agent in to yours, words only, and shows its address and key once', async () => {
    const calls = routes();
    renderApp(<Settings />, { route: '/settings/agents' });
    await userEvent.click(await screen.findByRole('button', { name: 'Let another agent in' }));
    const dialog = await screen.findByRole('dialog', { name: 'Let another agent in' });
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Whose agent is it?' }),
      'Ana’s assistant',
    );
    expect(within(dialog).getByRole('checkbox', { name: /Sage/ })).toBeChecked();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Let it in' }));
    expect(await within(dialog).findByText(/Another Conch takes it in one paste/)).toBeVisible();
    const pair = calls.find((c) => c.method === 'POST' && c.path === '/api/mcp/clients');
    expect(pair?.body).toEqual({
      app: 'other',
      name: 'Ana’s assistant',
      scopes: ['agent:ag_conch'],
      http: true,
      remote: false,
    });
  });
});
