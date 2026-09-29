import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { Checkbox } from './Checkbox';

describe('Checkbox', () => {
  it('is labelled and described', async () => {
    const { container } = renderNacre(<Checkbox label="Run tests" description="Before commit" />);
    const box = screen.getByRole('checkbox', { name: 'Run tests' });
    expect(box).toHaveAccessibleDescription('Before commit');
    await expectAccessible(container);
  });

  it('toggles by click, label click and Space', async () => {
    const onCheckedChange = vi.fn();
    renderNacre(<Checkbox label="Run tests" onCheckedChange={onCheckedChange} />);
    const box = screen.getByRole('checkbox');
    await userEvent.click(box);
    expect(box).toBeChecked();
    await userEvent.click(screen.getByText('Run tests'));
    expect(box).not.toBeChecked();
    box.focus();
    await userEvent.keyboard(' ');
    expect(box).toBeChecked();
    expect(onCheckedChange).toHaveBeenCalledTimes(3);
  });

  it('exposes indeterminate as mixed', () => {
    renderNacre(<Checkbox aria-label="All" checked="indeterminate" />);
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-checked', 'mixed');
  });

  it('does not toggle when disabled', async () => {
    renderNacre(<Checkbox label="Nope" disabled />);
    await userEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });
});
