import type { Attachment, ConversationSummary, DraftReply } from '@conch/protocol';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUi } from '../../app/ui';
import { useLiveStore } from '../../live/store';
import { appState, FakeSocket, mockFetch, renderApp } from '../../test/harness';
import { Sidebar } from '../sidebar/Sidebar';
import { ChatView } from './ChatView';
import { loadLocalDraft } from './composer';

afterEach(() => {
  vi.unstubAllGlobals();
  useUi.setState({ picker: null, draftOptions: {} });
  useLiveStore.setState({ pending: {} });
  localStorage.clear();
  sessionStorage.clear();
});

const note: Attachment = {
  id: 'att_note',
  name: 'notes.txt',
  mimeType: 'text/plain',
  size: 12,
  kind: 'text',
  lines: 1,
  createdAt: 1,
};

/** Conch, as far as drafts go: what it keeps per chat, and every PUT it was sent. */
function conch(start: Record<string, DraftReply['draft']> = {}, missing: string[] = []) {
  const kept = new Map(Object.entries(start));
  const puts: { key: string; body: { text: string; attachments?: string[] } }[] = [];
  const routes: Record<string, (body: unknown) => unknown> = {
    'GET /api/state': () => appState(),
    'GET /api/conversations': () => [],
    'GET /api/attachments/att_note': () => new Response('hello there\n', { status: 200 }),
  };
  const known = new Set(['c-a', 'c-b', 'new', ...kept.keys()]);
  for (const key of known) {
    routes[`GET /api/conversations/${key}/draft`] = () => ({
      draft: kept.get(key) ?? null,
      missing,
    });
    routes[`PUT /api/conversations/${key}/draft`] = (raw) => {
      const body = raw as { text: string; attachments?: string[] };
      puts.push({ key, body });
      const draft =
        body.text.trim() || body.attachments?.length
          ? {
              text: body.text,
              attachments: (body.attachments ?? []).flatMap((id) => (id === note.id ? [note] : [])),
              updatedAt: Date.now(),
            }
          : null;
      kept.set(key, draft);
      return { draft, missing: [] };
    };
  }
  return { routes, puts, kept };
}

async function open(id: string, routes: Record<string, (body: unknown) => unknown>) {
  mockFetch(routes);
  const view = renderApp(<ChatView conversationId={id} />, { route: `/c/${id}` });
  const box = await screen.findByRole('textbox', { name: 'Message Conch' });
  await waitFor(() => expect(FakeSocket.last?.readyState).toBe(1));
  return { box, ...view };
}

/** Uploads answer at once, as the gateway would, with the attachment it kept. */
function fakeUploads(attachment: Attachment) {
  class FakeXhr {
    status = 0;
    responseText = '';
    upload: { onprogress?: (event: ProgressEvent) => void } = {};
    onload?: () => void;
    onerror?: () => void;
    onabort?: () => void;
    open() {}
    setRequestHeader() {}
    abort() {}
    send() {
      setTimeout(() => {
        this.status = 200;
        this.responseText = JSON.stringify({ attachment });
        this.onload?.();
      }, 0);
    }
  }
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
}

