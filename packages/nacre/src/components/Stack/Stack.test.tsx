import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderNacre } from '../../test/render';
import { Stack } from './Stack';

describe('Stack', () => {
  it('maps gap and alignment to styles', () => {
    renderNacre(
      <Stack data-testid="s" direction="row" gap={2.5} align="center" justify="between">
        a
      </Stack>,
    );
    const el = screen.getByTestId('s');
    expect(el.style.gap).toBe('var(--nc-space-2-5)');
    expect(el.style.flexDirection).toBe('row');
    expect(el.style.justifyContent).toBe('space-between');
  });
});
