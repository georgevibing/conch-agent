import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { Switch } from './Switch';

describe('Switch', () => {
  it('is an accessible switch', async () => {
    const { container } = renderNacre(<Switch label="Stream" description="Token by token" />);
    const sw = screen.getByRole('switch', { name: 'Stream' });
    expect(sw).toHaveAccessibleDescription('Token by token');
    await expectAccessible(container);
  });

  it('toggles with click and keyboard', async () => {
    const onCheckedChange = vi.fn();
    renderNacre(<Switch aria-label="Stream" onCheckedChange={onCheckedChange} />);
    const sw = screen.getByRole('switch');
    await userEvent.click(sw);
    expect(sw).toBeChecked();
    sw.focus();
    await userEvent.keyboard('{Enter}');
    expect(sw).not.toBeChecked();
    await userEvent.keyboard(' ');
    expect(sw).toBeChecked();
    expect(onCheckedChange).toHaveBeenLastCalledWith(true);
  });
});
