import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { SummaryDivider } from './SummaryDivider';

describe('SummaryDivider', () => {
  it('is one quiet line that opens to show what the model keeps', async () => {
    const onOpenChange = vi.fn();
    const { container } = renderNacre(
      <SummaryDivider
        model="GPT-5 mini"
        summary="Tomatoes along the south fence."
        onOpenChange={onOpenChange}
      />,
    );
    const trigger = screen.getByRole('button', {
      name: 'Earlier messages are summarised for GPT-5 mini',
    });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Tomatoes along the south fence.')).toBeNull();
    await expectAccessible(container);

    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(screen.getByText('Tomatoes along the south fence.')).toBeVisible();
    expect(screen.getByText('What GPT-5 mini keeps from above')).toBeVisible();
    expect(screen.getByText(/Every message is still here for you/)).toBeVisible();
    await expectAccessible(container);
  });

  it('opens and closes from the keyboard', async () => {
    renderNacre(<SummaryDivider model="Qwen" summary="A plan." />);
    await userEvent.tab();
    const trigger = screen.getByRole('button');
    expect(trigger).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await userEvent.keyboard(' ');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('says plainly when there is no summary, with nothing to open', async () => {
    const { container } = renderNacre(<SummaryDivider model="Llama 3.2" summary="  " />);
    expect(screen.getByRole('note')).toHaveTextContent(
      'Llama 3.2 no longer reads the messages above',
    );
    expect(screen.queryByRole('button')).toBeNull();
    await expectAccessible(container);
  });

  it('reads well without a model name', () => {
    renderNacre(<SummaryDivider summary="Notes." defaultOpen />);
    expect(
      screen.getByRole('button', { name: 'Earlier messages are summarised for the model' }),
    ).toBeVisible();
    expect(screen.getByText('What the model keeps from above')).toBeVisible();
  });
});
