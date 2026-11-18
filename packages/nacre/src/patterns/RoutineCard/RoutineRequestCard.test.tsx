import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { RoutineRequestCard } from './RoutineRequestCard';

const routines = [
  { id: 'r_1', title: 'Weekly fitness recap' },
  { id: 'r_2', title: 'Monthly wealth check-in' },
];

describe('RoutineRequestCard', () => {
  it('says who asks, what, and their reason as their words; Pause them and Decline answer', async () => {
    const onApprove = vi.fn();
    const onDecline = vi.fn();
    const { container } = renderNacre(
      <RoutineRequestCard
        from="Hermes"
        via="agent"
        routines={routines}
        reason="they moved there"
        onApprove={onApprove}
        onDecline={onDecline}
      />,
    );
    expect(
      screen.getByText('Hermes asks to pause “Weekly fitness recap” and “Monthly wealth check-in”'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Hermes says: “they moved there”/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Pause them' }));
    await userEvent.click(screen.getByRole('button', { name: 'Decline' }));
    expect(onApprove).toHaveBeenCalledOnce();
    expect(onDecline).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });

  it('names a chat as the chat, never as whoever its words claim to be', () => {
    renderNacre(<RoutineRequestCard from="Planning" via="chat" routines={routines.slice(0, 1)} />);
    expect(
      screen.getByText('A message in “Planning” asks to pause “Weekly fitness recap”'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause it' })).toBeInTheDocument();
  });
});
