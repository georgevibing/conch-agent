import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { AccessLevels, AccountAccessCard } from './AccountAccess';

const gmail = {
  id: 'gmail',
  name: 'Gmail',
  brand: 'gmail',
  describe: { read: 'Search and read your mail.', write: 'Also draft and send.' },
};

describe('AccountAccessCard', () => {
  it('says who, how and how it’s doing, with Off · Read · Read & write per service', async () => {
    const onLevelChange = vi.fn();
    const { container } = renderNacre(
      <AccountAccessCard
        email="ada@example.com"
        method="Google sign-in"
        state="ready"
        onLevelChange={onLevelChange}
        services={[
          { ...gmail, level: 'read' },
          { id: 'calendar', name: 'Google Calendar', level: 'off' },
        ]}
        actions={<button type="button">Remove</button>}
      />,
    );
    const card = screen.getByRole('article', { name: 'ada@example.com' });
    expect(within(card).getByText('Google sign-in')).toBeInTheDocument();
    expect(within(card).getByText('Working')).toBeInTheDocument();
    const list = within(card).getByRole('list', { name: 'What it may do with ada@example.com' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    const group = within(card).getByRole('radiogroup', { name: 'Gmail' });
    expect(group).toHaveAccessibleDescription('Search and read your mail.');
    expect(within(group).getByRole('radio', { name: 'Read' })).toBeChecked();
    await userEvent.click(within(group).getByRole('radio', { name: 'Read & write' }));
    expect(onLevelChange).toHaveBeenCalledWith('gmail', 'write');
    // The keyboard moves along the levels too.
    within(card).getByRole('radiogroup', { name: 'Google Calendar' });
    await expectAccessible(container);
  });

  it('a service it can’t reach says why, with the button that fixes it, never a pretend control', async () => {
    const onClick = vi.fn();
    const { container } = renderNacre(
      <AccessLevels
        label="What it may do"
        services={[
          {
            id: 'drive',
            name: 'Google Drive',
            level: 'off',
            unavailable: {
              reason: 'Needs Google sign-in.',
              action: { label: 'Use Google sign-in', onClick },
            },
          },
        ]}
      />,
    );
    expect(screen.queryByRole('radiogroup', { name: 'Google Drive' })).not.toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Use Google sign-in' });
    expect(button).toHaveAccessibleDescription('Needs Google sign-in.');
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalled();
    await expectAccessible(container);
  });

  it('puts the problem and its one fix first when it needs the person', async () => {
    const { container } = renderNacre(
      <AccountAccessCard
        email="ada@example.com"
        method="App password"
        state="needs-auth"
        message="Gmail stopped taking this app password."
        fix={<button type="button">Paste a new one</button>}
        services={[{ ...gmail, level: 'read' }]}
      />,
    );
    expect(screen.getByText('Needs you')).toBeInTheDocument();
    expect(screen.getByText('Gmail stopped taking this app password.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Paste a new one' })).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('waits while a change is saved', () => {
    renderNacre(
      <AccessLevels label="What it may do" services={[{ ...gmail, level: 'read', busy: true }]} />,
    );
    expect(screen.getByRole('listitem')).toHaveAttribute('aria-busy', 'true');
    for (const radio of within(screen.getByRole('radiogroup', { name: 'Gmail' })).getAllByRole(
      'radio',
    ))
      expect(radio).toBeDisabled();
  });
});
