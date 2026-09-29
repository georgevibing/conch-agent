import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { Skeleton } from './Skeleton';

describe('Skeleton', () => {
  it('is hidden from assistive tech', async () => {
    const { container } = renderNacre(<Skeleton lines={3} />);
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
    await expectAccessible(container);
  });

  it('renders children once loaded', () => {
    renderNacre(
      <Skeleton loading={false}>
        <p>Loaded</p>
      </Skeleton>,
    );
    expect(screen.getByText('Loaded')).toBeInTheDocument();
  });

  it('renders one bar per line', () => {
    const { container } = renderNacre(<Skeleton lines={4} />);
    expect(container.querySelectorAll('[data-shape="text"]')).toHaveLength(4);
  });
});
