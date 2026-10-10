import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { TaskCard } from './TaskCard';
import { TaskGroupCard, type TaskGroupItem } from './TaskGroupCard';
import { taskWaitingLine, taskWaitingWhen } from './waiting';

const NOW = 1_790_000_000_000;

describe('a waiting task says why (ADR 0128)', () => {
  it('its card says the reason, counts down a retry, and offers Start now only when given', async () => {
    const user = userEvent.setup();
    const onStartNow = vi.fn();
    const { container, rerender } = renderNacre(
      <TaskCard
        title="Check the docs build"
        status="queued"
        now={NOW}
        waiting={{ words: 'Starts when one of the 4 working finishes', onStartNow }}
        onStop={() => undefined}
      />,
    );
    const card = screen.getByRole('article', { name: 'Check the docs build' });
    expect(card).toHaveTextContent('Waiting');
    expect(card).toHaveTextContent('Starts when one of the 4 working finishes');
    await user.click(screen.getByRole('button', { name: 'Start now' }));
    expect(onStartNow).toHaveBeenCalledOnce();
    await expectAccessible(container);

    rerender(
      <TaskCard
        title="Check the docs build"
        status="queued"
        now={NOW}
        waiting={{ words: 'Codex asked Conch to slow down', retryAt: NOW + 20_000 }}
      />,
    );
    expect(card).toHaveTextContent('Codex asked Conch to slow down · trying again in 20s');
    expect(screen.queryByRole('button', { name: 'Start now' })).not.toBeInTheDocument();

    // Once it's working, the reason goes.
    rerender(
      <TaskCard
        title="Check the docs build"
        status="running"
        now={NOW}
        current="Running the build"
        waiting={{ words: 'Codex asked Conch to slow down', onStartNow }}
      />,
    );
    expect(card).not.toHaveTextContent('slow down');
    expect(screen.queryByRole('button', { name: 'Start now' })).not.toBeInTheDocument();
  });

  it('on a batch, each waiting line says why, the header how many fit, and Start now names its task', async () => {
    const user = userEvent.setup();
    const onStartNow = vi.fn();
    const tasks: TaskGroupItem[] = [
      { id: 'a', title: 'Fix the login', status: 'running', current: 'Changing src/auth.ts' },
      {
        id: 'b',
        title: 'Tidy the auth helpers',
        status: 'queued',
        waiting: { words: 'Starts when “Fix the login” finishes: both change auth.ts' },
      },
      {
        id: 'c',
        title: 'Check the docs build',
        status: 'queued',
        waiting: {
          words: 'Starts when “Fix the login” finishes',
          expectedAt: NOW + 3 * 60_000,
          onStartNow,
        },
      },
      { id: 'd', title: 'Look into the search', status: 'queued' },
    ];
    const { container } = renderNacre(
      <TaskGroupCard tasks={tasks} now={NOW} capacity="1 at once on this computer right now" />,
    );
    const card = screen.getByRole('article', { name: '4 tasks' });
    expect(card).toHaveTextContent('1 at once on this computer right now');
    const [, conflict, room, bare] = within(card).getAllByRole('listitem');
    expect(conflict).toHaveTextContent('both change auth.ts');
    expect(room).toHaveTextContent('Starts when “Fix the login” finishes · likely in about 3 min');
    // No reason given: it still says Waiting, never nothing.
    expect(bare).toHaveTextContent('Waiting');
    expect(within(conflict as HTMLElement).queryByRole('button', { name: /Start/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Start “Check the docs build” now' }));
    expect(onStartNow).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });

  it('the header line goes once nothing waits', () => {
    renderNacre(
      <TaskGroupCard
        tasks={[
          { id: 'a', title: 'A', status: 'running' },
          { id: 'b', title: 'B', status: 'running' },
        ]}
        now={NOW}
        capacity="2 at once on this computer right now"
      />,
    );
    expect(screen.getByRole('article')).not.toHaveTextContent('at once');
  });

  it('says when, only while it’s worth saying', () => {
    expect(taskWaitingWhen({ retryAt: NOW + 61_000 }, NOW)).toBe('trying again in 1 min');
    expect(taskWaitingWhen({ retryAt: NOW - 1 }, NOW)).toBeUndefined();
    expect(taskWaitingWhen({ expectedAt: NOW + 10_000 }, NOW)).toBeUndefined();
    expect(taskWaitingLine({ words: 'Waiting while Conch recovers' }, NOW)).toBe(
      'Waiting while Conch recovers',
    );
  });
});
