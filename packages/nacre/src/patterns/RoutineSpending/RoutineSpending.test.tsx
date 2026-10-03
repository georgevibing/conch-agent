import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { RoutineSpendingGauge, RoutinesPaused } from './RoutineSpending';

const nextMonth = new Date(2026, 10, 1).getTime();

describe('RoutineSpendingGauge', () => {
  it('says what’s left this month, what routines cost, and when it starts again', async () => {
    const { container } = renderNacre(
      <RoutineSpendingGauge
        monthUsd={3.2}
        limitUsd={20}
        projectedUsd={14.1}
        resetsAt={nextMonth}
      />,
    );
    expect(screen.getByText('Routines this month')).toBeInTheDocument();
    expect(screen.getByText('$16.80 left of $20')).toBeInTheDocument();
    expect(
      screen.getByText('Your routines cost about $14.10 a month · Starts again November 1'),
    ).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '84');
    await expectAccessible(container);
  });

  it('warns, calmly, when the routines that are on cost more than the limit', () => {
    renderNacre(
      <RoutineSpendingGauge monthUsd={2} limitUsd={20} projectedUsd={37} resetsAt={nextMonth} />,
    );
    expect(screen.getByText(/more than the limit/)).toBeInTheDocument();
    expect(screen.getByText('Routines this month').closest('[data-severity]')).toHaveAttribute(
      'data-severity',
      'warning',
    );
  });

  it('with no limit, just says what was spent', () => {
    renderNacre(<RoutineSpendingGauge monthUsd={41.25} limitUsd={null} resetsAt={nextMonth} />);
    expect(screen.getByText('$41.25 spent')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});

describe('RoutinesPaused', () => {
  it('says why in one sentence, with the two choices that matter', async () => {
    const onRaise = vi.fn();
    const onKeepPaused = vi.fn();
    const { container } = renderNacre(
      <RoutinesPaused
        monthUsd={20.4}
        until={nextMonth}
        onRaise={onRaise}
        onKeepPaused={onKeepPaused}
      />,
    );
    expect(screen.getByText('Your routines are paused')).toBeInTheDocument();
    expect(
      screen.getByText(
        /used \$20\.40 this month, so the ones that cost money are paused until November 1/,
      ),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Raise the limit' }));
    await userEvent.click(screen.getByRole('button', { name: 'Keep paused' }));
    expect(onRaise).toHaveBeenCalledOnce();
    expect(onKeepPaused).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });
});
