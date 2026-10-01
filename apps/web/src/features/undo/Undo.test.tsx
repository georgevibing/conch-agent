import type { ConversationEvent, ConversationEventInput, UndoPreview } from '@conch/protocol';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUi } from '../../app/ui';
import { reduceAll } from '../../live/reducer';
import { appState, mockFetch, renderApp } from '../../test/harness';
import { ActivityView } from '../activity/ActivityView';
import { Palette } from '../palette/Palette';
import { ChatFiles, turnChanges } from './ChatFiles';
import { UndoHost } from './UndoHost';

afterEach(() => {
  vi.unstubAllGlobals();
  useUi.setState({ undoing: undefined, paletteOpen: false });
});

const log = (...inputs: ConversationEventInput[]): ConversationEvent[] =>
  inputs.map(
    (e, seq) => ({ ...e, conversationId: 'c1', seq, at: 1000 + seq }) as ConversationEvent,
  );

const changed = (id: string, path: string): ConversationEventInput => ({
  type: 'files.changed',
  changeSetId: id,
  label: `Changed ${path}`,
  files: [{ path, kind: 'changed' }],
});

describe('changes in the chat', () => {
  it('each change is a line that can be undone, and says when it was', () => {
    const view = reduceAll(
      log(
        { type: 'user.message', messageId: 'u1', text: 'tidy' },
        changed('cs_a', 'a.md'),
        changed('cs_b', 'b.md'),
        {
          type: 'files.restored',
          changeSetId: 'cs_a',
          direction: 'undo',
          files: [{ path: 'a.md', kind: 'changed' }],
        },
        { type: 'user.message', messageId: 'u2', text: 'more' },
        changed('cs_c', 'c.md'),
      ),
    );
    const files = view.items.filter((i) => i.kind === 'files');
    expect(files.map((f) => [f.id, f.state])).toEqual([
      ['cs_a', 'undone'],
      ['cs_b', 'applied'],
      ['cs_c', 'applied'],
    ]);
    const turns = turnChanges(view.items);
    expect([...turns.keys()]).toEqual(['cs_b', 'cs_c']);
    expect(turns.get('cs_b')?.map((f) => f.id)).toEqual(['cs_a', 'cs_b']);
  });

  it('offers Undo for one change and for everything the turn did', async () => {
    const user = userEvent.setup();
    const item = (id: string) => ({
      kind: 'files' as const,
      id,
      label: 'Changed x',
      files: [{ path: `${id}.md`, kind: 'changed' as const }],
      state: 'applied' as const,
    });
    renderApp(<ChatFiles item={item('b')} turn={[item('a'), item('b')]} />);
    await user.click(screen.getByRole('button', { name: 'Undo all 2 changes from this turn' }));
    expect(useUi.getState().undoing).toEqual({ ids: ['a', 'b'], direction: 'undo' });
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(useUi.getState().undoing).toEqual({ ids: ['b'], direction: 'undo' });
  });
});

