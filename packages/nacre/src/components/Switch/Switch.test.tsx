import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { Switch } from './Switch';

const css = readFileSync(join(import.meta.dirname, 'Switch.module.css'), 'utf8');

/** A switch someone flips: its owner keeps what they chose. */
function Owned({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  return <Switch aria-label="Stream" checked={on} onCheckedChange={setOn} />;
}

/** A switch whose value its owner sets: from data, or once a prompt has answered. */
const Given = ({ on }: { on: boolean }) => (
  <Switch aria-label="Notify" checked={on} onCheckedChange={() => undefined} />
);

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

  describe('moves only when a person moves it', () => {
    afterEach(() => vi.useRealTimers());

    it('arrives on, in its place, with nothing moving', () => {
      renderNacre(<Switch aria-label="Stream" checked onCheckedChange={() => undefined} />);
      const sw = screen.getByRole('switch');
      expect(sw).toBeChecked();
      expect(sw).not.toHaveAttribute('data-moving');
    });

    it('a value that changes by itself (data that loaded) doesn’t move', () => {
      const { rerender } = renderNacre(<Given on={false} />);
      const sw = screen.getByRole('switch');
      rerender(<Given on />);
      expect(sw).toBeChecked();
      expect(sw).not.toHaveAttribute('data-moving');
    });

    it('a click moves it, and once it has settled it rests again', async () => {
      vi.useFakeTimers();
      renderNacre(<Owned initial={false} />);
      const sw = screen.getByRole('switch');
      fireEvent.pointerDown(sw);
      fireEvent.click(sw);
      expect(sw).toBeChecked();
      expect(sw).toHaveAttribute('data-moving');
      await act(() => vi.advanceTimersByTimeAsync(1000));
      expect(sw).not.toHaveAttribute('data-moving');
    });

    it('a key moves it too', async () => {
      const user = userEvent.setup();
      renderNacre(<Owned initial />);
      const sw = screen.getByRole('switch');
      sw.focus();
      await user.keyboard(' ');
      expect(sw).not.toBeChecked();
      expect(sw).toHaveAttribute('data-moving');
    });

    it('a change that lands later, after a prompt or a save, still moves when it lands', async () => {
      vi.useFakeTimers();
      // Its owner decides later (a permission prompt), not at the press.
      const { rerender } = renderNacre(<Given on={false} />);
      const sw = screen.getByRole('switch');
      fireEvent.click(sw);
      await act(() => vi.advanceTimersByTimeAsync(5000));
      expect(sw).toHaveAttribute('data-moving');
      rerender(<Given on />);
      expect(sw).toBeChecked();
      expect(sw).toHaveAttribute('data-moving');
      await act(() => vi.advanceTimersByTimeAsync(1000));
      expect(sw).not.toHaveAttribute('data-moving');
    });

    it('has its motion only while moving: none on first paint', () => {
      const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
      // Each rule that transitions is one that only applies while a person moves it.
      const moving = [...rules.matchAll(/([^{}]+)\{[^{}]*\btransition\s*:/g)].map((m) =>
        (m[1] ?? '').trim(),
      );
      expect(moving.length).toBeGreaterThan(0);
      for (const selector of moving) expect(selector).toMatch(/^\.track\[data-moving\]/);
    });
  });
});
