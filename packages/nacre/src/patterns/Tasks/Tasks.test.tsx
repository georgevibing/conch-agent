import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { elapsed, TaskCard } from './TaskCard';

const NOW = 1_790_000_000_000;

describe('TaskCard', () => {
  it('says how it’s going in words, what it’s doing, and how long it’s been', async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    const { container } = renderNacre(
      <TaskCard
        title="Tidy up the README"
        status="running"
        startedAt={NOW - 95_000}
        now={NOW}
        current="Running npm test"
        steps={['Read README.md']}
        onOpen={() => undefined}
        onStop={onStop}
      />,
    );
    const card = screen.getByRole('article', { name: 'Tidy up the README' });
    expect(card).toHaveTextContent('Working · 1 min');
    expect(card).toHaveTextContent('Running npm test');
    expect(screen.getByRole('list', { name: 'What it did' })).toHaveTextContent('Read README.md');
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onStop).toHaveBeenCalled();
    await expectAccessible(container);
  });

  it('needing you comes first, with the way to answer', () => {
    const onOpen = vi.fn();
    renderNacre(<TaskCard title="Ship it" status="needs-you" onOpen={onOpen} />);
    expect(screen.getByRole('button', { name: 'See what it’s asking' })).toBeInTheDocument();
    expect(screen.getByRole('article')).toHaveTextContent('Needs your OK');
  });

  it('a finished one shows its result; one that didn’t finish offers to try again', async () => {
    const { rerender, container } = renderNacre(
      <TaskCard
        title="Check A"
        kind="helper"
        status="done"
        summary="Found it."
        branch="conch/t1"
        onRemove={() => undefined}
      />,
    );
    expect(screen.getByRole('article', { name: /Helper:\s*Check A/ })).toHaveTextContent(
      'Found it.',
    );
    expect(screen.getByText('conch/t1')).toBeInTheDocument();
    rerender(
      <TaskCard
        title="Check A"
        status="interrupted"
        error="Conch stopped while this was running."
        onRetry={() => undefined}
      />,
    );
    expect(screen.getByRole('button', { name: 'Resume safely' })).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('shows unverified and partial results without claiming completion', async () => {
    const { container, rerender } = renderNacre(
      <TaskCard
        title="Draft follow-ups"
        status="unverified"
        summary="One draft is confirmed."
        error="The second write could not be verified."
        onRetry={() => undefined}
      />,
    );
    expect(screen.getByRole('article')).toHaveTextContent('Result not verified');
    expect(screen.getByRole('article')).toHaveTextContent('One draft is confirmed.');
    expect(screen.queryByText('Verified complete')).not.toBeInTheDocument();
    rerender(
      <TaskCard title="Draft follow-ups" status="stopped" summary="One draft is confirmed." />,
    );
    expect(screen.getByRole('article')).toHaveTextContent('One draft is confirmed.');
    await expectAccessible(container);
  });

  it('reads elapsed time like a person would', () => {
    expect(elapsed(4_000)).toBe('4s');
    expect(elapsed(125_000)).toBe('2 min');
    expect(elapsed(65 * 60_000)).toBe('1 h 5 min');
  });
});
