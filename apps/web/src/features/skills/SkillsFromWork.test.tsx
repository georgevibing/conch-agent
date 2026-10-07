import type { Skill, SkillDetail, SkillSuggestion } from '@conch/protocol';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act, useState } from 'react';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ConversationView } from '../../live/reducer';
import { appState, mockFetch, renderApp } from '../../test/harness';
import { NewSkill } from './NewSkill';
import { SkillOfferInChat } from './SkillOfferInChat';
import { SkillsView } from './SkillsView';

afterEach(() => vi.unstubAllGlobals());

const offer: SkillSuggestion = {
  id: 'ws_1',
  title: 'Cheapest train',
  times: 1,
  examples: [{ text: 'Find me the cheapest train to Lyon', conversationId: 'c1', at: 100 }],
  draft: {
    title: 'Cheapest train',
    description: 'Finds the cheapest train for a trip. Use when asked for train tickets.',
    instructions: '1. Ask where to and when, if it isn’t said.\n2. Compare the fares.',
    permissions: {
      capabilities: ['web', 'browser'],
      words: ['read the web', 'act on websites in the browser'],
    },
  },
  from: 'work',
  chat: { conversationId: 'c1', title: 'Trains to Lyon', endedAt: 200 },
  steps: 11,
  headline: 'Find the cheapest train',
  untrusted: 'Learned from trains.example.',
};

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

describe('save how I did this, on the Skills page', () => {
  it('offers work from a chat, and the draft keeps only what the work needed', async () => {
    const created: SkillDetail = {
      ...skill({ id: 'cheapest-train', name: 'cheapest-train', title: 'Cheapest train' }),
      mode: 'manual',
      instructions: offer.draft.instructions,
    };
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/skills': () => ({ skills: [], sources: [] }),
      'GET /api/skills/suggestions': () => ({ suggestions: [] }),
      'GET /api/skills/suggestions/work': () => ({ suggestions: [offer] }),
      'POST /api/skills': () => created,
      'GET /api/skills/cheapest-train': () => created,
    });
    renderApp(
      <Routes>
        <Route path="/skills" element={<SkillsView />} />
        <Route path="/skills/new" element={<NewSkill />} />
        <Route path="/skills/:id" element={<p>Saved</p>} />
      </Routes>,
      { route: '/skills' },
    );
    const card = await screen.findByRole('region', {
      name: 'From your chat “Trains to Lyon”. Save how it was done as “Cheapest train”?',
    });
    expect(card).toHaveTextContent('It took 11 steps and worked.');
    expect(card).toHaveTextContent('Learned from trains.example.');
    await userEvent.click(within(card).getByRole('button', { name: 'Look at the draft' }));

    expect(await screen.findByDisplayValue('Cheapest train')).toBeInTheDocument();
    expect(
      screen.getByText(/wrote this from how your chat “Trains to Lyon” went/),
    ).toBeInTheDocument();
    expect(screen.getByText(/A page can try to slip in a step of its own/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'This skill can:' })).toHaveTextContent(
      'act on websites in the browser',
    );
    // Starts as something you ask for by name; nothing is saved until you press.
    expect(screen.getByRole('radio', { name: /When I ask/i })).toBeChecked();
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/skills')).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Create skill' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST' && c.path === '/api/skills')?.body).toEqual({
        instructions: offer.draft.instructions,
        title: 'Cheapest train',
        description: offer.draft.description,
        mode: 'manual',
        permissions: { capabilities: ['web', 'browser'] },
        suggestion: 'ws_1',
      }),
    );
  });

  it('Not now in the chat puts it away; it never shows while an answer is written, or after you move on', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/skills/suggestions/work': () => ({ suggestions: [offer] }),
      'POST /api/skills/suggestions/dismiss': () => ({ ok: true }),
    });
    const view = (items: ConversationView['items']): ConversationView => ({
      lastSeq: 10,
      items,
      status: 'idle',
    });
    const asked = { kind: 'user' as const, id: 'u1', text: 'Find me a train', at: 100 };
    type Props = Parameters<typeof SkillOfferInChat>[0];
    let show!: (props: Props) => void;
    function Harness() {
      const [props, setProps] = useState<Props>({
        conversationId: 'c1',
        view: view([asked]),
        running: false,
      });
      show = setProps;
      return <SkillOfferInChat {...props} />;
    }
    renderApp(<Harness />);
    const line = await screen.findByRole('group', { name: 'Save how this was done as a skill' });
    // What it would do, in the model's few words, checked on the server.
    expect(line).toHaveTextContent('Find the cheapest train');
    expect(line).toHaveTextContent('That took 11 steps, and it worked.');
    expect(line).toHaveTextContent('Learned from trains.example. Check the steps before saving.');

    act(() => show({ conversationId: 'c1', view: view([asked]), running: true }));
    expect(screen.queryByRole('group')).toBeNull();
    act(() =>
      show({
        conversationId: 'c1',
        view: view([asked, { kind: 'user', id: 'u2', text: 'And back?', at: 300 }]),
        running: false,
      }),
    );
    expect(screen.queryByRole('group')).toBeNull();
    // Another chat's offer isn't this chat's.
    act(() => show({ conversationId: 'c2', view: view([asked]), running: false }));
    expect(screen.queryByRole('group')).toBeNull();

    act(() => show({ conversationId: 'c1', view: view([asked]), running: false }));
    await userEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByRole('group')).toBeNull());
    expect(calls.find((c) => c.path === '/api/skills/suggestions/dismiss')?.body).toEqual({
      id: 'ws_1',
      forever: false,
    });
  });
});

describe('a tidy shelf', () => {
  const stale = skill({ id: 'release-notes', name: 'release-notes', title: 'Release notes' });

  it('offers what Conch put here and sat unused, and changes nothing until you press', async () => {
    let pressed = false;
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/skills': () => ({ skills: [stale], sources: [] }),
      'GET /api/skills/suggestions/shelf': () =>
        pressed
          ? { stale: [], days: 60 }
          : {
              stale: [
                {
                  id: 'release-notes',
                  name: 'release-notes',
                  title: 'Release notes',
                  idleSince: 1,
                },
              ],
              days: 60,
            },
      'POST /api/skills/suggestions/shelf': () => {
        pressed = true;
        return { changed: 1 };
      },
    });
    renderApp(<SkillsView />, { route: '/skills' });
    const shelf = await screen.findByRole('region', {
      name: 'You haven’t used this in two months',
    });
    expect(shelf).toHaveTextContent('Release notesNever used');
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    await userEvent.click(within(shelf).getByRole('button', { name: 'Turn it off' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
        action: 'off',
        ids: ['release-notes'],
      }),
    );
    await waitFor(() => expect(screen.queryByRole('region', { name: /haven’t used/ })).toBeNull());
  });

  it('lists what’s off under Off, kept and one switch away', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/skills': () => ({
        skills: [
          stale,
          skill({ id: 'weekly', name: 'weekly', title: 'Weekly review', mode: 'off' }),
        ],
        sources: [],
      }),
    });
    renderApp(<SkillsView />, { route: '/skills?show=off' });
    expect(
      await screen.findByText(/Skills that are off are kept, and in every backup/),
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Off' })).toBeChecked();
    expect(screen.getByText('Weekly review')).toBeInTheDocument();
    expect(screen.queryByText('Release notes')).toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: 'All' }));
    expect(await screen.findByText('Release notes')).toBeInTheDocument();
  });
});
