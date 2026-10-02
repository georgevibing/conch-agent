import type { Artifact, LiveDataInfo } from '@conch/protocol';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useUi } from '../../app/ui';
import { reduceAll } from '../../live/reducer';
import { appState, mockFetch, renderApp } from '../../test/harness';
import { AppView } from './AppView';
import { ArtifactDock } from './ArtifactDock';
import { useEdits } from './edits';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
beforeEach(() => {
  useUi.setState({ artifactOpen: null, artifactDismissed: {}, browserFor: null });
  useEdits.setState({ edits: {} });
});

const chart = JSON.stringify({
  type: 'bar',
  labels: ['Mon', 'Tue'],
  series: [{ name: 'Visitors', values: [3, 5] }],
});

const artifact = (patch: Partial<Artifact> = {}): Artifact => ({
  id: 'a_1',
  title: 'Visitors',
  kind: 'chart',
  conversationId: 'c1',
  createdAt: 1,
  updatedAt: 2,
  versions: [{ n: 1, at: 1, size: 10 }],
  ...patch,
});

/** CodeMirror, once it's loaded; text goes in as a person's typing would. */
async function typeInto(text: string) {
  await waitFor(() => expect(document.querySelector('.cm-content')).not.toBeNull());
  // CodeMirror's own handle on its editable area (what `EditorView.findFromDOM` reads).
  const content = document.querySelector('.cm-content') as HTMLElement & {
    cmTile?: {
      root?: { view?: { state: { doc: { length: number } }; dispatch: (t: unknown) => void } };
    };
  };
  const view = content.cmTile?.root?.view;
  if (!view) throw new Error('No editor');
  act(() =>
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
      userEvent: 'input.type',
    }),
  );
}

function open(a: Artifact, extra: Record<string, (body: unknown) => unknown> = {}) {
  const calls = mockFetch({
    'GET /api/state': () => appState(),
    'GET /api/conversations': () => [],
    'GET /api/artifacts': () => ({ artifacts: [a] }),
    [`GET /api/artifacts/${a.id}`]: () => a,
    [`GET /api/artifacts/${a.id}/versions/1`]: () => ({
      artifactId: a.id,
      n: 1,
      content: a.kind === 'html' ? '<h1>Hi</h1>' : a.kind === 'table' ? 'Item,Cost\nRent,1' : chart,
    }),
    ...extra,
  });
  act(() => useUi.getState().openArtifact('c1', a.id));
  renderApp(
    <ArtifactDock conversationId="c1" view={reduceAll([])}>
      <p>chat</p>
    </ArtifactDock>,
  );
  return calls;
}

