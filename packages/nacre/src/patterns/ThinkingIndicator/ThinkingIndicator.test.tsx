import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { formatElapsed, ThinkingIndicator, verbAt } from './ThinkingIndicator';

describe('ThinkingIndicator', () => {
  it('is a polite status with its label', async () => {
    const { container } = renderNacre(<ThinkingIndicator label="Reading files" detail="a.ts" />);
    expect(screen.getByRole('status')).toHaveTextContent('Reading files');
    expect(screen.getByRole('status')).toHaveTextContent('a.ts');
    await expectAccessible(container);
  });

  it('shows elapsed time', () => {
    renderNacre(<ThinkingIndicator startedAt={Date.now() - 12_000} />);
    expect(screen.getByText('12s')).toBeInTheDocument();
  });

  it('formats elapsed durations', () => {
    expect(formatElapsed(900)).toBe('0s');
    expect(formatElapsed(65_000)).toBe('1m 05s');
  });

  it('announces a stable label while verbs change, and shows the thought trail', async () => {
    const { container } = renderNacre(
      <ThinkingIndicator
        verbs={['Listening', 'Untangling it']}
        srLabel="Claude is thinking"
        trail="Weighing the options"
        orb={false}
      />,
    );
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Claude is thinking');
    expect(container.querySelector('[aria-hidden] [class*="word"]')).toHaveTextContent('Listening');
    await expectAccessible(container);
  });

  it('opens with the first verb briefly, then cycles the rest from the clock', () => {
    expect(verbAt(0, 3, 3000).index).toBe(0);
    expect(verbAt(1600, 3, 3000).index).toBe(1);
    expect(verbAt(4600, 3, 3000).index).toBe(2);
    expect(verbAt(7600, 3, 3000).index).toBe(1);
    expect(verbAt(1600, 3, 3000).next).toBe(2900);
    expect(verbAt(99_000, 1, 3000).index).toBe(0);
  });
});
