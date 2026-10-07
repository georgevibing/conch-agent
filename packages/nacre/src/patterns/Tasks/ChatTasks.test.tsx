import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { ChatRow } from '../ChatList/ChatRow';
import { ChatTasks, ChatTasksToggle, tasksSummary, tasksTone, type ChatTask } from './ChatTasks';

const NOW = 1_790_000_000_000;

const tasks = (onStop = vi.fn()): ChatTask[] => [
  {
    id: 'a',
    link: <a href="#a">Check the tests</a>,
    status: 'needs-you',
    startedAt: NOW - 70_000,
    current: 'Wants to run npm test',
    onStop,
  },
  {
    id: 'b',
    link: <a href="#b">Write the parser tests</a>,
    status: 'running',
    startedAt: NOW - 95_000,
    current: 'Changing parser.test.ts',
    by: 'Codex CLI',
    onStop,
  },
  {
    id: 'c',
    link: <a href="#c">Read the README</a>,
    status: 'done',
    startedAt: NOW - 200_000,
    finishedAt: NOW - 166_000,
    onStop,
  },
];

function Controlled({ items, initial = false }: { items: ChatTask[]; initial?: boolean }) {
  const [open, setOpen] = useState(initial);
  return (
    <ul>
      <ChatRow
        disclosure={
          <ChatTasksToggle
            tasks={items}
            open={open}
            onOpenChange={setOpen}
            chat="Fix the parser"
            aria-controls="tasks"
          />
        }
        below={<ChatTasks id="tasks" tasks={items} open={open} chat="Fix the parser" now={NOW} />}
      >
        <a href="#chat">Fix the parser</a>
      </ChatRow>
    </ul>
  );
}

