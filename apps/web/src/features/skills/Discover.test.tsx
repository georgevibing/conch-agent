import type {
  MarketListing,
  MarketPreview,
  MarketResults,
  SkillDetail,
  SkillOrigin,
} from '@conch/protocol';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appState, mockFetch, renderApp } from '../../test/harness';
import { MarketSkillView } from './Discover';
import { SkillDetailView } from './SkillDetailView';
import { SkillsView } from './SkillsView';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const notes: MarketListing = {
  id: 'clawhub:ada/meeting-notes',
  source: 'clawhub',
  sourceLabel: 'ClawHub',
  name: 'meeting-notes',
  title: 'Meeting notes',
  description: 'Turns rough meeting notes into decisions and actions.',
  publisher: { name: 'Ada', handle: 'ada' },
  trust: 'verified',
  installs: 18_400,
  category: 'productivity',
  url: 'https://clawhub.ai/ada/skills/meeting-notes',
};
const canvas: MarketListing = {
  ...notes,
  id: 'anthropic:canvas-design',
  source: 'anthropic',
  sourceLabel: 'Anthropic',
  name: 'canvas-design',
  title: 'Canvas design',
  description: 'Creates posters and visual art.',
  publisher: { name: 'Anthropic' },
  trust: 'official',
  category: 'design',
  url: 'https://github.com/anthropics/skills',
};
const results = (listings: MarketListing[], offline = false): MarketResults => ({
  listings,
  sources: [{ id: 'clawhub', label: 'ClawHub', state: offline ? 'offline' : 'ok' }],
  ...(offline && { stale: true }),
});
const preview = (over: Partial<MarketPreview> = {}): MarketPreview => ({
  previewId: 'mp_abcdefghijkl',
  listing: notes,
  pin: { kind: 'version', version: '1.0.0', sha256: 'a'.repeat(64) },
  review: { verdict: 'clean', findings: [], hash: 'h1', checkedAt: 1 },
  permissions: { declared: true, capabilities: [], words: [] },
  instructions: 'Read the notes. List what was decided.',
  files: [],
  license: { kind: 'open', name: 'MIT-0' },
  ...over,
});
const origin: SkillOrigin = {
  source: 'clawhub',
  sourceLabel: 'ClawHub',
  listingId: notes.id,
  publisher: { name: 'Ada' },
  trust: 'verified',
  pin: { kind: 'version', version: '1.0.0', sha256: 'a'.repeat(64) },
  url: notes.url,
  installedAt: 1,
};
const added: SkillDetail = {
  id: 'market-clawhub_meeting-notes',
  name: 'meeting-notes',
  title: 'Meeting notes',
  description: notes.description,
  source: 'market',
  sourceLabel: 'ClawHub',
  editable: false,
  mode: 'auto',
  path: '/home/ada/.conch/skills-market/clawhub/meeting-notes',
  files: [],
  updatedAt: 1,
  instructions: 'Read the notes.',
  permissions: { declared: true, capabilities: [], words: [] },
  origin,
};

