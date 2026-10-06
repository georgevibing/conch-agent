import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { StatTile } from './StatTile';

describe('StatTile', () => {
  it('reads as its label, its value once, and its detail', async () => {
    const { container } = renderNacre(
      <StatTile label="Memory" value="56%" detail="20 of 36 GB" trend={{ values: [50, 56] }} />,
    );
    const tile = screen.getByRole('group', { name: 'Memory' });
    expect(tile).toHaveTextContent(/20 of 36 GB/);
    // The turning digits are hidden; the words are not.
    expect(screen.getByText('56%', { selector: '.nc-visually-hidden' })).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('shows a meter with its share in words', async () => {
    const { container } = renderNacre(
      <StatTile label="Disk" value="91%" detail="42 GB free" meter={91} tone="warning" />,
    );
    expect(screen.getByRole('progressbar', { name: 'Disk, 91%' })).toHaveAttribute(
      'aria-valuenow',
      '91',
    );
    expect(screen.getByRole('group')).toHaveAttribute('data-tone', 'warning');
    await expectAccessible(container);
  });
});
