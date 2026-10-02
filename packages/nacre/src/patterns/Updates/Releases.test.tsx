import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { ReleaseChannelPicker } from './ReleaseChannelPicker';
import { ReleaseNotes } from './ReleaseNotes';
import { SoftwareUpdate } from './SoftwareUpdate';
import { UpdateBanner } from './UpdateBanner';

const releases = [
  {
    version: '0.4.0',
    headsUp: ['Sign in again on your phone'],
    new: ['Edit pages by hand, with a live preview'],
    fixed: ['The editor keeps its buttons together'],
  },
  { version: '0.3.0', date: '2 October', new: ['Connect iMessage and email'] },
];

describe('ReleaseNotes', () => {
  it('opens the newest release and folds the older ones away', async () => {
    const user = userEvent.setup();
    const { container } = renderNacre(<ReleaseNotes releases={releases} />);
    expect(screen.getByRole('button', { name: 'Conch 0.4' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByText('Edit pages by hand, with a live preview')).toBeVisible();
    // Heads up is said in words, not only in colour.
    expect(screen.getByRole('note')).toHaveTextContent('Heads upSign in again on your phone');
    expect(screen.getByRole('list', { name: 'Fixed' })).toHaveTextContent('The editor keeps');
    const older = screen.getByRole('button', { name: /^Conch 0\.3/ });
    expect(older).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Connect iMessage and email')).toBeNull();
    older.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByText('Connect iMessage and email')).toBeVisible();
    await expectAccessible(container);
  });

  it('says something even when a release has no lines', () => {
    renderNacre(<ReleaseNotes releases={[{ version: '0.3.1' }]} />);
    expect(screen.getByText(/Work behind the scenes/)).toBeVisible();
  });

  it('can sit behind SoftwareUpdate’s disclosure', async () => {
    const user = userEvent.setup();
    renderNacre(
      <SoftwareUpdate
        state="available"
        title="Conch 0.4 is ready"
        notes={<ReleaseNotes releases={releases} />}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'What’s new' }));
    expect(screen.getByText('Edit pages by hand, with a live preview')).toBeVisible();
  });
});

describe('UpdateBanner', () => {
  it('says a release is ready, offers what’s new and the update, and can be put away', async () => {
    const user = userEvent.setup();
    const onWhatsNew = vi.fn();
    const onUpdate = vi.fn();
    const onDismiss = vi.fn();
    const { container } = renderNacre(
      <UpdateBanner
        title="Conch 0.4 is ready"
        onWhatsNew={onWhatsNew}
        onUpdate={onUpdate}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByRole('region', { name: 'Conch 0.4 is ready' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'What’s new' }));
    await user.click(screen.getByRole('button', { name: 'Update' }));
    await user.tab();
    await user.keyboard('{Enter}');
    expect(onWhatsNew).toHaveBeenCalledOnce();
    expect(onUpdate).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument();
    await expectAccessible(container);
  });
});

describe('ReleaseChannelPicker', () => {
  it('chooses a channel with the arrow keys, each said in a sentence', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    const { container } = renderNacre(
      <ReleaseChannelPicker
        value="stable"
        onValueChange={onValueChange}
        note="Going back waits for the next release."
      />,
    );
    const group = screen.getByRole('radiogroup', { name: 'Which releases Conch gets' });
    expect(group).toBeInTheDocument();
    const stable = screen.getByRole('radio', { name: 'Stable' });
    expect(stable).toBeChecked();
    expect(stable).toHaveAccessibleDescription('Tested releases. Recommended.');
    stable.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: 'Beta' })).toHaveFocus();
    await user.keyboard(' ');
    expect(onValueChange).toHaveBeenCalledWith('beta');
    expect(screen.getByText('Going back waits for the next release.')).toBeVisible();
    await expectAccessible(container);
  });
});
