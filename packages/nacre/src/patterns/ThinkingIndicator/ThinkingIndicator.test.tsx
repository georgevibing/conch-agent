import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { formatElapsed, ThinkingIndicator } from './ThinkingIndicator';

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
});
