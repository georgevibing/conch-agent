import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { fireEvent, screen } from '@testing-library/react';
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

  it('arrives ticked and still; only a person’s tick draws itself in', () => {
    const { rerender } = renderNacre(<Checkbox aria-label="Run tests" checked={false} />);
    const box = screen.getByRole('checkbox');
    rerender(<Checkbox aria-label="Run tests" checked />);
    expect(box).toBeChecked();
    expect(box).not.toHaveAttribute('data-moving');
    fireEvent.click(box);
    expect(box).toHaveAttribute('data-moving');
    // Every rule that moves it applies only while a person moves it.
    const css = readFileSync(join(import.meta.dirname, 'Checkbox.module.css'), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    const moving = [...css.matchAll(/([^{}]+)\{[^{}]*\btransition(?:-duration)?\s*:/g)];
    expect(moving.length).toBeGreaterThan(0);
    for (const [, selector] of moving) expect(selector?.trim()).toMatch(/^\.box\[data-moving\]/);
  });
});
