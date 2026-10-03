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
  permissions: {
    declared: true,
    capabilities: ['commands'],
    commands: ['gh'],
    words: ['run commands (only `gh`)'],
  },
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
    // One from another app says what it can do first (ADR 0031).
    const ask = await screen.findByRole('alertdialog', { name: 'Turn on GitHub triage?' });
    expect(within(ask).getByRole('region', { name: 'This skill can:' })).toHaveTextContent(
      'run commands (only gh)',
    );
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
    await userEvent.click(within(ask).getByRole('button', { name: 'Turn it on' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ mode: 'auto' }),
    );
  });

  it('your own turn on and off straight away', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/skills': () => ({ ...list, skills: [{ ...weekly, mode: 'off' }, triage] }),
      'PATCH /api/skills/weekly-review': () => ({ ...weekly, instructions: 'x' }),
    });
    renderApp(<SkillsView />, { route: '/skills' });
    await userEvent.click(await screen.findByRole('switch', { name: 'Turn on Weekly review' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ mode: 'auto' }),
    );
    expect(screen.queryByRole('alertdialog')).toBeNull();
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

describe('Write it for me', () => {
  const STEPS = [
    'Review the week.',
    '',
    '## Steps',
    '1. Read the calendar.',
    '2. Write the review.',
  ].join('\n');
  const page = () =>
    renderApp(
      <Routes>
        <Route path="/skills/new" element={<NewSkill />} />
        <Route path="/settings/providers" element={<p>Providers</p>} />
      </Routes>,
      { route: '/skills/new' },
    );

  it('writes the whole skill from a sentence, and your own words are one press away', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'POST /api/skills/draft': () => ({
        title: 'Friday thing',
        name: 'friday-thing',
        description: 'Does a Friday thing. Use when asked.',
        generated: true,
      }),
      'POST /api/skills/write': () => ({
        instructions: STEPS,
        title: 'Weekly review',
        name: 'weekly-review',
        description: 'Drafts a weekly review from your calendar. Use when asked about the week.',
        generated: true,
        noModel: false,
      }),
    });
    page();
    const box = await screen.findByRole('textbox', { name: /know how to do/ });
    await userEvent.type(box, 'review my week on fridays');
    await userEvent.click(screen.getByRole('button', { name: 'Write the steps for me' }));
    expect(calls.find((c) => c.path === '/api/skills/write')?.body).toEqual({
      idea: 'review my week on fridays',
    });
    await waitFor(() => expect(box).toHaveValue(STEPS), { timeout: 4000 });
    expect(screen.getByDisplayValue('Weekly review')).toBeInTheDocument();
    expect(
      await screen.findByText('Conch wrote these from your words. Read them, and change anything.'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back to my words' }));
    expect(box).toHaveValue('review my week on fridays');
  });

  it('says what it needs when nothing can write, and keeps your words', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'POST /api/skills/write': () => ({
        instructions: 'tidy my downloads',
        title: 'Tidy my downloads',
        name: 'tidy-my-downloads',
        description: 'Tidy my downloads.',
        generated: false,
        noModel: true,
      }),
    });
    page();
    const box = await screen.findByRole('textbox', { name: /know how to do/ });
    await userEvent.type(box, 'tidy my downloads');
    await userEvent.click(screen.getByRole('button', { name: 'Write the steps for me' }));
    expect(
      await screen.findByText('Writing the steps needs a provider that can write'),
    ).toBeInTheDocument();
    expect(box).toHaveValue('tidy my downloads');
    await userEvent.click(screen.getByRole('button', { name: 'Connect one' }));
    expect(await screen.findByText('Providers')).toBeInTheDocument();
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
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Turn it on' }),
    );
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ mode: 'manual' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Make a copy to edit' }));
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/api/skills/openclaw_gh-triage/copy')).toBe(true),
    );
  });
});