describe('Drafts', () => {
  it('keeps what you typed when you go to another chat and come back, and Conch has it too', async () => {
    const world = conch();
    const first = await open('c-a', world.routes);
    await userEvent.type(first.box, 'half a thought');
    first.unmount();
    // Somewhere else for a moment.
    (await open('c-b', world.routes)).unmount();

    const again = await open('c-a', world.routes);
    expect(again.box).toHaveValue('half a thought');
    // The cursor is at the end, ready to carry on.
    expect((again.box as HTMLTextAreaElement).selectionStart).toBe('half a thought'.length);
    await waitFor(() =>
      expect(world.puts.at(-1)).toEqual({
        key: 'c-a',
        body: { text: 'half a thought', attachments: [] },
      }),
    );
  });

  it('brings back a draft written on another device', async () => {
    const world = conch({ 'c-a': { text: 'from my phone', attachments: [], updatedAt: 5 } });
    const { box } = await open('c-a', world.routes);
    await waitFor(() => expect(box).toHaveValue('from my phone'));
    // Taken as it is: nothing to send back.
    expect(world.puts).toEqual([]);
  });

  it('keeps what you attached through a reload, its card there from the first frame', async () => {
    fakeUploads(note);
    const world = conch();
    const first = await open('c-a', world.routes);
    await userEvent.type(first.box, 'see the notes');
    const input = first.container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('no file input');
    await userEvent.upload(input, new File(['hello there\n'], 'notes.txt', { type: 'text/plain' }));
    await waitFor(() =>
      expect(world.puts.at(-1)?.body).toEqual({ text: 'see the notes', attachments: [note.id] }),
    );
    first.unmount();

    // A reload: a new page, the same device.
    const again = await open('c-a', world.routes);
    expect(again.box).toHaveValue('see the notes');
    const cards = screen.getByRole('list', { name: 'Attachments' });
    expect(within(cards).getByRole('button', { name: /^notes\.txt/ })).toBeInTheDocument();
    // Its first lines come from Conch.
    await waitFor(() => expect(within(cards).getByText(/hello there/)).toBeInTheDocument());
  });

  it('clears the draft when the message is sent', async () => {
    const world = conch({ 'c-a': { text: 'send me', attachments: [], updatedAt: 5 } });
    const { box } = await open('c-a', world.routes);
    await waitFor(() => expect(box).toHaveValue('send me'));
    await userEvent.type(box, '{Enter}');
    await waitFor(() =>
      expect(FakeSocket.last?.sent).toContainEqual(
        expect.objectContaining({ type: 'conversation.send', text: 'send me' }),
      ),
    );
    expect(box).toHaveValue('');
    await waitFor(() => expect(world.kept.get('c-a')).toBeNull());
    expect(loadLocalDraft('c-a')).toBeUndefined();
  });

  it('says so on the card when a file was let go, and offers to take it off', async () => {
    const world = conch({ 'c-a': { text: 'with a picture', attachments: [], updatedAt: 5 } }, [
      'att_gone',
    ]);
    // This device remembers the picture; Conch no longer has it.
    localStorage.setItem(
      'conch.drafts',
      JSON.stringify({
        'c-a': {
          text: 'with a picture',
          attachments: [{ ...note, id: 'att_gone', name: 'cat.png', kind: 'image' }],
          at: 1,
          synced: true,
        },
      }),
    );
    const { box } = await open('c-a', world.routes);
    expect(box).toHaveValue('with a picture');
    await screen.findByText('No longer here');
    const card = screen.getByRole('button', { name: /cat\.png.*no longer here/ });
    expect(card).toBeInTheDocument();
    // Sending would leave it behind without a word: it has to come off first.
    expect(
      screen.getByRole('button', {
        name: 'Remove the file that’s no longer here, then attach it again',
      }),
    ).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Remove cat.png' }));
    expect(screen.queryByText('No longer here')).toBeNull();
  });
});

describe('The new chat page’s draft', () => {
  it('comes back with its words and the model and mode chosen for it', async () => {
    const world = conch({
      new: {
        text: 'a new idea',
        attachments: [],
        options: { permissionMode: 'plan' },
        updatedAt: 5,
      },
    });
    mockFetch(world.routes);
    renderApp(<ChatView />);
    const box = await screen.findByRole('textbox', { name: 'Message Conch' });
    await waitFor(() => expect(box).toHaveValue('a new idea'));
    expect(useUi.getState().draftOptions).toEqual({ permissionMode: 'plan' });
    // Typing on carries the choices with it.
    await userEvent.type(box, ' and more');
    await waitFor(() =>
      expect(world.puts.at(-1)).toEqual({
        key: 'new',
        body: { text: 'a new idea and more', attachments: [], options: { permissionMode: 'plan' } },
      }),
    );
  });
});

describe('The Draft mark', () => {
  it('marks chats with something unsent, in words, but not the one that is open', async () => {
    const chat = (id: string, title: string): ConversationSummary => ({
      id,
      title,
      preview: '',
      createdAt: Date.now() - 1000,
      updatedAt: Date.now() - 1000,
      status: 'idle',
      options: {},
    });
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/folders': () => [],
      'GET /api/conversations': () => [chat('c-a', 'Lisbon trip'), chat('c-b', 'Groceries')],
      'GET /api/drafts': () => ({ drafts: [{ key: 'c-a', updatedAt: 1 }] }),
    });
    renderApp(<Sidebar />);
    expect(await screen.findByRole('link', { name: 'Lisbon trip Draft' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Groceries' })).toBeInTheDocument();
  });
});
