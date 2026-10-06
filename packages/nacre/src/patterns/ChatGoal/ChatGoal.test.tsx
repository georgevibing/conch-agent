import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { ChatGoal, GoalNote } from './ChatGoal';

describe('ChatGoal', () => {
  it('is one line that opens to the goal whole, with Edit and Clear goal', async () => {
    const onEdit = vi.fn();
    const onClear = vi.fn();
    const user = userEvent.setup();
    const { container } = renderNacre(
      <ChatGoal goal="Ship the release notes" onEdit={onEdit} onClear={onClear} />,
    );
    const line = screen.getByRole('button', { name: 'Goal: Ship the release notes. Change it' });
    await expectAccessible(container);
    await user.click(line);
    const dialog = await screen.findByRole('dialog', { name: 'This chat’s goal' });
    expect(dialog).toHaveTextContent('kept when you clear the chat');
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(onEdit).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(line);
    await user.click(await screen.findByRole('button', { name: 'Clear goal' }));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('opens from the keyboard', async () => {
    const user = userEvent.setup();
    renderNacre(<ChatGoal goal="Tidy the garden" onClear={() => {}} />);
    await user.tab();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('button', { name: 'Clear goal' })).toBeInTheDocument();
  });

  it('draws nothing without a goal', () => {
    renderNacre(<ChatGoal goal="  " />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('GoalNote', () => {
  it('says the goal was set, or cleared', () => {
    renderNacre(
      <>
        <GoalNote goal="Tidy the garden" />
        <GoalNote />
      </>,
    );
    expect(screen.getByText(/Goal set:/)).toHaveTextContent('Goal set: Tidy the garden');
    expect(screen.getByText('Goal cleared')).toBeInTheDocument();
  });
});