describe('A skill that can’t be used yet', () => {
  const NO_DESCRIPTION = 'It has no description, so an assistant wouldn’t know when to use it.';
  const broken: SkillDetail = {
    ...skill({ id: 'tidy', name: 'tidy', title: 'Tidy' }),
    description: '',
    problem: NO_DESCRIPTION,
    problemKind: 'no-description',
    instructions: 'Sort the Downloads folder by type.',
  };

  it('writes the description for you, and one Save fixes it', async () => {
    const user = userEvent.setup();
    let saved: SkillDetail | undefined;
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/skills/tidy': () => saved ?? broken,
      'POST /api/skills/tidy/describe': () => ({
        description: 'Sorts the Downloads folder by type. Use when asked to tidy downloads.',
        from: 'model',
        noModel: false,
      }),
      'PATCH /api/skills/tidy': (body) => {
        const { description } = body as { description: string };
        saved = { ...broken, description, problem: undefined, problemKind: undefined };
        return saved;
      },
    });
    renderApp(<SkillDetailView skillId="tidy" />, { route: '/skills/tidy' });
    expect(await screen.findByText(NO_DESCRIPTION)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Write the description for me' }));
    const field = await screen.findByRole('textbox', {
      name: 'Description',
      description: /Written/,
    });
    expect(field).toHaveValue(
      'Sorts the Downloads folder by type. Use when asked to tidy downloads.',
    );
    await user.clear(field);
    await user.type(field, 'Sorts downloads. Use when asked to tidy.');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByText(NO_DESCRIPTION)).toBeNull());
    const patches = calls.filter((c) => c.method === 'PATCH');
    expect(patches.map((c) => c.body)).toEqual([
      { description: 'Sorts downloads. Use when asked to tidy.' },
    ]);
    // The details below show it too, and it isn't saved a second time.
    const details = screen.getAllByRole('textbox', { name: 'Description' });
    expect(details.at(-1)).toHaveValue('Sorts downloads. Use when asked to tidy.');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
  });

  it('says so when no model is connected, and lets you type it', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/skills/tidy': () => broken,
      'POST /api/skills/tidy/describe': () => ({
        description: 'Sort the Downloads folder by type.',
        from: 'text',
        noModel: true,
      }),
    });
    renderApp(<SkillDetailView skillId="tidy" />, { route: '/skills/tidy' });
    await user.click(await screen.findByRole('button', { name: 'Write the description for me' }));
    expect(
      await screen.findByRole('textbox', {
        name: 'Description',
        description: /No model is connected/,
      }),
    ).toHaveValue('Sort the Downloads folder by type.');
  });

  it('won’t edit another app’s skill where it lives, and offers a copy that can be fixed', async () => {
    const user = userEvent.setup();
    const theirs: SkillDetail = {
      ...broken,
      id: 'claude_tidy',
      source: 'claude',
      sourceLabel: 'Claude Code',
      editable: false,
      path: '/home/ada/.claude/skills/tidy',
    };
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/skills/claude_tidy': () => theirs,
      'POST /api/skills/claude_tidy/copy': () => ({ ...broken, id: 'tidy-2', name: 'tidy-2' }),
      'GET /api/skills/tidy-2': () => ({ ...broken, id: 'tidy-2', name: 'tidy-2' }),
    });
    renderApp(
      <Routes>
        <Route path="/skills/:id" element={<SkillDetailView skillId="claude_tidy" />} />
      </Routes>,
      { route: '/skills/claude_tidy' },
    );
    expect(
      await screen.findByText(/lives in Claude Code’s folder, and Conch won’t change it there/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Write the description for me' })).toBeNull();
    // One button, not two.
    expect(screen.queryByRole('button', { name: 'Make a copy to edit' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Make a copy I can edit' }));
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/api/skills/claude_tidy/copy')).toBe(true),
    );
    expect(calls.some((c) => c.path.endsWith('/describe'))).toBe(false);
  });

  it('offers to look again at a file it couldn’t read', async () => {
    const user = userEvent.setup();
    let fixed = false;
    const unreadable: SkillDetail = {
      ...broken,
      problem: 'SKILL.md is too big to read.',
      problemKind: 'unreadable',
    };
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/skills': () => {
        fixed = true;
        return list;
      },
      'GET /api/skills/tidy': () =>
        fixed ? { ...broken, description: 'Tidies.', problem: undefined } : unreadable,
    });
    renderApp(<SkillDetailView skillId="tidy" />, { route: '/skills/tidy' });
    await user.click(await screen.findByRole('button', { name: 'Look again' }));
    await waitFor(() => expect(screen.queryByText(/too big to read/)).toBeNull());
    expect(calls.some((c) => c.path === '/api/skills?refresh=1')).toBe(true);
  });
});

