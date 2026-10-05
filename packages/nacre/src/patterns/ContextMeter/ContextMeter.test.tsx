import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { ContextMeter, fillOf, tokensShort } from './ContextMeter';

describe('ContextMeter', () => {
  it('says counts the way a person does', () => {
    expect(tokensShort(950)).toBe('950');
    expect(tokensShort(1_234)).toBe('1.2k');
    expect(tokensShort(30_400)).toBe('30k');
    expect(tokensShort(1_000_000)).toBe('1M');
    expect(tokensShort(1_260_000)).toBe('1.2M');
    expect(tokensShort(27_000_000)).toBe('27M');
    expect(fillOf(50_000, 200_000)).toBe(25);
    expect(fillOf(50_000)).toBeUndefined();
  });

  it('shows how full the chat is, and opens to the detail and Compact now', async () => {
    const user = userEvent.setup();
    const onCompact = vi.fn();
    const { container } = renderNacre(
      <ContextMeter used={84_000} window={200_000} onCompact={onCompact} />,
    );
    const chip = screen.getByRole('button', { name: 'Context 42% full. Details' });
    expect(chip).toHaveTextContent('42%');
    await expectAccessible(container);
    await user.click(chip);
    expect(screen.getByText('84k of 200k tokens')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Compact now' }));
    expect(onCompact).toHaveBeenCalledOnce();
  });

  it('counts what a running turn uses, and holds Compact until it’s done', async () => {
    const user = userEvent.setup();
    renderNacre(
      <ContextMeter
        used={84_000}
        window={200_000}
        working={30_400}
        written={1_200}
        running
        onCompact={vi.fn()}
      />,
    );
    const chip = screen.getByRole('button', { name: /this message has used 30k tokens so far/ });
    // How full stays its word while it works; the tally is in the panel (and the working line).
    expect(chip).toHaveTextContent('42%');
    await user.click(chip);
    expect(screen.getByText(/wrote/)).toHaveTextContent('wrote 1.2k, read 29k tokens');
    expect(screen.getByRole('button', { name: 'Compact now' })).toBeDisabled();
    expect(screen.getByText('Once this message is done.')).toBeVisible();
  });

  it('shows nothing on a chat that hasn’t started', () => {
    renderNacre(<ContextMeter />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