describe('Discover', () => {
  it.each(['/skills/discover', '/skills/discover?q=canvas'])(
    'opening a skill from %s cancels a pending search, even while the shelf stays mounted',
    async (route) => {
      mockFetch({
        'GET /api/state': () => appState(),
        'GET /api/skills': () => ({ skills: [], sources: [] }),
        'GET /api/skills/market': () => results([canvas, notes]),
      });
      const { where } = renderApp(<SkillsView />, { route });
      const open = await screen.findByRole('button', { name: /Meeting notes, from ClawHub/ });
      vi.useFakeTimers();
      const search = screen.getByRole('searchbox', { name: 'Search skills people share' });
      // Keep the search pending until after the click, regardless of runner speed.
      fireEvent.change(search, { target: { value: 'meeting' } });
      fireEvent.click(open);
      await act(() => vi.advanceTimersByTimeAsync(1_000));
      expect(where()).toBe(`/skills/discover/${encodeURIComponent(notes.id)}`);
    },
  );

  it('is its own tab, with ideas, kinds and a shelf; a search goes in the address', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/skills': () => ({ skills: [], sources: [] }),
      'GET /api/skills/market': () => results([canvas, notes]),
    });
    const { where } = renderApp(<SkillsView />, { route: '/skills/discover' });
    expect(
      await screen.findByRole('tab', { name: 'Discover', selected: true }),
    ).toBeInTheDocument();
    const shelf = await screen.findByRole('region', {
      name: 'Popular, and from the makers of the models',
    });
    expect(
      within(shelf).getByRole('article', { name: /Meeting notes, from ClawHub/ }),
    ).toHaveTextContent('Verified publisher');
    expect(within(shelf).getByRole('article', { name: /Canvas design/ })).toHaveTextContent(
      'Official',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Tidy up meeting notes' }));
    await waitFor(() => expect(where()).toBe('/skills/discover?q=meeting+notes'));
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/api/skills/market?q=meeting+notes')).toBe(true),
    );
    expect(await screen.findByRole('region', { name: 'For “meeting notes”' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'Design' }));
    await waitFor(() => expect(where()).toContain('kind=design'));
  });

  it('calm when the places can’t be reached: what it found before, and says so', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/skills': () => ({ skills: [], sources: [] }),
      'GET /api/skills/market': () => results([notes], true),
    });
    renderApp(<SkillsView />, { route: '/skills/discover' });
    expect(await screen.findByText(/These are from before/)).toBeInTheDocument();
    expect(screen.getByRole('article', { name: /Meeting notes/ })).toBeInTheDocument();
  });

  it('says so when Discover is turned off on this Conch', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/skills': () => ({ skills: [], sources: [] }),
    });
    renderApp(<SkillsView />, { route: '/skills/discover' });
    expect(await screen.findByText('Discover is turned off here')).toBeInTheDocument();
  });

  it('a skill is read before it’s added, then added in one press with the way to use it', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/skills/market/listing': () => notes,
      'POST /api/skills/market/preview': () => preview(),
      'POST /api/skills/market/install': () => added,
    });
    renderApp(<MarketSkillView listingId={notes.id} />, { route: '/skills/discover/x' });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Meeting notes' }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/Pinned to version 1.0.0/)).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/api/skills/market/preview')?.body).toEqual({
      id: notes.id,
    });
    await userEvent.click(screen.getByRole('radio', { name: 'Only when I ask' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add skill' }));
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/api/skills/market/install')?.body).toEqual({
        previewId: 'mp_abcdefghijkl',
        mode: 'manual',
      }),
    );
    expect(await screen.findByRole('button', { name: 'Try it in a chat' })).toBeInTheDocument();
  });

  it('a worrying one sends the OK for exactly what was read', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/skills/market/listing': () => notes,
      'POST /api/skills/market/preview': () =>
        preview({
          review: {
            verdict: 'danger',
            hash: 'h-danger',
            checkedAt: 1,
            findings: [
              {
                kind: 'download-run',
                severity: 'danger',
                message: 'Downloads something and runs it.',
              },
            ],
          },
        }),
      'POST /api/skills/market/install': () => added,
    });
    renderApp(<MarketSkillView listingId={notes.id} />, { route: '/skills/discover/x' });
    const add = await screen.findByRole('button', { name: 'Add anyway' });
    expect(add).toBeDisabled();
    await userEvent.click(
      screen.getByRole('checkbox', { name: 'I’ve read what Conch found, and I still want it' }),
    );
    await userEvent.click(add);
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/api/skills/market/install')?.body).toMatchObject({
        acknowledged: 'h-danger',
      }),
    );
  });

  it('a skill you added says where it’s from, reads an update, and takes it', async () => {
    const withUpdate: SkillDetail = { ...added, origin: { ...origin, update: true } };
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      [`GET /api/skills/${added.id}`]: () => withUpdate,
      [`POST /api/skills/${added.id}/market/update/preview`]: () =>
        preview({
          previewId: 'mp_update123456',
          pin: { kind: 'version', version: '1.1.0', sha256: 'b'.repeat(64) },
          changes: {
            wider: true,
            from: origin.pin,
            permissions: {
              before: { declared: true, capabilities: [], words: [] },
              after: { declared: true, capabilities: ['web'], words: ['read the web'] },
            },
            files: [
              {
                path: 'SKILL.md',
                change: 'changed',
                diff: '--- a/SKILL.md\n+++ b/SKILL.md\n@@ -1 +1 @@\n-a\n+b',
              },
            ],
          },
        }),
      [`POST /api/skills/${added.id}/market/update`]: () => ({
        ...added,
        origin: {
          ...origin,
          pin: { kind: 'version', version: '1.1.0', sha256: 'b'.repeat(64) },
        },
      }),
    });
    renderApp(<SkillDetailView skillId={added.id} />, { route: `/skills/${added.id}` });
    expect(await screen.findByText('Added from ClawHub, by Ada')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Read the update' }));
    expect(await screen.findByText('It asks to do more than before')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Update' }));
    await waitFor(() =>
      expect(calls.find((c) => c.path === `/api/skills/${added.id}/market/update`)?.body).toEqual({
        previewId: 'mp_update123456',
      }),
    );
  });
});
