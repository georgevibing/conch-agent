import type { Task } from '@conch/protocol';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appState, FakeSocket, mockFetch, renderApp } from '../../test/harness';
import { Sidebar } from '../sidebar/Sidebar';
import { TasksView } from './TasksView';

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

describe('Tasks', () => {
  it('shows what needs you first, then what’s working, then what finished', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/tasks': () => ({
        concurrent: 3,
        tasks: [
          task({ id: 'a', title: 'Working one' }),
          task({ id: 'b', title: 'Asking one', status: 'needs-you' }),
          task({ id: 'c', title: 'Old one', status: 'done', summary: 'All tidy.', finishedAt: 1 }),
        ],
      }),
    });
    renderApp(<TasksView />);
    const now = await screen.findByRole('region', { name: 'Working on it' });
    const cards = within(now).getAllByRole('article');
    expect(cards.map((c) => c.getAttribute('data-status'))).toEqual(['needs-you', 'running']);
    expect(
      within(cards[0] as HTMLElement).getByRole('button', { name: 'See what it’s asking' }),
    ).toBeInTheDocument();
    expect(within(cards[1] as HTMLElement).getByText('npm test')).toBeInTheDocument();
    const done = screen.getByRole('region', { name: 'Finished' });
    expect(within(done).getByText('All tidy.')).toBeInTheDocument();
    expect(screen.getByText(/Up to 3 work at once/)).toBeInTheDocument();
  });

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
    renderApp(<TasksView />);
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

  it('an older copy arriving late never undoes a newer one', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      // What the server has now: the newest copy.
      'GET /api/tasks': () => ({ concurrent: 3, tasks: [latest] }),
    });
    let latest = task({ rev: 3 });
    renderApp(<TasksView />);
    const card = await screen.findByRole('article', { name: 'Tidy up the README' });
    await waitFor(() => expect(FakeSocket.last).toBeDefined());
    latest = task({ status: 'stopped', rev: 4 });
    act(() => FakeSocket.last?.push({ type: 'task.changed', task: latest }));
    act(() => FakeSocket.last?.push({ type: 'task.changed', task: task({ rev: 2 }) }));
    // Finished, it moves down to Finished, and stays there.
    await waitFor(() =>
      expect(screen.getByRole('article', { name: 'Tidy up the README' })).toHaveAttribute(
        'data-status',
        'stopped',
      ),
    );
    expect(card).not.toBeInTheDocument();
  });

  it('says how to start one when there are none', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/tasks': () => ({ concurrent: 3, tasks: [] }),
    });
    renderApp(<TasksView />);
    expect(await screen.findByText('Nothing in the background')).toBeInTheDocument();
  });

  it('the sidebar counts what needs you, live, and keeps task chats out of the list', async () => {
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
    expect(await screen.findByLabelText('1 working')).toBeInTheDocument();
    await waitFor(() => expect(FakeSocket.last).toBeDefined());
    act(() => FakeSocket.last?.push({ type: 'task.changed', task: task({ status: 'needs-you' }) }));
    expect(await screen.findByLabelText('1 need your OK')).toBeInTheDocument();
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

  it('a chat’s tasks are under it in the sidebar, open while they work, each opening its chat', async () => {
    const user = userEvent.setup();
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [chat(), chat({ id: 'c2', title: 'Quiet one' })],
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
            finishedAt: Date.now() - 1000,
          }),
          // Long finished: only on Tasks and in its chat, not under the chat any more.
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
      name: 'Hide tasks from Fix the parser: 2 tasks · 1 working',
    });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // A badge on the chat's own row, not a line of its own.
    expect(toggle).toHaveTextContent('2');
    expect(toggle.closest('li')).toHaveTextContent('Fix the parser');
    const list = screen.getByRole('list', { name: 'Tasks from Fix the parser' });
    expect(within(list).getByText('npm test')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /tasks from Quiet one/ })).not.toBeInTheDocument();
    await user.click(within(list).getAllByRole('button', { name: 'Stop' })[0] as HTMLElement);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toContain('POST /api/tasks/h1/stop');
    await user.click(within(list).getByRole('link', { name: /Read the README/ }));
    await waitFor(() => expect(where()).toBe('/c/c-h2'));
    // Closed by hand, it stays closed.
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('what a task is asking is answered from the chat it came from', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [chat()],
      'GET /api/tasks': () => ({
        concurrent: 3,
        tasks: [
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
          }),
        ],
      }),
    });
    renderApp(<TasksView />);
    const card = await screen.findByRole('article', { name: /Check the tests/ });
    expect(card).toHaveTextContent('Ask first');
    await waitFor(() => expect(card).toHaveTextContent('from Fix the parser'));
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
});
