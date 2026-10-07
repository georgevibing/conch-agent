import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { TurnMeter } from './TurnMeter';

describe('TurnMeter', () => {
  it('reads as one plain sentence once the turn is over', async () => {
    const { container } = renderNacre(
      <TurnMeter running={false} durationMs={64_000} steps={12} costUsd={0.04} tokens={41_240} />,
    );
    const meter = screen.getByRole('group', {
      name: 'Worked, for 1m 04s, 12 steps, cost $0.04, 41k tokens written',
    });
    expect(meter).toHaveTextContent('1m 04s·12 steps·$0.04·41k tokens');
    await expectAccessible(container);
  });

  it('ticks while running, without the money it doesn’t know', () => {
    renderNacre(<TurnMeter running startedAt={Date.now() - 5_000} steps={1} />);
    const meter = screen.getByRole('group', { name: /^Working, for 5s, 1 step$/ });
    expect(meter).toHaveAttribute('data-running');
    expect(meter.textContent).not.toContain('$');
  });
});
