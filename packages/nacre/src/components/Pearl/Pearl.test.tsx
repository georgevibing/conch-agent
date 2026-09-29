import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { Pearl } from './Pearl';

describe('Pearl', () => {
  it('announces its state as a status', async () => {
    const { container } = renderNacre(<Pearl state="thinking" />);
    expect(screen.getByRole('status', { name: 'Thinking' })).toHaveAttribute(
      'data-state',
      'thinking',
    );
    await expectAccessible(container);
  });

  it('accepts a custom label', () => {
    renderNacre(<Pearl state="streaming" label="Claude is writing" />);
    expect(screen.getByRole('status', { name: 'Claude is writing' })).toBeInTheDocument();
  });

  it('can be decorative', async () => {
    const { container } = renderNacre(<Pearl label={null} />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(container.querySelector('[data-state]')).toHaveAttribute('aria-hidden', 'true');
    await expectAccessible(container);
  });
});