describe('the Undo dialog', () => {
  const preview: UndoPreview = {
    direction: 'undo',
    files: [
      {
        path: 'notes.md',
        kind: 'changed',
        action: 'restore',
        diff: '--- a/notes.md\n+++ b/notes.md\n@@ -1,1 +1,1 @@\n-new\n+old\n',
        conflict: 'It changed since. Undoing replaces those later changes too.',
      },
      { path: 'made.ts', kind: 'created', action: 'remove' },
    ],
  };

  it('shows exactly what will change; a file changed since is only replaced when you say so', async () => {
    const user = userEvent.setup();
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'POST /api/undo/preview': () => preview,
      'POST /api/undo': () => ({ restored: [{ path: 'made.ts', kind: 'deleted' }], skipped: [] }),
    });
    renderApp(<UndoHost />);
    act(() => useUi.setState({ undoing: { ids: ['cs_a'], direction: 'undo' } }));
    const dialog = await screen.findByRole('dialog', { name: 'Undo changes to 2 files' });
    expect(await screen.findByRole('region', { name: 'notes.md' })).toHaveTextContent(
      'It changed since',
    );
    expect(dialog).toHaveTextContent('made.ts');
    await user.click(screen.getByRole('button', { name: 'Undo the others' }));
    await waitFor(() => expect(useUi.getState().undoing).toBeUndefined());
    expect(calls.find((c) => c.path === '/api/undo')?.body).toEqual({
      ids: ['cs_a'],
      direction: 'undo',
      force: false,
    });
  });

  it('replaces later changes too, when you choose that', async () => {
    const user = userEvent.setup();
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'POST /api/undo/preview': () => preview,
      'POST /api/undo': () => ({ restored: [], skipped: [] }),
    });
    renderApp(<UndoHost />);
    act(() => useUi.setState({ undoing: { ids: ['cs_a'], direction: 'undo' } }));
    await user.click(
      await screen.findByRole('button', { name: 'Undo all, replacing later changes' }),
    );
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/api/undo')?.body).toMatchObject({ force: true }),
    );
  });

  it('says plainly when a change is too old', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'POST /api/undo/preview': () =>
        new Response(
          JSON.stringify({
            error: 'undo-expired',
            message: 'That change is too old to undo: Conch let its copies go.',
          }),
          { status: 410 },
        ),
    });
    renderApp(<UndoHost />);
    act(() => useUi.setState({ undoing: { ids: ['cs_old'], direction: 'undo' } }));
    expect(await screen.findByText(/too old to undo/)).toBeInTheDocument();
  });
});

describe('⌘K', () => {
  it('finds “Undo the last change” by the words people use, and opens its preview', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/search': () => ({
        query: '',
        mode: 'exact',
        total: 0,
        capped: false,
        tookMs: 1,
        groups: [],
      }),
      'GET /api/undo/latest': () => ({
        changeSetId: 'cs_last',
        conversationId: 'c1',
        label: 'Changed notes.md',
      }),
    });
    renderApp(<Palette />);
    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'revert');
    await user.click(await screen.findByRole('option', { name: /Undo the last change/ }));
    await waitFor(() =>
      expect(useUi.getState().undoing).toEqual({ ids: ['cs_last'], direction: 'undo' }),
    );
  });
});

describe('Activity', () => {
  it('undoes a change and forgets a memory, right from the row', async () => {
    const user = userEvent.setup();
    const where = { id: 'c1', title: 'Tidy notes' };
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/activity': () => ({
        entries: [
          {
            id: 'c1:3',
            at: Date.now(),
            kind: 'file',
            title: 'Changed notes.md',
            status: 'done',
            conversation: where,
            undo: { changeSetId: 'cs_a', state: 'applied' },
          },
          {
            id: 'c1:2',
            at: Date.now() - 1,
            kind: 'memory',
            title: 'Remembered: likes tea',
            status: 'noted',
            conversation: where,
            memory: { id: 'm1', content: 'likes tea', action: 'saved' },
          },
          {
            id: 'c1:1',
            at: Date.now() - 2,
            kind: 'file',
            title: 'Changed old.md',
            status: 'done',
            conversation: where,
            undo: { changeSetId: 'cs_old', state: 'expired' },
          },
        ],
      }),
      'GET /api/memories': () => [
        {
          id: 'm1',
          content: 'likes tea',
          kind: 'fact',
          source: 'agent',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      'DELETE /api/memories/m1': () => ({ ok: true }),
    });
    renderApp(<ActivityView />);
    await user.click(await screen.findByRole('button', { name: 'Undo: Changed notes.md' }));
    expect(useUi.getState().undoing).toEqual({ ids: ['cs_a'], direction: 'undo' });
    expect(screen.queryByRole('button', { name: 'Undo: Changed old.md' })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Forget: likes tea' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/memories/m1')).toBe(true),
    );
  });
});