describe('Who made a skill, and what it can do (ADR 0031)', () => {
  const signed: SkillDetail = {
    ...triage,
    instructions: 'Run gh issue list.',
    signature: { state: 'untrusted', publisher: 'Ada', fingerprint: '3F9A 21C0 7B44 E1D2' },
  };

  it('shows what it can do on its page, and who signed it', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/skills/openclaw_gh-triage': () => signed,
    });
    renderApp(<SkillDetailView skillId="openclaw_gh-triage" />, {
      route: '/skills/openclaw_gh-triage',
    });
    expect(await screen.findByRole('region', { name: 'This skill can:' })).toHaveTextContent(
      'Anything else it tries asks you first',
    );
    expect(
      screen.getByRole('region', { name: 'Signed by Ada, who you haven’t said you trust' }),
    ).toHaveTextContent('3F9A 21C0 7B44 E1D2');
  });

  it('trusting a publisher says what it means, and asks that it’s you', async () => {
    const user = userEvent.setup();
    let verified = false;
    let trusted = false;
    const nowVerified = { ...signed, signature: { ...signed.signature, state: 'verified' } };
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/auth': () => ({
        method: 'password',
        signedIn: true,
        setupRequired: false,
        secure: true,
      }),
      'GET /api/access': () => ({}),
      'GET /api/skills/openclaw_gh-triage': () => (trusted ? nowVerified : signed),
      'GET /api/skills': () => list,
      'GET /api/skills/publishers': () => ({ publishers: [] }),
      'POST /api/skills/openclaw_gh-triage/trust-publisher': () =>
        verified
          ? ((trusted = true), nowVerified)
          : new Response(
              JSON.stringify({ error: 'verify-required', message: 'Confirm it’s you.' }),
              { status: 403 },
            ),
      'POST /api/access/verify': () => {
        verified = true;
        return {
          method: 'password',
          username: 'ada',
          suggestedUsername: 'ada',
          keys: [],
          passkeys: [],
          passkeysHere: false,
          sessions: [],
          devices: [],
          requests: [],
          approval: { on: false, here: true, canApprove: true },
          checkup: [],
          exposure: 'local',
          port: 4317,
          urls: [],
          verified: true,
        };
      },
    });
    renderApp(<SkillDetailView skillId="openclaw_gh-triage" />, {
      route: '/skills/openclaw_gh-triage',
    });
    await user.click(await screen.findByRole('button', { name: 'Trust this publisher…' }));
    const ask = await screen.findByRole('alertdialog', { name: 'Trust Ada?' });
    expect(ask).toHaveTextContent('anyone can call themselves Ada');
    await user.click(within(ask).getByRole('button', { name: 'Trust Ada' }));
    const confirm = await screen.findByRole('dialog', { name: 'Confirm it’s you' });
    await user.type(within(confirm).getByLabelText('Password'), 'purple otters juggle at dawn');
    await user.click(within(confirm).getByRole('button', { name: 'Confirm' }));
    await waitFor(() =>
      expect(calls.filter((c) => c.path.endsWith('/trust-publisher'))).toHaveLength(2),
    );
    expect(await screen.findByRole('region', { name: 'Verified: signed by Ada' })).toBeVisible();
  });

  it('a signature that doesn’t hold says why, and offers no trust', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/skills/openclaw_gh-triage': () => ({
        ...signed,
        problem: 'It was changed after Ada signed it. It’s off so it can’t steer anything.',
        problemKind: 'bad-signature',
        signature: {
          state: 'invalid',
          publisher: 'Ada',
          problem: 'It was changed after Ada signed it.',
        },
      }),
    });
    renderApp(<SkillDetailView skillId="openclaw_gh-triage" />, {
      route: '/skills/openclaw_gh-triage',
    });
    expect(
      await screen.findByRole('region', { name: 'Its signature doesn’t hold' }),
    ).toHaveTextContent('It was changed after Ada signed it.');
    expect(screen.queryByRole('button', { name: 'Trust this publisher…' })).toBeNull();
    expect(screen.getByRole('radio', { name: 'Automatically' })).toBeDisabled();
  });

  it('lists the publishers you trust on the Skills page, and forgets one', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/skills': () => list,
      'GET /api/skills/publishers': () => ({
        publishers: [{ fingerprint: '3F9A 21C0 7B44 E1D2', name: 'Ada', trustedAt: 1 }],
      }),
      'DELETE /api/skills/publishers/3F9A%2021C0%207B44%20E1D2': () => ({ ok: true }),
    });
    renderApp(<SkillsView />, { route: '/skills' });
    const region = await screen.findByRole('region', { name: 'Publishers you trust' });
    await userEvent.click(within(region).getByRole('button', { name: 'Stop trusting Ada' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
  });
});
