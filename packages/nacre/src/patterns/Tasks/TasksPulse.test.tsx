import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { pulseSummary, TasksPulse, type PulseTask } from './TasksPulse';

const task = (over: Partial<PulseTask> & Pick<PulseTask, 'id' | 'status'>): PulseTask => ({
  link: <a href={`#${over.id}`}>Task {over.id}</a>,
  ...over,
});

describe('TasksPulse', () => {
  it('rests, and offers nothing, when nothing is going', () => {
    renderNacre(<TasksPulse tasks={[]}>Conch</TasksPulse>);
    expect(screen.getByText('Conch')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('is left out of the header when nothing is going', () => {
    renderNacre(<TasksPulse tasks={[]} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('says what is going, and lists it, waiting for you first', async () => {
    const user = userEvent.setup();
    const onAllow = vi.fn();
    renderNacre(
      <TasksPulse
        tasks={[
          task({ id: 'a', status: 'running', chat: 'Release', current: 'Running tests' }),
          task({
            id: 'b',
            status: 'needs-you',
            current: 'Wants to push',
            asking: { onAllow, onDeny: () => undefined },
          }),
        ]}
      >
        Conch
      </TasksPulse>,
    );
    await user.click(screen.getByRole('button', { name: 'Conch: 1 task working, 1 needs you' }));
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Task b');
    expect(items[1]).toHaveTextContent('Running tests · Release');
    await user.click(screen.getByRole('button', { name: 'Allow' }));
    expect(onAllow).toHaveBeenCalled();
    await expectAccessible(document.body);
  });

  it('closes when a task is opened', async () => {
    const user = userEvent.setup();
    renderNacre(<TasksPulse tasks={[task({ id: 'a', status: 'running' })]} />);
    await user.click(screen.getByRole('button', { name: '1 task working' }));
    await user.click(screen.getByRole('link', { name: 'Task a' }));
    expect(screen.queryByRole('link', { name: 'Task a' })).not.toBeInTheDocument();
  });

  it('opens from the keyboard', async () => {
    const user = userEvent.setup();
    renderNacre(<TasksPulse tasks={[task({ id: 'a', status: 'queued' })]}>Conch</TasksPulse>);
    await user.tab();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('link', { name: 'Task a' })).toBeInTheDocument();
  });
});

describe('pulseSummary', () => {
  it('names what is going in a few words', () => {
    expect(pulseSummary([{ status: 'running' }, { status: 'running' }])).toBe('2 tasks working');
    expect(pulseSummary([{ status: 'needs-you' }])).toBe('1 task needs you');
    expect(
      pulseSummary([{ status: 'running' }, { status: 'needs-you' }, { status: 'queued' }]),
    ).toBe('1 task working, 1 needs you, 1 waiting');
    expect(pulseSummary([{ status: 'queued' }, { status: 'queued' }])).toBe('2 tasks waiting');
  });
});
