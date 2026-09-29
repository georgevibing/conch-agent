import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { Separator } from './Separator';

describe('Separator', () => {
  it('is decorative by default', async () => {
    const { container } = renderNacre(<Separator />);
    expect(screen.queryByRole('separator')).toBeNull();
    await expectAccessible(container);
  });

  it('exposes a semantic separator when not decorative', () => {
    renderNacre(<Separator decorative={false} orientation="vertical" />);
    expect(screen.getByRole('separator')).toHaveAttribute('aria-orientation', 'vertical');
  });

  it('renders a label', async () => {
    const { container } = renderNacre(<Separator label="Today" decorative={false} />);
    expect(screen.getByRole('separator')).toHaveTextContent('Today');
    await expectAccessible(container);
  });
});
