import type { Skill, SkillDetail, SkillsList } from '@conch/protocol';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appState, mockFetch, renderApp } from '../../test/harness';
import { NewSkill } from './NewSkill';
import { SkillDetailView } from './SkillDetailView';
import { SkillsView } from './SkillsView';

afterEach(() => vi.unstubAllGlobals());

const skill = (patch: Partial<Skill> & Pick<Skill, 'id' | 'name' | 'title'>): Skill => ({
  description: `${patch.title} does a thing. Use when asked.`,
  source: 'conch',
  sourceLabel: 'Conch',
  editable: true,
  mode: 'auto',
  path: `/home/ada/.conch/skills/${patch.name}`,
  files: [],
  updatedAt: 1,
  ...patch,
});

const weekly = skill({ id: 'weekly-review', name: 'weekly-review', title: 'Weekly review' });
const triage = skill({
  id: 'openclaw_gh-triage',
  name: 'gh-triage',
  title: 'GitHub triage',
  source: 'openclaw',
  sourceLabel: 'OpenClaw',
  editable: false,
  mode: 'off',
  path: '/home/ada/.openclaw/skills/gh-triage',
});

const list: SkillsList = {
  skills: [weekly, triage],
  sources: [
    { id: 'conch', label: 'Conch', path: '/home/ada/.conch/skills', found: true, count: 1 },
    {
      id: 'openclaw',
      label: 'OpenClaw',
      path: '/home/ada/.openclaw/skills',
      found: true,
      count: 1,
    },
  ],
};

function Where() {
  const location = useLocation();
  return <output aria-label="location">{location.pathname}</output>;
}

describe('Skills page', () => {
  it('shows yours first, then what other apps have (off), and finds one by name', async () => {
    mockFetch({ 'GET /api/state': () => appState(), 'GET /api/skills': () => list });
    renderApp(<SkillsView />, { route: '/skills' });
    const yours = await screen.findByRole('region', { name: 'Yours' });
    expect(within(yours).getByRole('article', { name: 'Weekly review' })).toBeInTheDocument();
    const found = screen.getByRole('region', { name: 'From other apps' });
    expect(within(found).getByText(/Found in OpenClaw/)).toBeInTheDocument();
    expect(within(found).getByRole('switch', { name: 'Turn on GitHub triage' })).not.toBeChecked();

    await userEvent.type(screen.getByRole('searchbox', { name: 'Find a skill' }), 'triage');
    const matches = screen.getByRole('list', { name: 'Matching skills' });
    expect(within(matches).getAllByRole('article')).toHaveLength(1);
    expect(within(matches).getByRole('article', { name: 'GitHub triage' })).toBeInTheDocument();
  });

  it('turns a skill on or off from its card', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/skills': () => list,
      'PATCH /api/skills/openclaw_gh-triage': () => ({
        ...triage,
        mode: 'auto',
        instructions: 'x',
      }),
    });
    renderApp(<SkillsView />, { route: '/skills' });
    await userEvent.click(await screen.findByRole('switch', { name: 'Turn on GitHub triage' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ mode: 'auto' }),
    );
  });

  it('invites you to teach one when there are none', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/skills': () => ({ skills: [], sources: [] }),
    });
    renderApp(<SkillsView />, { route: '/skills' });
    expect(await screen.findByRole('heading', { name: 'Teach Conch a skill' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Weekly review' })).toBeInTheDocument();
  });
});

describe('New skill', () => {
  it('writes the title and description as you pause, and keeps what you change', async () => {
    const created: SkillDetail = { ...weekly, instructions: 'Review my week.' };
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'POST /api/skills/draft': () => ({
        title: 'Weekly review',
        name: 'weekly-review',
        description: 'Drafts a weekly review from your calendar. Use when asked about the week.',
        generated: true,
      }),
      'POST /api/skills': () => created,
      'GET /api/skills/weekly-review': () => created,
    });
    renderApp(
      <>
        <Routes>
          <Route path="/skills/new" element={<NewSkill />} />
          <Route path="/skills/:id" element={<p>Opened</p>} />
        </Routes>
        <Where />
      </>,
      { route: '/skills/new' },
    );
    const box = await screen.findByRole('textbox', { name: /know how to do/ });
    await userEvent.type(box, 'Every Friday, review my calendar and notes from the week.');
    // The preview shimmers, then the words land in the fields.
    expect(
      await screen.findByDisplayValue('Weekly review', {}, { timeout: 4000 }),
    ).toBeInTheDocument();
    expect(
      screen.getByDisplayValue(/Drafts a weekly review from your calendar/),
    ).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Weekly review' })).toHaveTextContent(
      '/weekly-review',
    );

    // Your own title wins over the one written for you.
    const title = screen.getByRole('textbox', { name: 'Title' });
    await userEvent.clear(title);
    await userEvent.type(title, 'Friday review');
    await userEvent.click(screen.getByRole('radio', { name: 'When I ask' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create skill' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST' && c.path === '/api/skills')?.body).toEqual({
        instructions: 'Every Friday, review my calendar and notes from the week.',
        title: 'Friday review',
        description: 'Drafts a weekly review from your calendar. Use when asked about the week.',
        mode: 'manual',
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'location' })).toHaveTextContent(
        '/skills/weekly-review',
      ),
    );
  });
});

describe('One skill', () => {
  it('lets you copy another app’s skill to edit it, and choose when it’s used', async () => {
    const detail: SkillDetail = { ...triage, instructions: 'Run gh issue list.' };
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/skills/openclaw_gh-triage': () => detail,
      'PATCH /api/skills/openclaw_gh-triage': () => ({ ...detail, mode: 'manual' }),
      'POST /api/skills/openclaw_gh-triage/copy': () => ({
        ...detail,
        id: 'gh-triage',
        source: 'conch',
        sourceLabel: 'Conch',
        editable: true,
      }),
    });
    renderApp(<SkillDetailView skillId="openclaw_gh-triage" />, {
      route: '/skills/openclaw_gh-triage',
    });
    expect(await screen.findByText('Run gh issue list.')).toBeInTheDocument();
    expect(screen.getByText(/Conch reads this folder but never changes it/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'When I ask' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ mode: 'manual' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Make a copy to edit' }));
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/api/skills/openclaw_gh-triage/copy')).toBe(true),
    );
  });
});
