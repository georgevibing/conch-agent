import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { CopyButton } from './CopyButton';

describe('CopyButton', () => {
  it('copies lazily evaluated text and resets', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    const onCopied = vi.fn();
    const { container } = renderNacre(
      <CopyButton value={() => 'hello'} onCopied={onCopied} resetAfter={50} />,
    );
    await expectAccessible(container);
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('hello');
    expect(onCopied).toHaveBeenCalledWith('hello');
    expect(screen.getByRole('button', { name: 'Copied' })).toHaveAttribute('data-copied');
    expect(
      await screen.findByRole('button', { name: 'Copy' }, { timeout: 500 }),
    ).not.toHaveAttribute('data-copied');
  });
});
