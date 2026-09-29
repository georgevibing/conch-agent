import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { Badge } from './Badge';

describe('Badge', () => {
  it('renders content with tone and variant attributes', async () => {
    const { container } = renderNacre(
      <Badge tone="success" variant="solid" dot="pulse">
        Connected
      </Badge>,
    );
    const badge = screen.getByText('Connected');
    expect(badge).toHaveAttribute('data-tone', 'success');
    expect(badge).toHaveAttribute('data-variant', 'solid');
    await expectAccessible(container);
  });

  it('hides decorative dot and icon from assistive tech', () => {
    const { container } = renderNacre(
      <Badge dot icon={<svg />}>
        Idle
      </Badge>,
    );
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2);
  });
});
