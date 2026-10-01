import type { Artifact, ConversationEvent, ConversationEventInput } from '@conch/protocol';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useUi } from '../../app/ui';
import { reduceAll } from '../../live/reducer';
import { appState, mockFetch, renderApp } from '../../test/harness';
import { Transcript } from '../chat/Transcript';
import { AppView } from './AppView';
import { ArtifactDock } from './ArtifactDock';

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => useUi.setState({ artifactOpen: null, artifactDismissed: {}, browserFor: null }));

function log(...inputs: ConversationEventInput[]): ConversationEvent[] {
  return inputs.map(
    (e, seq) => ({ ...e, conversationId: 'c1', seq, at: Date.now() + seq }) as ConversationEvent,
  );
}

const chart = JSON.stringify({
  type: 'bar',
  title: 'Visitors',
  labels: ['Mon', 'Tue'],
  series: [{ name: 'Visitors', values: [3, 5] }],
});

const artifact = (patch: Partial<Artifact> = {}): Artifact => ({
  id: 'a_1',
  title: 'Visitors this week',
  kind: 'chart',
  conversationId: 'c1',
  createdAt: 1,
  updatedAt: 2,
  versions: [
    { n: 1, at: 1, size: 10 },
    { n: 2, at: 2, size: 10, note: 'As a line' },
  ],
  refresh: { prompt: 'A chart of my visitors' },
  ...patch,
});

function routes(a: Artifact = artifact()) {
  return mockFetch({
    'GET /api/state': () => appState(),
    'GET /api/conversations': () => [],
    'GET /api/artifacts': () => ({ artifacts: [a] }),
    [`GET /api/artifacts/${a.id}`]: () => a,
    [`GET /api/artifacts/${a.id}/versions/1`]: () => ({ artifactId: a.id, n: 1, content: chart }),
    [`GET /api/artifacts/${a.id}/versions/2`]: () => ({
      artifactId: a.id,
      n: 2,
      content: chart.replace('"bar"', '"line"'),
    }),
    [`PATCH /api/artifacts/${a.id}`]: (body) => ({
      ...a,
      ...((body as { pinned?: boolean }).pinned && { pinned: { at: 5 } }),
    }),
    [`POST /api/artifacts/${a.id}/refresh`]: () => ({ conversationId: 'c2' }),
  });
}

const made = log(
  { type: 'user.message', messageId: 'u1', text: 'Make me a chart' },
  {
    type: 'artifact',
    artifactId: 'a_1',
    title: 'Visitors this week',
    kind: 'chart',
    version: 1,
    action: 'created',
  },
  {
    type: 'artifact',
    artifactId: 'a_1',
    title: 'Visitors this week',
    kind: 'chart',
    version: 2,
    action: 'updated',
    note: 'As a line',
  },
);

describe('Show me', () => {
  it('a chat shows a card for each version; one press opens it beside the chat', async () => {
    routes();
    const view = reduceAll(made);
    renderApp(
      <ArtifactDock conversationId="c1" view={view}>
        <Transcript
          view={view}
          conversationId="c1"
          pending={[]}
          name="Conch"
          onRespond={() => {}}
          onRetry={() => {}}
        />
      </ArtifactDock>,
    );
    // Something new was made just now: the panel opens by itself, on the latest.
    const panel = await screen.findByRole('region', { name: 'Visitors this week' });
    expect(panel).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: /line chart of Visitors/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Chart · made for you/ }));
    await waitFor(() =>
      expect(useUi.getState().artifactOpen).toMatchObject({ artifactId: 'a_1', version: 1 }),
    );
    expect(await screen.findByRole('img', { name: /bar chart of Visitors/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(useUi.getState().artifactOpen).toBeNull();
  });

  it('history replayed when a chat opens does not open the panel', () => {
    routes();
    const old = made.map((e) => ({ ...e, at: 1000 }));
    renderApp(
      <ArtifactDock conversationId="c1" view={reduceAll(old)}>
        <p>chat</p>
      </ArtifactDock>,
    );
    expect(useUi.getState().artifactOpen).toBeNull();
  });

  it('pins as an app, and an app refreshes with fresh data', async () => {
    const calls = routes(artifact({ pinned: { at: 5 } }));
    renderApp(<AppView artifactId="a_1" />, { route: '/apps/a_1' });
    expect(await screen.findByRole('region', { name: 'Visitors this week' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({ method: 'POST', path: '/api/artifacts/a_1/refresh' }),
      ),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Unpin from the sidebar' }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          method: 'PATCH',
          path: '/api/artifacts/a_1',
          body: { pinned: false },
        }),
      ),
    );
  });

  it('a page is a sealed frame on its own route; a risky one starts with its code off', async () => {
    const page = artifact({
      kind: 'html',
      title: 'Links',
      versions: [{ n: 1, at: 1, size: 5, navigates: true }],
      navigates: true,
    });
    routes(page);
    act(() => useUi.getState().openArtifact('c1', 'a_1'));
    renderApp(
      <ArtifactDock conversationId="c1" view={reduceAll([])}>
        <p>chat</p>
      </ArtifactDock>,
    );
    const frame = await screen.findByTitle('Links');
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('src')).toBe(
      '/api/artifacts/a_1/versions/1/frame?theme=light&scripts=0',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Run it anyway' }));
    const running = await screen.findByTitle('Links');
    expect(running.getAttribute('sandbox')).toBe('allow-scripts');
    expect(running.getAttribute('src')).toContain('scripts=1');
  });
});