describe('Edit by hand (ADR 0039)', () => {
  it('edits a chart with a live preview, says what’s wrong in words, and saves as yours', async () => {
    const saved = artifact({
      versions: [
        { n: 1, at: 1, size: 10 },
        { n: 2, at: 3, size: 10, edited: true, note: 'Edited by you' },
      ],
    });
    let now = artifact();
    const calls = open(artifact(), {
      'GET /api/artifacts': () => ({ artifacts: [now] }),
      'GET /api/artifacts/a_1': () => now,
      'POST /api/artifacts/a_1/versions': () => (now = saved),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(await screen.findByRole('toolbar', { name: 'Editing' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    // A mistake: said in plain words, and Save waits.
    await typeInto('{ "type": "bar", ');
    expect(await screen.findByText(/The chart’s JSON has a mistake/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    // Fixed: the preview redraws from what was typed (a narrow panel shows one at a time).
    await typeInto(chart.replace('"bar"', '"line"'));
    await userEvent.click(screen.getByRole('radio', { name: 'Preview' }));
    expect(await screen.findByRole('img', { name: /line chart of Visitors/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/JSON has a mistake/)).toBeNull());
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          method: 'POST',
          path: '/api/artifacts/a_1/versions',
          body: { content: chart.replace('"bar"', '"line"'), base: 1 },
        }),
      ),
    );
    // Back to viewing it: the new version, marked as yours.
    expect(await screen.findByText('Edited by you')).toBeInTheDocument();
    expect(useEdits.getState().edits).toEqual({});
  });

  it('a table that doesn’t add up can’t be saved; Cancel with changes asks first', async () => {
    open(artifact({ kind: 'table', title: 'Budget' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    await typeInto('Item,Cost\nRent,1,extra');
    expect(
      await screen.findByText('Line 2 has 3 values, but the header has 2.'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(
      await screen.findByRole('alertdialog', { name: 'Discard your changes to “Budget”?' }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(useEdits.getState().edits.a_1).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(useEdits.getState().edits).toEqual({}));
    expect(await screen.findByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('an edit survives closing the panel, and comes back', async () => {
    open(artifact({ kind: 'table', title: 'Budget' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    await typeInto('Item,Cost\nRent,2');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(useEdits.getState().edits.a_1?.content).toBe('Item,Cost\nRent,2');
    act(() => useUi.getState().openArtifact('c1', 'a_1'));
    expect(
      await screen.findByText('Your unsaved edit is back, just as you left it.'),
    ).toBeInTheDocument();
  });

  it('a page’s preview is served sealed from the gateway, as you type', async () => {
    const calls = open(artifact({ kind: 'html', title: 'Tip' }), {
      'PUT /api/artifacts/a_1/draft': () => ({ rev: 3, navigates: false }),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    await typeInto('<h1>Tip v2</h1>');
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          method: 'PUT',
          path: '/api/artifacts/a_1/draft',
          body: { content: '<h1>Tip v2</h1>' },
        }),
      ),
    );
    const frame = await screen.findByTitle('Tip');
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('src')).toBe(
      '/api/artifacts/a_1/versions/draft/frame?theme=light&rev=3',
    );
  });
});

describe('Live data (ADR 0039)', () => {
  const page = artifact({ kind: 'html', title: 'Weather now', pinned: { at: 1 } });
  const info = (allowed: boolean): LiveDataInfo => ({
    sources: [
      {
        name: 'weather',
        url: 'https://api.example.com/now?city={city}',
        host: 'api.example.com',
        every: 60,
        local: false,
        allowed,
        changed: false,
      },
    ],
  });

  it('asks once for the host, then answers the page and reads again on its schedule', async () => {
    let allowed = false;
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/artifacts': () => ({ artifacts: [page] }),
      'GET /api/artifacts/a_1': () => page,
      'GET /api/artifacts/a_1/versions/1': () => ({ artifactId: 'a_1', n: 1, content: '<p>' }),
      'GET /api/artifacts/a_1/versions/1/live-data': () => info(allowed),
      'POST /api/artifacts/a_1/live-data': () => {
        allowed = true;
        return info(true);
      },
      'POST /api/artifacts/a_1/versions/1/live-data': () => ({
        ok: true,
        status: 200,
        type: 'application/json',
        body: '{"t":21}',
        at: Date.now(),
      }),
    });
    renderApp(<AppView artifactId="a_1" />, { route: '/apps/a_1' });
    const ask = await screen.findByRole('group', {
      name: /Let “Weather now” read live data from api.example.com/,
    });
    expect(ask).toHaveTextContent('https://api.example.com/now?city={city}');
    await userEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          method: 'POST',
          path: '/api/artifacts/a_1/live-data',
          body: { version: 1, host: 'api.example.com', local: false },
        }),
      ),
    );
    // The page starts again, and its request is answered (a pinned app's, too).
    const frame = (await screen.findByTitle('Weather now')) as HTMLIFrameElement;
    await waitFor(() => expect(frame.getAttribute('src')).toContain('&live=1'));
    const win = frame.contentWindow as Window;
    const post = vi.spyOn(win, 'postMessage');
    act(() =>
      window.dispatchEvent(
        new MessageEvent('message', {
          source: win,
          data: {
            conch: 'artifact',
            data: { id: 'd1', source: 'weather', params: { city: 'berlin' } },
          },
        }),
      ),
    );
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        expect.objectContaining({ conch: 'artifact-data', id: 'd1' }),
        '*',
      ),
    );
    expect(await screen.findByText(/Live · Updated just now · every 1 min/)).toBeInTheDocument();

    // Update now tells the page to read again.
    await userEvent.click(screen.getByRole('button', { name: 'Update now' }));
    expect(post).toHaveBeenCalledWith({ conch: 'artifact-data', refresh: true }, '*');
  });

  it('a read that fails is said calmly, with what it had', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/artifacts': () => ({ artifacts: [page] }),
      'GET /api/artifacts/a_1': () => page,
      'GET /api/artifacts/a_1/versions/1/live-data': () => info(true),
      'POST /api/artifacts/a_1/versions/1/live-data': () => ({
        ok: false,
        reason: 'timeout',
        message: 'api.example.com took too long to answer.',
      }),
    });
    renderApp(<AppView artifactId="a_1" />, { route: '/apps/a_1' });
    const frame = (await screen.findByTitle('Weather now')) as HTMLIFrameElement;
    await screen.findByText(/Live · Reading…|Live ·/);
    act(() =>
      window.dispatchEvent(
        new MessageEvent('message', {
          source: frame.contentWindow,
          data: { conch: 'artifact', data: { id: 'd1', source: 'weather' } },
        }),
      ),
    );
    expect(
      await screen.findByText(/Couldn’t update: api.example.com took too long to answer./),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
