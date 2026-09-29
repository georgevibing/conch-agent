import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { StrengthMeter } from './StrengthMeter';

describe('StrengthMeter', () => {
  it('exposes the verdict in words to assistive tech', async () => {
    const { container } = renderNacre(
      <StrengthMeter score={3} label="Good" message="Good password." />,
    );
    const meter = screen.getByRole('meter', { name: 'Password strength' });
    expect(meter).toHaveAttribute('aria-valuenow', '3');
    expect(meter).toHaveAttribute('aria-valuetext', 'Good');
    expect(screen.getByText('Good password.')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-on]')).toHaveLength(3);
    await expectAccessible(container);
  });

  it('stays quiet while empty', () => {
    const { container } = renderNacre(<StrengthMeter score={0} label="Too short" empty />);
    expect(screen.queryByText('Too short')).toBeNull();
    expect(container.querySelector('[data-on]')).toBeNull();
  });
});
