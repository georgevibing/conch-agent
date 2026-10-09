import type { Memory, Profile, ProfileFact } from '@conch/protocol';
import { Toaster } from '@conch/nacre';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appState, mockFetch, renderApp } from '../../test/harness';
import { learnedFacts, sourceOf, summarise } from './AboutYou';
import { guessFactKind } from './guess';
import { MemoryTab } from './MemoryTab';

afterEach(() => vi.unstubAllGlobals());

const about = 'SDM at Amazon. Father to Lina. Graphics programmer by night.';
const may3 = new Date(new Date().getFullYear(), 4, 3, 12).getTime();

const memory = (over: Partial<Memory>): Memory => ({
  id: 'm1',
  content: 'Prefers metric units',
  kind: 'preference',
  source: 'agent',
  conversationId: 'c1',
  createdAt: may3,
  updatedAt: may3,
  ...over,
});

function page(profile: Profile, memories: Memory[] = [], extra = {}) {
  let state = appState({ profile });
  const calls = mockFetch({
    'GET /api/state': () => state,
    'GET /api/memories': () => memories,
    'PATCH /api/settings': (body) =>
      (state = appState({ profile: (body as { profile: Profile }).profile })),
    ...extra,
  });
  const view = renderApp(
    <>
      <MemoryTab autoMemory tidyMemory={false} />
      <Toaster />
    </>,
    { route: '/settings/memory' },
  );
  return { calls, ...view };
}

const group = (name: string) => screen.getByRole('region', { name });
const saved = (calls: { method: string; body: unknown }[]) =>
  calls.filter((c) => c.method === 'PATCH').at(-1)?.body as { profile: Profile } | undefined;

