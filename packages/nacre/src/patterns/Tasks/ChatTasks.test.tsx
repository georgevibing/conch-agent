import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { ChatRow } from '../ChatList/ChatRow';
import { ChatTasks, tasksSummary, type ChatTask } from './ChatTasks';

const NOW = 1_790_000_000_000;

const tasks = (onStop = vi.fn()): ChatTask[] => [
  {
    id: 'a',
    link: <a href="#a">Check the tests</a>,
    kind: 'helper',
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
    finishedAt: NOW - 150_000,
    onStop,
  },
];

function Controlled({ items, initial = false }: { items: ChatTask[]; initial?: boolean }) {
  const [open, setOpen] = useState(initial);
  return (
    <ul>
      <ChatRow
        below={
          <ChatTasks
            tasks={items}
            open={open}
            onOpenChange={setOpen}
            chat="Fix the parser"
            now={NOW}
          />
        }
      >
        <a href="#chat">Fix the parser</a>
      </ChatRow>
    </ul>
  );
}

describe('ChatTasks', () => {
  it('says how many, and what needs you first, in words', () => {
    expect(tasksSummary(tasks())).toBe('3 tasks · 1 needs you, 1 working');
    expect(tasksSummary([{ status: 'queued' }])).toBe('1 task · 1 waiting');
    expect(tasksSummary([{ status: 'done' }, { status: 'failed' }])).toBe('2 tasks');
  });

  it('opens into a row per task under its chat, each a link with where it stands', async () => {
    const user = userEvent.setup();
    const { container } = renderNacre(<Controlled items={tasks()} />);
    const toggle = screen.getByRole('button', { name: /Show tasks from Fix the parser/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const list = screen.getByRole('list', { name: 'Tasks from Fix the parser' });
    expect(list).toHaveTextContent('Wants to run npm test');
    expect(list).toHaveTextContent('Changing parser.test.ts · 1 min · by Codex CLI');
    expect(list).toHaveTextContent('Done');
    expect(screen.getByRole('link', { name: /Check the tests/ })).toHaveAttribute('href', '#a');
    // The chat's own link is still there, apart from its tasks.
    expect(screen.getByRole('link', { name: 'Fix the parser' })).toHaveAttribute('href', '#chat');
    await expectAccessible(container);
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

  it('works from the keyboard', async () => {
    const user = userEvent.setup();
    renderNacre(<Controlled items={tasks()} />);
    await user.tab();
    await user.tab();
    expect(screen.getByRole('button', { name: /Show tasks/ })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: /Hide tasks/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });
});
