import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { elapsed, TaskCard } from './TaskCard';

const NOW = 1_790_000_000_000;

describe('TaskCard', () => {
  it('finishes without criteria without a warning or a misleading retry', async () => {
    const { container } = renderNacre(
      <TaskCard
        title="Read the source"
        status="unverified"
        unchecked
        summary="The report is available."
        onRetry={() => undefined}
        onOpen={() => undefined}
      />,
    );
    expect(screen.getByRole('article')).toHaveTextContent('Finished — outcome not checked');
    expect(screen.queryByText('Verified complete')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume safely' })).not.toBeInTheDocument();
    await expectAccessible(container);
  });
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

  it('says which provider is doing it when it isn’t the chat’s own', async () => {
    const { container } = renderNacre(
      <TaskCard
        title="Write the tests"
        kind="helper"
        status="running"
        startedAt={NOW - 4_000}
        now={NOW}
        by="Codex CLI"
      />,
    );
    expect(screen.getByRole('article', { name: /Write the tests/ })).toHaveTextContent(
      'Working · 4s · by Codex CLI',
    );
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

  it('answers what it’s asking right on the card, and says its mode and where it came from', async () => {
    const user = userEvent.setup();
    const onAllow = vi.fn();
    const onDeny = vi.fn();
    const { container } = renderNacre(
      <TaskCard
        title="Check the tests"
        kind="helper"
        status="needs-you"
        mode="Ask first"
        from={<a href="#chat">Fix the parser</a>}
        current="Wants to run npm test"
        asking={{ summary: 'run npm test', command: 'npm test -- --run', onAllow, onDeny }}
        onOpen={() => undefined}
      />,
    );
    const card = screen.getByRole('article', { name: /Check the tests/ });
    expect(card).toHaveTextContent('Needs your OK · Ask first · from Fix the parser');
    const asking = screen.getByRole('group', { name: 'It’s asking' });
    expect(asking).toHaveTextContent('Wants to run npm test');
    expect(asking).toHaveTextContent('npm test -- --run');
    // Answered here, so the card doesn't also send you away to answer it.
    expect(screen.queryByRole('button', { name: 'See what it’s asking' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Allow' }));
    expect(onAllow).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Deny' }));
    expect(onDeny).toHaveBeenCalled();
    await expectAccessible(container);
  });

  it('reads elapsed time like a person would', () => {
    expect(elapsed(4_000)).toBe('4s');
    expect(elapsed(125_000)).toBe('2 min');
    expect(elapsed(65 * 60_000)).toBe('1 h 5 min');
  });
});
