import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { SegmentedControl } from './SegmentedControl';

function Views({ onValueChange }: { onValueChange?: (v: string) => void }) {
  return (
    <SegmentedControl aria-label="View" defaultValue="chat" onValueChange={onValueChange}>
      <SegmentedControl.Item value="chat">Chat</SegmentedControl.Item>
      <SegmentedControl.Item value="diff">Diff</SegmentedControl.Item>
      <SegmentedControl.Item value="files">Files</SegmentedControl.Item>
    </SegmentedControl>
  );
}

describe('SegmentedControl', () => {
  it('is accessible and reflects the selected segment', async () => {
    const { container } = renderNacre(<Views />);
    expect(screen.getByRole('radio', { name: 'Chat' })).toHaveAttribute('aria-checked', 'true');
    await expectAccessible(container);
  });

  it('selects with click and keyboard', async () => {
    const onValueChange = vi.fn();
    renderNacre(<Views onValueChange={onValueChange} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Diff' }));
    expect(onValueChange).toHaveBeenLastCalledWith('diff');
    await userEvent.keyboard('{ArrowRight}{Enter}');
    expect(screen.getByRole('radio', { name: 'Files' })).toHaveAttribute('aria-checked', 'true');
  });

  it('never deselects the active segment', async () => {
    const onValueChange = vi.fn();
    renderNacre(<Views onValueChange={onValueChange} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Chat' }));
    expect(onValueChange).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: 'Chat' })).toHaveAttribute('aria-checked', 'true');
  });
});
