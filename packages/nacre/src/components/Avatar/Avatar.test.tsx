import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { Avatar, AvatarGroup, hueFromString, initialsOf } from './Avatar';

describe('Avatar', () => {
  it('renders initials with an accessible name', async () => {
    const { container } = renderNacre(<Avatar name="Ada Lovelace" status="online" />);
    expect(screen.getByRole('img', { name: 'Ada Lovelace (Online)' })).toBeInTheDocument();
    expect(screen.getByText('AL')).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('derives stable initials and hues', () => {
    expect(initialsOf('grace  brewster hopper')).toBe('GH');
    expect(initialsOf('Claude')).toBe('C');
    expect(initialsOf('   ')).toBe('?');
    expect(hueFromString('Ada')).toBe(hueFromString('Ada'));
    expect(hueFromString('Ada')).not.toBe(hueFromString('Grace'));
  });

  it('collapses overflow in a group', async () => {
    const { container } = renderNacre(
      <AvatarGroup max={2} aria-label="Participants">
        <Avatar name="A B" />
        <Avatar name="C D" />
        <Avatar name="E F" />
        <Avatar name="G H" />
      </AvatarGroup>,
    );
    expect(screen.getByRole('img', { name: '2 more' })).toBeInTheDocument();
    expect(screen.getAllByRole('img')).toHaveLength(3);
    await expectAccessible(container);
  });
});
