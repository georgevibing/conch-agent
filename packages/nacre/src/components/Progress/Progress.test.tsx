import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { Progress } from './Progress';

describe('Progress', () => {
  it('exposes progressbar semantics labelled by the visible label', async () => {
    const { container } = renderNacre(<Progress value={40} label="Indexing" showValue />);
    const bar = screen.getByRole('progressbar', { name: 'Indexing' });
    expect(bar).toHaveAttribute('aria-valuenow', '40');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(screen.getByText('40%')).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('clamps out-of-range values', () => {
    renderNacre(<Progress value={180} aria-label="Clamp" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });

  it('renders indeterminate without a value', async () => {
    const { container } = renderNacre(<Progress aria-label="Loading" />);
    const bar = screen.getByRole('progressbar', { name: 'Loading' });
    expect(bar).not.toHaveAttribute('aria-valuenow');
    expect(bar).toHaveAttribute('data-state', 'indeterminate');
    await expectAccessible(container);
  });
});