describe('ChatTasks', () => {
  it('says done is done without a reason to look, and worth a look with one', async () => {
    const { container } = renderNacre(
      <Controlled
        initial
        items={[
          {
            id: 'finished',
            link: <a href="#finished">Read the source</a>,
            status: 'unverified',
            startedAt: NOW - 34_000,
            finishedAt: NOW,
          },
          {
            id: 'look',
            link: <a href="#look">Send the drafts</a>,
            status: 'unverified',
            worth: 'Couldn’t confirm one of its actions worked.',
            startedAt: NOW - 20_000,
            finishedAt: NOW,
          },
        ]}
      />,
    );
    const list = screen.getByRole('list', { name: 'Tasks from Fix the parser' });
    expect(list).toHaveTextContent('Done · 34s');
    expect(list).toHaveTextContent('Done, Worth a look · 20s');
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
    await expectAccessible(container);
  });

  it('says how many, and what needs you first, in words', () => {
    expect(tasksSummary(tasks())).toBe('3 tasks · 1 needs you, 1 working');
    expect(tasksSummary([{ status: 'queued' }])).toBe('1 task · 1 waiting');
    expect(tasksSummary([{ status: 'done' }, { status: 'failed' }])).toBe(
      '2 tasks · 1 didn’t finish',
    );
    expect(tasksSummary([{ status: 'done' }])).toBe('1 task');
  });

  it('shows on the badge how they’re going, all together', () => {
    expect(tasksTone(tasks())).toBe('needs');
    expect(tasksTone([{ status: 'running' }, { status: 'failed' }])).toBe('working');
    expect(tasksTone([{ status: 'done' }, { status: 'interrupted' }])).toBe('failed');
    expect(tasksTone([{ status: 'done' }, { status: 'stopped' }])).toBe('idle');
  });

  it('opens from a badge on the chat’s own row, into a row per task with where it stands', async () => {
    const user = userEvent.setup();
    const { container } = renderNacre(<Controlled items={tasks()} />);
    const toggle = screen.getByRole('button', {
      name: 'Show tasks from Fix the parser: 3 tasks · 1 needs you, 1 working',
    });
    expect(toggle).toHaveTextContent('3');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', 'tasks');
    // On the chat's line, not a line of its own, and outside the chat's link.
    expect(toggle.closest('a')).toBeNull();
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const list = screen.getByRole('list', { name: 'Tasks from Fix the parser' });
    expect(list).toHaveTextContent('Wants to run npm test');
    expect(list).toHaveTextContent('Changing parser.test.ts · 1 min · by Codex CLI');
    expect(list).toHaveTextContent('Done · 34s');
    expect(screen.getByRole('link', { name: /Check the tests/ })).toHaveAttribute('href', '#a');
    // The chat's own link is still there, apart from its tasks.
    expect(screen.getByRole('link', { name: 'Fix the parser' })).toHaveAttribute('href', '#chat');
    await expectAccessible(container);
  });

  it('says why one didn’t finish, instead of how long it took', () => {
    renderNacre(
      <Controlled
        initial
        items={[
          {
            id: 'f',
            link: <a href="#f">Draft the notes</a>,
            status: 'failed',
            reason: 'The model ran out of room',
            startedAt: NOW - 20_000,
            finishedAt: NOW,
          },
        ]}
      />,
    );
    const link = screen.getByRole('link', { name: /Draft the notes/ });
    expect(link).toHaveTextContent('Didn’t finish: The model ran out of room');
    expect(link).not.toHaveTextContent('20s');
    expect(
      screen.getByRole('button', { name: /Hide tasks from Fix the parser: 1 task · 1 didn’t/ }),
    ).toBeInTheDocument();
  });

  it('stops a going task from the list, and only a going one', async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    renderNacre(<Controlled items={tasks(onStop)} initial />);
    const stops = screen.getAllByRole('button', { name: 'Stop' });
    // The finished one has nothing to stop.
    expect(stops).toHaveLength(2);
    await user.click(stops[0] as HTMLElement);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('works from the keyboard: the chat, then its badge', async () => {
    const user = userEvent.setup();
    renderNacre(<Controlled items={tasks()} />);
    await user.tab();
    expect(screen.getByRole('link', { name: 'Fix the parser' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: /Show tasks/ })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: /Hide tasks/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('says what’s new to you, and folds what you’ve seen under Earlier', async () => {
    const user = userEvent.setup();
    const [, , done] = tasks();
    const fresh = { ...(done as ChatTask), fresh: true };
    const { container } = renderNacre(
      <ChatTasks
        id="tasks"
        open
        chat="Fix the parser"
        now={NOW}
        tasks={[fresh]}
        earlier={[{ ...(done as ChatTask), id: 'old', link: <a href="#old">Lint it</a> }]}
      />,
    );
    expect(screen.getByRole('link', { name: /Read the README ?\(new\)/ })).toBeInTheDocument();
    expect(tasksSummary([fresh])).toBe('1 task · 1 new');
    expect(tasksTone([fresh])).toBe('fresh');
    const earlier = screen.getByRole('button', { name: 'Earlier 1' });
    expect(earlier).toHaveAttribute('aria-expanded', 'false');
    await user.click(earlier);
    expect(earlier).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByRole('list', { name: 'Earlier tasks from Fix the parser' }),
    ).toHaveTextContent('Lint it');
    await expectAccessible(container);
  });

  it('lets a row that goes fold shut where it was, then lets it go', () => {
    vi.useFakeTimers();
    const items = tasks();
    const { rerender } = renderNacre(
      <ChatTasks id="tasks" open chat="Fix the parser" now={NOW} tasks={items} />,
    );
    rerender(
      <ChatTasks
        id="tasks"
        open
        chat="Fix the parser"
        now={NOW}
        tasks={[items[0], items[2]] as ChatTask[]}
      />,
    );
    // Still there a moment, in its place, out of reach.
    const rows = screen.getAllByRole('listitem', { hidden: true });
    expect(rows[1]).toHaveAttribute('data-leaving');
    expect(rows[1]).toHaveTextContent('Write the parser tests');
    expect(screen.queryByRole('link', { name: /Write the parser tests/ })).toBeNull();
    // Once it has folded (here, where nothing animates, once it's had the time).
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByText('Write the parser tests')).toBeNull();
    vi.useRealTimers();
  });

  it('hides the badge while the list is choosing several', () => {
    renderNacre(
      <ul>
        <ChatRow
          selecting
          disclosure={
            <ChatTasksToggle
              tasks={tasks()}
              open={false}
              onOpenChange={vi.fn()}
              chat="Fix the parser"
              aria-controls="tasks"
            />
          }
        >
          <a href="#chat">Fix the parser</a>
        </ChatRow>
      </ul>,
    );
    expect(screen.queryByRole('button', { name: /tasks from/ })).not.toBeInTheDocument();
  });
});
