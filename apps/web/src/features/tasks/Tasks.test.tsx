import type { Task } from '@conch/protocol';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appState, FakeSocket, mockFetch, renderApp } from '../../test/harness';
import { Sidebar } from '../sidebar/Sidebar';
import { LiveTaskCard } from './LiveTaskCard';
import { TaskChatCard } from './TaskChatCard';
import { useTask } from './queries';
import { TasksMoved } from './TasksMoved';

afterEach(() => vi.unstubAllGlobals());

const task = (patch: Partial<Task> = {}): Task => ({
  id: 't1',
  kind: 'background',
  title: 'Tidy up the README',
  prompt: 'Tidy up the README',
  status: 'running',
  options: {},
  createdAt: Date.now() - 60_000,
  startedAt: Date.now() - 60_000,
  steps: [{ at: Date.now(), label: 'Ran `npm test`' }],
  conversationId: 'c-task',
  rev: 1,
  ...patch,
});

/** One task's card, live: what the chat it came from shows. */
function Card({ id }: { id: string }) {
  const found = useTask(id);
  return found ? <LiveTaskCard task={found} /> : null;
}

describe('Tasks', () => {
  it('stops one and tries one again', async () => {
    const user = userEvent.setup();
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/tasks': () => ({
        concurrent: 3,
        tasks: [
          task(),
          task({
            id: 't2',
            title: 'Cut off',
            status: 'interrupted',
            error: 'Conch stopped while this was running.',
          }),
        ],
      }),
      'POST /api/tasks/t1/stop': () => task({ status: 'stopped', finishedAt: Date.now() }),
      'POST /api/tasks/t2/retry': () => task({ id: 't2', title: 'Cut off', status: 'queued' }),
    });
    renderApp(
      <>
        <Card id="t1" />
        <Card id="t2" />
      </>,
    );
    await user.click(await screen.findByRole('button', { name: 'Stop' }));
    await user.click(
      within(screen.getByRole('article', { name: 'Cut off' })).getByRole('button', {
        name: 'Resume safely',
      }),
    );
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(
      expect.arrayContaining(['POST /api/tasks/t1/stop', 'POST /api/tasks/t2/retry']),
    );
    await waitFor(() =>
      expect(screen.getByRole('article', { name: 'Tidy up the README' })).toHaveAttribute(
        'data-status',
        'stopped',
      ),
    );
  });

  it('says which of its actions it couldn’t confirm, and never counts one Conch held before it ran', async () => {
    const user = userEvent.setup();
    mockFetch({ 'GET /api/state': () => appState(), 'GET /api/tasks': () => ({ tasks: [] }) });
    const op = (id: string, patch: Partial<NonNullable<Task['operations']>[number]>) => ({
      id,
      key: id,
      tool: 'Bash',
      effect: 'unknown' as const,
      state: 'unresolved' as const,
      account: 'native',
      authorization: 'per-turn',
      expiresAt: 1,
      startedAt: 1,
      ...patch,
    });
    renderApp(
      <LiveTaskCard
        task={task({
          status: 'unverified',
          finishedAt: Date.now(),
          completion: 'response',
          summary: 'Made the file.',
          delivery: { goalRevision: 0, attempt: 0, at: 1 },
          operations: [
            op('held-1', { state: 'not-run', refused: true }),
            op('held-2', { state: 'not-run', refused: true }),
            op('lost', { execution: 'failed' }),
          ],
        })}
      />,
    );
    const card = screen.getByRole('article', { name: 'Tidy up the README' });
    expect(within(card).getByText('Couldn’t confirm one of its commands worked.')).toBeVisible();
    await user.click(within(card).getByRole('button', { name: /Details/ }));
    expect(
      within(card).getByText(
        'Conch couldn’t confirm whether one of its commands worked, so it won’t run that again by itself.',
      ),
    ).toBeVisible();
  });

  it('an older copy arriving late never undoes a newer one', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      // What the server has now: the newest copy.
      'GET /api/tasks': () => ({ concurrent: 3, tasks: [latest] }),
    });
    let latest = task({ rev: 3 });
    renderApp(<Card id="t1" />);
    await screen.findByRole('article', { name: 'Tidy up the README' });
    await waitFor(() => expect(FakeSocket.last).toBeDefined());
    latest = task({ status: 'stopped', rev: 4 });
    act(() => FakeSocket.last?.push({ type: 'task.changed', task: latest }));
    act(() => FakeSocket.last?.push({ type: 'task.changed', task: task({ rev: 2 }) }));
    await waitFor(() =>
      expect(screen.getByRole('article', { name: 'Tidy up the README' })).toHaveAttribute(
        'data-status',
        'stopped',
      ),
    );
  });

  it('an old link to Tasks lands on the chat of the task most worth seeing', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/tasks': () => ({
        concurrent: 3,
        tasks: [
          task({ id: 'a', parentConversationId: 'c1' }),
          task({ id: 'b', status: 'needs-you', parentConversationId: 'c2', createdAt: 1 }),
        ],
      }),
    });
    const { where } = renderApp(
      <Routes>
        <Route path="/tasks" element={<TasksMoved />} />
        <Route path="*" element={null} />
      </Routes>,
      { route: '/tasks' },
    );
    await waitFor(() => expect(where()).toBe('/c/c2'));
  });

  it('with nothing in the background, an old link to Tasks lands on a new chat', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/tasks': () => ({ concurrent: 3, tasks: [] }),
    });
    const { where } = renderApp(
      <Routes>
        <Route path="/tasks" element={<TasksMoved />} />
        <Route path="*" element={null} />
      </Routes>,
      { route: '/tasks' },
    );
    await waitFor(() => expect(where()).toBe('/'));
  });

  it('the pearl says what’s going, live, and task chats stay out of the list', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [
        {
          id: 'c1',
          title: 'Mine',
          preview: '',
          createdAt: 1,
          updatedAt: Date.now(),
          status: 'idle',
          options: {},
        },
        {
          id: 'c-task',
          title: 'Tidy up the README',
          preview: '',
          createdAt: 1,
          updatedAt: Date.now(),
          status: 'running',
          options: {},
          origin: { kind: 'task', taskId: 't1' },
        },
      ],
      'GET /api/tasks': () => ({ concurrent: 3, tasks: [task()] }),
    });
    renderApp(<Sidebar />);
    await screen.findByText('Mine');
    expect(screen.queryByRole('link', { name: 'Tidy up the README' })).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Conch: 1 task working' })).toBeVisible();
    await waitFor(() => expect(FakeSocket.last).toBeDefined());
    act(() =>
      FakeSocket.last?.push({ type: 'task.changed', task: task({ status: 'needs-you', rev: 2 }) }),
    );
    expect(await screen.findByRole('button', { name: 'Conch: 1 task needs you' })).toBeVisible();
    act(() =>
      FakeSocket.last?.push({
        type: 'task.changed',
        task: task({ status: 'done', finishedAt: Date.now(), rev: 3 }),
      }),
    );
    // Nothing going: the pearl rests, and there's nothing to press.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /^Conch/ })).not.toBeInTheDocument(),
    );
  });

  it('a task sent from no chat is a chat of its own in the list', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [
        {
          id: 'c-task',
          title: 'Draft the weekly note',
          preview: '',
          createdAt: 1,
          updatedAt: Date.now(),
          status: 'idle',
          options: {},
          origin: { kind: 'task', taskId: 't1', standalone: true },
        },
      ],
      'GET /api/tasks': () => ({ concurrent: 3, tasks: [task({ status: 'done', finishedAt: 1 })] }),
    });
    renderApp(<Sidebar />);
    expect(await screen.findByText('Draft the weekly note')).toBeInTheDocument();
  });

  const asking = () =>
    task({
      kind: 'helper',
      title: 'Check the tests',
      status: 'needs-you',
      parentConversationId: 'c1',
      options: { permissionMode: 'default' },
      asking: {
        permissionId: 'perm1',
        summary: 'Run `npm test`',
        toolName: 'Bash',
        here: true,
        command: 'npm test',
      },
    });

  const chat = (patch: Record<string, unknown> = {}) => ({
    id: 'c1',
    title: 'Fix the parser',
    preview: '',
    createdAt: 1,
    updatedAt: Date.now(),
    status: 'idle',
    options: {},
    ...patch,
  });

  it('a chat’s tasks are under it in the sidebar, open while they work, each opening over its chat', async () => {
    const user = userEvent.setup();
    const finished = Date.now() - 1000;
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [
        chat(),
        chat({ id: 'c2', title: 'Quiet one' }),
        // Its chat moved on after you last had it open: new to you.
        chat({
          id: 'c-h2',
          title: 'Read the README',
          origin: { kind: 'task', taskId: 'h2' },
          seenAt: 0,
          updatedAt: finished,
        }),
        // Seen since it finished: folded away under "Earlier".
        chat({
          id: 'c-h3',
          title: 'Lint it',
          origin: { kind: 'task', taskId: 'h3' },
          seenAt: finished,
          updatedAt: finished,
        }),
      ],
      'PATCH /api/conversations/c-h2': () => ({ ok: true }),
      'GET /api/tasks': () => ({
        concurrent: 3,
        tasks: [
          task({
            id: 'h1',
            kind: 'helper',
            title: 'Check the tests',
            parentConversationId: 'c1',
            current: 'Running `npm test`',
          }),
          task({
            id: 'h2',
            kind: 'helper',
            title: 'Read the README',
            parentConversationId: 'c1',
            status: 'done',
            conversationId: 'c-h2',
            finishedAt: finished,
          }),
          task({
            id: 'h3',
            kind: 'helper',
            title: 'Lint it',
            parentConversationId: 'c1',
            status: 'done',
            conversationId: 'c-h3',
            finishedAt: finished - 1000,
          }),
          // Long finished: only in its chat, not under the chat any more.
          task({
            id: 'old',
            title: 'Old one',
            parentConversationId: 'c2',
            status: 'done',
            createdAt: 1,
            finishedAt: 2,
          }),
        ],
      }),
      'POST /api/tasks/h1/stop': () =>
        task({ id: 'h1', kind: 'helper', parentConversationId: 'c1', status: 'stopped' }),
    });
    const { where } = renderApp(<Sidebar />);
    const toggle = await screen.findByRole('button', {
      name: 'Hide tasks from Fix the parser: 2 tasks · 1 working, 1 new',
    });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // A badge on the chat's own row, not a line of its own: what's going or new.
    expect(toggle).toHaveTextContent('2');
    expect(toggle.closest('li')).toHaveTextContent('Fix the parser');
    const list = screen.getByRole('list', { name: 'Tasks from Fix the parser' });
    expect(within(list).getByText('npm test')).toBeInTheDocument();
    expect(
      within(list).getByRole('link', { name: /Read the README ?\(new\)/ }),
    ).toBeInTheDocument();
    // What you've seen is folded away, a press from the rest.
    expect(within(list).queryByRole('link', { name: /Lint it/ })).not.toBeInTheDocument();
    const earlier = within(list).getByRole('button', { name: /Earlier/ });
    expect(earlier).toHaveAttribute('aria-expanded', 'false');
    await user.click(earlier);
    expect(
      within(screen.getByRole('list', { name: 'Earlier tasks from Fix the parser' })).getByRole(
        'link',
        { name: /Lint it/ },
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /tasks from Quiet one/ })).not.toBeInTheDocument();
    await user.click(within(list).getAllByRole('button', { name: 'Stop' })[0] as HTMLElement);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toContain('POST /api/tasks/h1/stop');
    await user.click(within(list).getByRole('link', { name: /Read the README/ }));
    await waitFor(() => expect(where()).toBe('/c/c1?task=h2'));
    // Closed by hand, it stays closed.
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('tidies away: with nothing going or new, a chat is a single line again', async () => {
    const finished = Date.now() - 1000;
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [
        chat(),
        chat({
          id: 'c-h3',
          title: 'Lint it',
          origin: { kind: 'task', taskId: 'h3' },
          seenAt: finished,
          updatedAt: finished,
        }),
      ],
      'GET /api/tasks': () => ({
        concurrent: 3,
        tasks: [
          task({
            id: 'h3',
            title: 'Lint it',
            parentConversationId: 'c1',
            status: 'done',
            conversationId: 'c-h3',
            finishedAt: finished,
          }),
        ],
      }),
    });
    renderApp(<Sidebar />);
    expect(await screen.findByRole('link', { name: /Fix the parser/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /tasks from Fix the parser/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Lint it/ })).toBeNull();
  });

  it('what a task is asking is answered from the chat it came from', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [chat()],
      'GET /api/tasks': () => ({ concurrent: 3, tasks: [asking()] }),
    });
    renderApp(<Card id="t1" />);
    const card = await screen.findByRole('article', { name: /Check the tests/ });
    expect(within(card).getByRole('group', { name: 'It’s asking' })).toHaveTextContent(
      'Wants to run npm test',
    );
    await waitFor(() => expect(FakeSocket.last?.readyState).toBe(1));
    await user.click(within(card).getByRole('button', { name: 'Allow' }));
    expect(FakeSocket.last?.sent).toContainEqual({
      type: 'permission.respond',
      conversationId: 'c-task',
      permissionId: 'perm1',
      decision: 'allow',
    });
  });

  it('the pearl lists what’s going everywhere, and what’s asking is answered there', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [chat()],
      'GET /api/tasks': () => ({
        concurrent: 3,
        tasks: [
          asking(),
          task({ id: 't2', title: 'Write the notes', parentConversationId: 'c1', rev: 2 }),
          task({ id: 't3', title: 'Long done', status: 'done', finishedAt: 1 }),
        ],
      }),
    });
    const { where } = renderApp(<Sidebar />);
    await user.click(
      await screen.findByRole('button', { name: 'Conch: 1 task working, 1 needs you' }),
    );
    const list = await screen.findByRole('dialog', { name: 'Tasks going now' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Check the tests'),
      expect.stringContaining('Write the notes'),
    ]);
    expect(rows[0]).toHaveTextContent('Wants to run npm test');
    await waitFor(() => expect(FakeSocket.last?.readyState).toBe(1));
    await user.click(within(rows[0] as HTMLElement).getByRole('button', { name: 'Allow' }));
    expect(FakeSocket.last?.sent).toContainEqual({
      type: 'permission.respond',
      conversationId: 'c-task',
      permissionId: 'perm1',
      decision: 'allow',
    });
    // It opens over the chat it came from.
    await user.click(within(rows[1] as HTMLElement).getByRole('link', { name: 'Write the notes' }));
    await waitFor(() => expect(where()).toBe('/c/c1?task=t2'));
  });

  it('a waiting task says why on its batch’s card, the header how many fit, and Start now asks the gateway (ADR 0129)', async () => {
    const user = userEvent.setup();
    const batch = [
      task({ id: 'b1', title: 'Fix the login', group: 'g', parentConversationId: 'c1' }),
      task({
        id: 'b2',
        title: 'Tidy the auth helpers',
        status: 'queued',
        startedAt: undefined,
        group: 'g',
        parentConversationId: 'c1',
        waiting: {
          reason: 'conflict',
          words: 'Starts when “Fix the login” finishes: both change auth.ts',
          on: ['b1'],
          canStartNow: false,
        },
      }),
      task({
        id: 'b3',
        title: 'Check the docs build',
        status: 'queued',
        startedAt: undefined,
        group: 'g',
        parentConversationId: 'c1',
        waiting: {
          reason: 'room',
          words: 'Starts when “Fix the login” finishes',
          canStartNow: true,
        },
      }),
    ];
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/tasks': () => ({ concurrent: 1, tasks: batch }),
      'POST /api/tasks/b3/start-now': () => ({ ...batch[2], startNow: true, rev: 2 }),
    });
    renderApp(
      <TaskChatCard
        tasks={batch.map((t) => ({
          taskId: t.id,
          title: t.title,
          taskKind: t.kind,
          state: t.status,
        }))}
      />,
    );
    const card = await screen.findByRole('article', { name: '3 tasks' });
    expect(await within(card).findByText(/both change auth\.ts/)).toBeVisible();
    await waitFor(() => expect(FakeSocket.last).toBeDefined());
    act(() =>
      FakeSocket.last?.push({
        type: 'task.capacity',
        capacity: {
          atOnce: 1,
          working: 1,
          waiting: 2,
          words: '1 at once on this computer right now',
        },
      }),
    );
    expect(await within(card).findByText('1 at once on this computer right now')).toBeVisible();
    // Only the one waiting for room can be started now.
    expect(
      within(card).queryByRole('button', { name: 'Start “Tidy the auth helpers” now' }),
    ).not.toBeInTheDocument();
    await user.click(
      within(card).getByRole('button', { name: 'Start “Check the docs build” now' }),
    );
    expect(calls.map((c) => `${c.method} ${c.path}`)).toContain('POST /api/tasks/b3/start-now');
    // Pressed once: it doesn't offer it again while the gateway starts it.
    await waitFor(() =>
      expect(
        within(card).queryByRole('button', { name: 'Start “Check the docs build” now' }),
      ).not.toBeInTheDocument(),
    );
  });
});
