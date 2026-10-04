import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { PlanRoom } from './PlanRoom';
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

describe('PlanRoom', () => {
  const now = new Date(2026, 9, 4, 22, 40).getTime();
  const resetsAt = new Date(2026, 9, 9, 18, 0).getTime();
  const plans = [{ source: 'Claude Max', usedPercent: 81, resetsAt, waiting: 1 }];

  it('says what the choice means for each plan today, and follows it as it changes', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container, rerender } = renderNacre(
      <PlanRoom percent={80} onChange={onChange} plans={plans} now={now} />,
    );
    expect(screen.getByRole('heading', { name: 'Room for your own chats' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Your Claude Max plan is 81% used, so routines on it wait until it resets on Friday, October 9.',
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /Never wait/ }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    await user.click(screen.getByRole('radio', { name: /Wait at 90%/ }));
    expect(onChange).toHaveBeenLastCalledWith(90);

    rerender(<PlanRoom percent={90} onChange={onChange} plans={plans} now={now} />);
    expect(
      screen.getByText('Your Claude Max plan is 81% used, so the routine waiting for it goes now.'),
    ).toBeInTheDocument();
    rerender(<PlanRoom percent={null} onChange={onChange} plans={plans} now={now} />);
    expect(screen.getByText(/Your own chats may run out first/)).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('marks Conch’s own choice, and is reachable by keyboard', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderNacre(<PlanRoom percent={80} onChange={onChange} />);
    expect(screen.getByRole('radio', { name: /80% used \(Conch’s choice\)/ })).toBeChecked();
    expect(
      screen.getByText('Routines wait once a plan is 80% used, and go when it resets.'),
    ).toBeInTheDocument();
    await user.tab();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: /Wait at 90%/ })).toHaveFocus();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenLastCalledWith(90);
  });
});
