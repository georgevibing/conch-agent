import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { batchSummary, TaskGroupCard, type TaskGroupItem } from './TaskGroupCard';

const NOW = 1_790_000_000_000;

describe('TaskGroupCard', () => {
  it('says how the batch stands, puts what needs you first, and answers it there', async () => {
    const user = userEvent.setup();
    const onAllow = vi.fn();
    const onOpen = vi.fn();
    const tasks: TaskGroupItem[] = [
      { id: 'a', title: 'Tidy the README', status: 'done', summary: 'Fixed three links.' },
      { id: 'b', title: 'Run the tests', status: 'running', current: 'Running pnpm test' },
      {
        id: 'c',
        title: 'Push the branch',
        status: 'needs-you',
        asking: { summary: 'push to origin', onAllow, onDeny: () => undefined },
      },
    ];
    const { container } = renderNacre(<TaskGroupCard tasks={tasks} onOpen={onOpen} now={NOW} />);
    const card = screen.getByRole('article', { name: '3 tasks' });
    expect(card).toHaveTextContent('1 needs you · 1 working · 1 done');
    expect(screen.getByRole('img', { name: '1 of 3 finished' })).toBeInTheDocument();
    const lines = within(card).getAllByRole('listitem');
    expect(lines[0]).toHaveTextContent('Push the branch');
    expect(lines[1]).toHaveTextContent('Tidy the README');
    expect(lines[1]).toHaveTextContent('Fixed three links.');
    await user.click(
      within(screen.getByRole('group', { name: 'Push the branch is asking' })).getByRole('button', {
        name: 'Allow',
      }),
    );
    expect(onAllow).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /Run the tests/ }));
    expect(onOpen).toHaveBeenCalledWith('b');
    await expectAccessible(container);
  });

  it('once all have finished, the lines are the result: what each did, or why it didn’t', () => {
    renderNacre(
      <TaskGroupCard
        now={NOW}
        tasks={[
          {
            id: 'a',
            title: 'Save the notes',
            status: 'done',
            startedAt: NOW - 60_000,
            finishedAt: NOW - 20_000,
            summary: 'Saved “Notes” successfully.\nArtifact ID: a_a460ef7a7e25954d1f85dc2fe5fe2f3e',
          },
          {
            id: 'b',
            title: 'Write the tests',
            status: 'failed',
            startedAt: NOW - 60_000,
            finishedAt: NOW - 30_000,
            error: 'There’s no sample export to test against.',
          },
        ]}
      />,
    );
    const card = screen.getByRole('article', { name: '2 tasks' });
    expect(card).toHaveTextContent('1 done · 1 didn’t finish · 40s');
    expect(card).toHaveTextContent('Saved “Notes” successfully.');
    expect(card).not.toHaveTextContent('a_a460');
    expect(card).toHaveTextContent('There’s no sample export to test against.');
    expect(card.querySelector('[data-open]')).toBeNull();
  });

  it('counts in words', () => {
    expect(
      batchSummary([{ status: 'needs-you' }, { status: 'needs-you' }, { status: 'queued' }]),
    ).toBe('2 need you · 1 waiting');
  });
});
