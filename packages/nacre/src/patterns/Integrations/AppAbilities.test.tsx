import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { AppAbilities } from './AppAbilities';

describe('AppAbilities', () => {
  it('is one switch per thing the app does, named by its title and described by its words', async () => {
    const onChange = vi.fn();
    const { container } = renderNacre(
      <AppAbilities
        label="What Slack does"
        abilities={[
          {
            id: 'read',
            title: 'Read & search',
            description: 'See your channels and search your messages.',
            on: true,
            onChange,
            note: 'As ada, in Acme.',
          },
          { id: 'send', title: 'Send (asks first)', on: false, onChange },
        ]}
      />,
    );
    const list = screen.getByRole('list', { name: 'What Slack does' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    const read = screen.getByRole('switch', { name: 'Read & search' });
    expect(read).toBeChecked();
    expect(read).toHaveAccessibleDescription(/See your channels.*As ada, in Acme\./);
    await userEvent.click(screen.getByRole('switch', { name: 'Send (asks first)' }));
    expect(onChange).toHaveBeenCalledWith(true);
    // The keyboard works the same.
    read.focus();
    await userEvent.keyboard(' ');
    expect(onChange).toHaveBeenLastCalledWith(false);
    await expectAccessible(container);
  });

  it('a half that isn’t set up yet is a button that sets it up, never a switch that pretends', async () => {
    const onClick = vi.fn();
    const { container } = renderNacre(
      <AppAbilities
        label="What Slack does"
        abilities={[
          {
            id: 'talk',
            title: 'Talk to me here',
            on: true,
            setup: { label: 'Set up', onClick },
            note: 'It needs two more keys from your Slack app.',
          },
        ]}
      />,
    );
    expect(screen.queryByRole('switch')).toBeNull();
    const button = screen.getByRole('button', { name: 'Set up' });
    expect(button).toHaveAccessibleDescription(/two more keys/);
    expect(screen.getByRole('listitem')).not.toHaveAttribute('data-on');
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });

  it('waits while it changes, offers its extra action when on, and can’t change while the app is off', async () => {
    const onAction = vi.fn();
    const onChange = vi.fn();
    renderNacre(
      <AppAbilities
        label="What Gmail does"
        abilities={[
          {
            id: 'talk',
            title: 'Talk to me here',
            on: true,
            busy: true,
            onChange,
            action: { label: 'Who can write to it', onClick: onAction },
          },
          { id: 'read', title: 'Read & search', on: true, disabled: true, onChange },
          {
            id: 'off',
            title: 'Draft',
            on: false,
            action: { label: 'Never shown while off', onClick: onAction },
          },
        ]}
      />,
    );
    expect(screen.getByRole('switch', { name: 'Talk to me here' })).toBeDisabled();
    expect(screen.getAllByRole('listitem')[0]).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('switch', { name: 'Read & search' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Who can write to it' }));
    expect(onAction).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Never shown while off' })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('says a note that needs looking at in words, not only colour', () => {
    renderNacre(
      <AppAbilities
        label="What 1Password does"
        abilities={[
          {
            id: 'fill',
            title: 'Fill sign-ins from 1Password',
            on: true,
            note: 'Locked. Unlock 1Password to use it.',
            attention: true,
          },
        ]}
      />,
    );
    expect(screen.getByText('Locked. Unlock 1Password to use it.')).toBeInTheDocument();
    expect(screen.getByRole('listitem')).toHaveAttribute('data-attention', 'true');
  });
});
