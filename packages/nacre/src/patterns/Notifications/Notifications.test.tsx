import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { AddToHomeScreen } from './AddToHomeScreen';
import { NotifiedDevices } from './NotifiedDevices';
import { NotifyThisDevice, NotifyTopics, type NotifyTopic } from './NotifyThisDevice';

const topics: NotifyTopic[] = [
  { id: 'approvals', label: 'It needs you', on: true },
  { id: 'replies', label: 'An answer is ready', on: false },
];

describe('NotifyThisDevice', () => {
  it('turns notifications on from the keyboard', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = renderNacre(<NotifyThisDevice state="off" onChange={onChange} />);
    const toggle = screen.getByRole('switch', { name: 'Allow notifications' });
    expect(toggle).toHaveAccessibleDescription('On this device, while you’re away.');
    toggle.focus();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenCalledWith(true);
    await expectAccessible(container);
  });

  it('shows what it’s told about only while it’s on, and offers a test', async () => {
    const user = userEvent.setup();
    const onTopicChange = vi.fn();
    const onPreviewsChange = vi.fn();
    const onTest = vi.fn();
    const props = { onChange: () => undefined, onTopicChange, onPreviewsChange, onTest };
    const { container, rerender } = renderNacre(
      <NotifyThisDevice state="on" topics={topics} previews {...props} />,
    );
    const group = screen.getByRole('group', { name: 'Tell me when' });
    expect(within(group).getByRole('switch', { name: 'It needs you' })).toBeChecked();
    await user.click(within(group).getByRole('switch', { name: 'An answer is ready' }));
    expect(onTopicChange).toHaveBeenCalledWith('replies', true);
    await user.click(screen.getByRole('switch', { name: 'Show what it’s about' }));
    expect(onPreviewsChange).toHaveBeenCalledWith(false);
    await user.click(screen.getByRole('button', { name: 'Send a test' }));
    expect(onTest).toHaveBeenCalled();
    await expectAccessible(container);

    // Told about nothing, what it says about each one doesn't matter.
    rerender(
      <NotifyThisDevice
        state="on"
        topics={topics.map((t) => ({ ...t, on: false }))}
        previews
        {...props}
      />,
    );
    await waitFor(() =>
      expect(screen.queryByRole('switch', { name: 'Show what it’s about' })).toBeNull(),
    );

    // Off, the choices fold away: they mean nothing then.
    rerender(<NotifyThisDevice state="off" {...props} />);
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Tell me when' })).toBeNull());
    expect(screen.queryByRole('button', { name: 'Send a test' })).toBeNull();
  });

  it('saved as on, it opens as on: the list is already there, nothing moving in', () => {
    renderNacre(<NotifyThisDevice state="on" topics={topics} onChange={() => undefined} />);
    expect(screen.getByRole('switch', { name: 'Allow notifications' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Allow notifications' })).not.toHaveAttribute(
      'data-moving',
    );
    expect(screen.getByRole('group', { name: 'Tell me when' })).toBeVisible();
    expect(
      screen.getByRole('group', { name: 'Tell me when' }).closest('[data-arriving]'),
    ).not.toBeNull();
  });

  it('with the topics on a page of their own, keeps one Topics row saying how many are on', async () => {
    const user = userEvent.setup();
    const onOpenTopics = vi.fn();
    const { container } = renderNacre(
      <NotifyThisDevice
        state="on"
        topics={topics}
        previews
        onChange={() => undefined}
        onOpenTopics={onOpenTopics}
      />,
    );
    expect(screen.queryByRole('group', { name: 'Tell me when' })).toBeNull();
    const row = screen.getByRole('button', { name: /Topics/ });
    expect(row).toHaveTextContent('1 of 2');
    // The previews stay with the switch, on the place itself.
    expect(screen.getByRole('switch', { name: 'Show what it’s about' })).toBeInTheDocument();
    await user.click(row);
    expect(onOpenTopics).toHaveBeenCalled();
    await expectAccessible(container);
  });

  it('has no switch when the device needs something first', async () => {
    const { container, rerender } = renderNacre(
      <NotifyThisDevice state="install" onChange={() => undefined}>
        <AddToHomeScreen />
      </NotifyThisDevice>,
    );
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByRole('list', { name: 'Add Conch to your Home Screen' })).toHaveTextContent(
      'Add to Home Screen',
    );
    await expectAccessible(container);
    rerender(<NotifyThisDevice state="blocked" onChange={() => undefined} />);
    expect(screen.getByRole('region', { name: 'Notifications are blocked' })).toBeInTheDocument();
    expect(screen.queryByRole('switch')).toBeNull();
  });
});

describe('NotifyTopics', () => {
  it('is the list of what it’s told about, one switch apiece', async () => {
    const user = userEvent.setup();
    const onTopicChange = vi.fn();
    const { container } = renderNacre(
      <NotifyTopics topics={topics} onTopicChange={onTopicChange} />,
    );
    const group = screen.getByRole('group', { name: 'Tell me when' });
    expect(within(group).getAllByRole('switch')).toHaveLength(2);
    await user.click(within(group).getByRole('switch', { name: 'An answer is ready' }));
    expect(onTopicChange).toHaveBeenCalledWith('replies', true);
    await expectAccessible(container);
  });
});

describe('NotifiedDevices', () => {
  it('lists each device with a way to stop it', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    const { container } = renderNacre(
      <NotifiedDevices
        devices={[
          { id: 'a', name: 'Safari on iPhone', detail: 'Last told today', current: true },
          { id: 'b', name: 'Chrome on Mac', problem: 'The last one didn’t arrive.' },
        ]}
        onRemove={onRemove}
      />,
    );
    expect(screen.getByText('This device')).toBeInTheDocument();
    expect(screen.getByText('The last one didn’t arrive.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Stop notifications on Chrome on Mac' }));
    expect(onRemove).toHaveBeenCalledWith('b');
    await expectAccessible(container);
  });
});
