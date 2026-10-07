/** Who does a routine (ADR 0101): chosen in its editor, shown on its card and its page. */
import type { Agent, Routine, RoutineDetail } from '@conch/protocol';
import { configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appState, mockFetch, renderApp } from '../../test/harness';
import { RoutineDetailView } from './RoutineDetailView';
import { RoutineEditor } from './RoutineEditor';
import { RoutinesView } from './RoutinesView';

configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 20_000 });
afterEach(() => vi.unstubAllGlobals());

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

const agents = [
  agent({ id: 'ag_conch', name: 'Conch', isDefault: true }),
  agent({
    id: 'ag_atlas',
    name: 'Atlas',
    role: 'Plans trips',
    avatar: { kind: 'preset', id: 'compass' },
    order: 1,
  }),
];

const routine = (extra: Partial<Routine> = {}): Routine => ({
  id: 'r_1',
  title: 'Morning briefing',
  summary: '',
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
  runCount: 0,
  ...extra,
});

const base = (list: Agent[] = agents) => ({
  'GET /api/state': () => appState(),
  'GET /api/agents': () => ({ agents: list, defaultId: 'ag_conch' }),
  'GET /api/routines': () => [],
  'POST /api/routines/preview': () => ({ valid: true, text: 'Every day at 9:00 AM', next: [] }),
});

describe('who does a routine', () => {
  it('is chosen in the editor with the chat’s picker, the default agent first', async () => {
    const user = userEvent.setup();
    const calls = mockFetch({
      ...base(),
      'POST /api/routines': (body) => routine({ ...(body as object), id: 'r_new' }),
    });
    renderApp(<RoutineEditor open draft={{}} onOpenChange={() => {}} />);
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Morning briefing');
    await user.type(
      screen.getByRole('textbox', { name: 'What should Conch do?' }),
      'Summarise my day.',
    );
    const picker = await screen.findByRole('button', {
      name: 'Answered by Default agent. Choose another agent',
    });
    expect(screen.getByText('Whichever agent is your default when it runs.')).toBeVisible();
    await user.click(picker);
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText('Answer with')).toBeVisible();
    expect(within(menu).getByRole('menuitemradio', { name: /Default agent/ })).toBeChecked();
    expect(within(menu).getByRole('menuitemradio', { name: /Default agent/ })).toHaveTextContent(
      'Conch, while it’s the default',
    );
    await user.click(within(menu).getByRole('menuitemradio', { name: /Atlas/ }));
    expect(
      screen.getByRole('button', { name: 'Answered by Atlas. Choose another agent' }),
    ).toBeVisible();
    expect(
      screen.getByText('Atlas does it, in its own voice and with its own instructions.'),
    ).toBeVisible();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Turn on' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Turn on' }));
    await waitFor(() =>
      expect(
        calls.find((c) => c.method === 'POST' && c.path === '/api/routines')?.body,
      ).toMatchObject({ agentId: 'ag_atlas' }),
    );
  });

  it('goes back to the default agent as `null` when edited', async () => {
    const user = userEvent.setup();
    const own = routine({ agentId: 'ag_atlas' });
    const calls = mockFetch({
      ...base(),
      'PATCH /api/routines/r_1': () => routine(),
    });
    const { container } = renderApp(<RoutineEditor open routine={own} onOpenChange={() => {}} />);
    await user.click(
      await screen.findByRole('button', { name: 'Answered by Atlas. Choose another agent' }),
    );
    await user.click(await screen.findByRole('menuitemradio', { name: /Default agent/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({ agentId: null }),
    );
    expect(
      (await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })).violations,
    ).toEqual([]);
  });

  it('a routine with an agent that’s gone shows the default agent', async () => {
    mockFetch(base());
    renderApp(
      <RoutineEditor open routine={routine({ agentId: 'ag_gone' })} onOpenChange={() => {}} />,
    );
    expect(
      await screen.findByRole('button', { name: /Answered by Default agent/ }),
    ).toBeInTheDocument();
  });

  it('isn’t asked with only one agent', async () => {
    mockFetch(base(agents.slice(0, 1)));
    renderApp(<RoutineEditor open draft={{}} onOpenChange={() => {}} />);
    await screen.findByRole('textbox', { name: 'Name' });
    // Give the agents a moment to arrive; still nothing to choose.
    await waitFor(() => expect(screen.getByText('Model')).toBeVisible());
    expect(screen.queryByText('Answered by')).toBeNull();
  });

  it('shows on its card only when it isn’t the default, and on its page always', async () => {
    mockFetch({
      ...base(),
      'GET /api/routines': () => [
        routine({ agentId: 'ag_atlas' }),
        routine({ id: 'r_2', title: 'Water the plants' }),
      ],
    });
    renderApp(<RoutinesView />);
    const atlas = await screen.findByRole('article', { name: 'Morning briefing' });
    await waitFor(() => expect(atlas).toHaveTextContent('Answered by Atlas'));
    expect(screen.getByRole('article', { name: 'Water the plants' })).not.toHaveTextContent(
      'Answered by',
    );
  });

  it('says who does it under its name on its page', async () => {
    const detail: RoutineDetail = { routine: routine(), runs: [] };
    mockFetch({ ...base(), 'GET /api/routines/r_1': () => detail });
    renderApp(<RoutineDetailView routineId="r_1" />, { route: '/routines/r_1' });
    await screen.findByRole('heading', { name: 'Morning briefing', level: 1 });
    await waitFor(() =>
      expect(screen.getByText(/Every day at 8:00 AM/)).toHaveTextContent('Answered by Conch'),
    );
  });
});
