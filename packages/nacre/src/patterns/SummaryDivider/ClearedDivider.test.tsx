import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { ClearedDivider } from './ClearedDivider';

describe('ClearedDivider', () => {
  it('says the assistant starts fresh, and offers Undo while it can', async () => {
    const onUndo = vi.fn();
    const { container } = renderNacre(<ClearedDivider name="Conch" onUndo={onUndo} />);
    expect(screen.getByRole('note')).toHaveTextContent(
      'Context cleared: Conch starts fresh from here',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Undo clearing the context' }));
    expect(onUndo).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });

  it('is only a line once it can’t be undone', () => {
    renderNacre(<ClearedDivider />);
    expect(screen.getByRole('note')).toHaveTextContent('the assistant starts fresh');
    expect(screen.queryByRole('button')).toBeNull();
  });
});