describe('What Conch knows: About you first', () => {
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

  it('puts what it learned beside what you said, never facts about the computer or what waits', () => {
    const told: ProfileFact[] = [{ id: 'w', kind: 'way', text: 'Short answers first' }];
    const learned = learnedFacts(
      [
        memory({}),
        memory({ id: 'm2', content: 'short answers first' }),
        memory({ id: 'm3', kind: 'fact', content: 'python is py here', about: 'environment' }),
        memory({ id: 'm4', kind: 'person', content: 'Sam is his brother', pending: true }),
        memory({ id: 'm5', kind: 'project', content: 'Building Conch' }),
      ],
      told,
    );
    expect(learned.map((f) => [f.kind, f.text])).toEqual([
      ['way', 'Prefers metric units'],
      ['work', 'Building Conch'],
    ]);
    expect(sourceOf(memory({}))).toMatch(/^Learned from a chat on (3 May|May 3)$/);
    expect(sourceOf(memory({ source: 'user' }))).toMatch(/^You asked me to remember this on /);
  });

  it('comes first, then how it learns, everything it remembers, and Advanced', async () => {
    page({ name: 'George', about: '', facts: [] });
    const headings = await screen.findAllByRole('heading', { level: 3 });
    expect(headings.map((h) => h.textContent).slice(0, 2)).toEqual(['What Conch knows', 'Memory']);
    expect(screen.getByRole('switch', { name: /Learn from your chats/ })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Tidy up every night/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open memories' })).toBeInTheDocument();
    // Nothing yet is a question, not a blank.
    expect(screen.getByRole('button', { name: 'Who’s close to you?' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Advanced' })).toBeInTheDocument();
  });

  it('turns what you tell it into a chip in the right place, and keeps it', async () => {
    const user = userEvent.setup();
    const { calls } = page({ name: 'George', about: '', facts: [] });
    await user.type(
      await screen.findByRole('textbox', { name: 'Tell Conch something about you' }),
      'I prefer metric units',
    );
    expect(screen.getByRole('button', { name: /Goes in How you like answers/ })).toBeVisible();
    await user.keyboard('{Enter}');
    const chip = within(group('How you like answers')).getByRole('button', {
      name: 'I prefer metric units',
    });
    expect(chip).toHaveAttribute('data-arriving');
    await waitFor(
      () =>
        expect(saved(calls)?.profile.facts).toEqual([
          expect.objectContaining({ kind: 'way', text: 'I prefer metric units' }),
        ]),
      { timeout: 3000 },
    );
  });

  it('shows where a learned fact came from, corrects it in place, and opens its chat', async () => {
    const user = userEvent.setup();
    const { calls, where } = page({ name: 'George', about: '', facts: [] }, [memory({})], {
      'PATCH /api/memories/m1': () => memory({ content: 'Metric, always' }),
    });
    await user.click(
      await screen.findByRole('button', {
        name: 'Prefers metric units, learned from your chats',
      }),
    );
    expect(screen.getByText(/^Learned from a chat on (3 May|May 3)$/)).toBeVisible();
    const field = screen.getByRole('textbox', { name: 'How you like answers' });
    await user.clear(field);
    await user.keyboard('Metric, always{Enter}');
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/api/memories/m1')?.body).toEqual({
        content: 'Metric, always',
      }),
    );
    await user.click(screen.getByRole('button', { name: /^Prefers metric units/ }));
    await user.click(screen.getByRole('button', { name: 'Open the chat' }));
    expect(where()).toBe('/c/c1');
  });

  it('removes a fact with an Undo that puts it back where it was', async () => {
    const user = userEvent.setup();
    const { calls } = page({
      name: 'George',
      about: '',
      facts: [
        { id: 'a', kind: 'interest', text: 'Bouldering' },
        { id: 'b', kind: 'interest', text: 'Shaders' },
      ],
    });
    await user.click(await screen.findByRole('button', { name: 'Bouldering' }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('Removed “Bouldering”')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Bouldering' })).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByRole('button', { name: 'Bouldering' })).toBeVisible();
    // Back where it was, so there's nothing to save.
    const chips = within(group('What you’re into')).getAllByRole('button');
    expect(chips.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Bouldering',
      'Shaders',
      'Add to What you’re into',
    ]);
    expect(saved(calls)).toBeUndefined();
  });

  it('reads your own words, under Advanced, into chips you keep, and shows what every chat starts with', async () => {
    const user = userEvent.setup();
    const { calls } = page({ name: 'George', about, facts: [] }, [], {
      'POST /api/profile/understand': () => ({
        facts: [
          { id: 'a', kind: 'work', text: 'SDM at Amazon' },
          { id: 'b', kind: 'person', text: 'Lina', detail: 'daughter' },
        ],
      }),
    });
    await user.click(await screen.findByRole('button', { name: 'Advanced' }));
    await user.click(screen.getByRole('button', { name: 'Lay it out on your portrait' }));
    expect(await screen.findByRole('status')).toHaveTextContent('I read 2 things in your words');
    expect(calls.find((c) => c.path === '/api/profile/understand')?.body).toEqual({ about });
    await user.click(screen.getByRole('button', { name: 'Keep all' }));
    expect(within(group('People')).getByRole('button', { name: 'Lina, daughter' })).toBeVisible();
    expect(screen.getByText(/People in their life: Lina \(daughter\)\./)).toBeVisible();
    await waitFor(
      () =>
        expect(saved(calls)?.profile).toMatchObject({
          name: 'George',
          facts: [
            { kind: 'work', text: 'SDM at Amazon' },
            { kind: 'person', text: 'Lina', detail: 'daughter' },
          ],
        }),
      { timeout: 3000 },
    );
  });
});

describe('your photo', () => {
  const photo = { type: 'image/webp' as const, updatedAt: 7 };

  it('frames a chosen picture and keeps it, then takes it away with an Undo', async () => {
    const user = userEvent.setup();
    // jsdom draws nothing: a picture that decodes, and a canvas that hands back a photo.
    HTMLImageElement.prototype.decode = vi.fn(() => Promise.resolve());
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(640);
    vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(480);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((done) =>
      done(new Blob(['webp'], { type: 'image/webp' })),
    );
    URL.createObjectURL = vi.fn(() => 'blob:me');
    URL.revokeObjectURL = vi.fn();
    let state = appState({ profile: { name: 'George', about: '', facts: [] } });
    const calls = mockFetch({
      'GET /api/state': () => state,
      'GET /api/memories': () => [],
      'PUT /api/profile/avatar': () =>
        (state = appState({ profile: { ...state.profile, avatar: photo } })),
      'GET /api/profile/avatar': () => 'webp',
      'DELETE /api/profile/avatar': () =>
        (state = appState({ profile: { name: 'George', about: '', facts: [] } })),
    });
    renderApp(
      <>
        <MemoryTab autoMemory tidyMemory={false} />
        <Toaster />
      </>,
    );
    await user.upload(
      await screen.findByLabelText('Choose a photo'),
      new File(['x'], 'me.jpg', { type: 'image/jpeg' }),
    );
    await user.click(await screen.findByRole('button', { name: 'Use this photo' }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          method: 'PUT',
          path: '/api/profile/avatar',
          body: { data: 'd2VicA==' },
        }),
      ),
    );
    await user.click(await screen.findByRole('button', { name: 'Change your photo' }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove photo' }));
    const gone = await screen.findByText('Your photo is gone.');
    expect(await screen.findByRole('button', { name: 'Add a photo' })).toBeInTheDocument();
    const toast = gone.closest('li') ?? document.body;
    await user.click(within(toast).getByRole('button', { name: 'Undo' }));
    await waitFor(() =>
      expect(
        calls.filter((c) => c.method === 'PUT' && c.path === '/api/profile/avatar'),
      ).toHaveLength(2),
    );
    expect(await screen.findByRole('button', { name: 'Change your photo' })).toBeInTheDocument();
    vi.restoreAllMocks();
  });
});

describe('guessFactKind', () => {
  it.each([
    ['I prefer metric units', 'way'],
    ['Keep answers short', 'way'],
    ['Sam is my brother', 'person'],
    ['My daughter Lina was born in June', 'person'],
    ['I live in Lisbon', 'home'],
    ['From Komotini, Greece', 'home'],
    ['I work as a designer', 'work'],
    ['Building a web shell for agents', 'work'],
    ['Bouldering', 'interest'],
  ])('%s → %s', (text, kind) => expect(guessFactKind(text)).toBe(kind));
});
