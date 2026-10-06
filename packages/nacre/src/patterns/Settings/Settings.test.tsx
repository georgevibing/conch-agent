import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Switch } from '../../components/Switch';
import { expectAccessible, renderNacre } from '../../test/render';
import { SettingsAdvanced } from './SettingsAdvanced';

describe('SettingsAdvanced', () => {
  it('keeps what almost nobody needs away until it’s asked for', async () => {
    const { container } = renderNacre(
      <SettingsAdvanced>
        <Switch label="Fast mode" />
      </SettingsAdvanced>,
    );
    const trigger = screen.getByRole('button', { name: 'Advanced' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('switch', { name: 'Fast mode' })).toBeNull();
    await expectAccessible(container);

    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('switch', { name: 'Fast mode' })).toBeVisible();
  });

  it('opens from the keyboard, and the page can hold it open', async () => {
    const onOpenChange = vi.fn();
    const { rerender } = renderNacre(
      <SettingsAdvanced open={false} onOpenChange={onOpenChange} label="More">
        <Switch label="Fast mode" />
      </SettingsAdvanced>,
    );
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'More' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onOpenChange).toHaveBeenCalledWith(true);

    rerender(
      <SettingsAdvanced open onOpenChange={onOpenChange} label="More">
        <Switch label="Fast mode" />
      </SettingsAdvanced>,
    );
    expect(screen.getByRole('switch', { name: 'Fast mode' })).toBeVisible();
  });
});
