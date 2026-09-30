import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Button } from '../../components/Button';
import { expectAccessible, renderNacre } from '../../test/render';
import {
  TerminalKeys,
  TerminalNotice,
  TerminalPanel,
  withCtrl,
  type TerminalTab,
} from './TerminalPanel';

const tabs: TerminalTab[] = [
  { id: 'a', title: '~/projects/conch', status: 'running' },
  { id: 'b', title: 'pnpm dev', status: 'running', activity: true },
  { id: 'c', title: 'ssh studio', status: 'exited' },
];

function panel(overrides: Partial<Parameters<typeof TerminalPanel>[0]> = {}) {
  const props = {
    tabs,
    active: 'a',
    onSelect: vi.fn(),
    onClose: vi.fn(),
    onNew: vi.fn(),
    onHide: vi.fn(),
    children: (id: string) => <p>screen {id}</p>,
    ...overrides,
  };
  return { props, ...renderNacre(<TerminalPanel {...props} />) };
}

describe('TerminalPanel', () => {
  it('is accessible: a region with a tab per shell, new output and ended ones announced', async () => {
    const { container } = panel();
    expect(screen.getByRole('region', { name: 'Terminal' })).toBeInTheDocument();
    const list = screen.getByRole('tablist', { name: 'Terminals' });
    expect(list).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '~/projects/conch' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: /pnpm dev, new output/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /ssh studio.*ended/ })).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('keeps every shell mounted and shows only the one in view', () => {
    panel();
    expect(screen.getByText('screen a')).toBeVisible();
    expect(screen.getByText('screen b', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('screen b').closest('[role="tabpanel"]')).toHaveAttribute('hidden');
  });

  it('moves between tabs with the arrow keys, and closes, opens and hides', async () => {
    const user = userEvent.setup();
    const { props } = panel();
    screen.getByRole('tab', { name: '~/projects/conch' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(props.onSelect).toHaveBeenCalledWith('b');
    await user.click(screen.getByRole('button', { name: 'Close this terminal' }));
    expect(props.onClose).toHaveBeenCalledWith('a');
    // Delete on a focused tab closes it (the × is for pointers).
    screen.getByRole('tab', { name: /ssh studio/ }).focus();
    await user.keyboard('{Delete}');
    expect(props.onClose).toHaveBeenCalledWith('c');
    await user.click(screen.getByRole('button', { name: 'New terminal' }));
    expect(props.onNew).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Hide the terminal' }));
    expect(props.onHide).toHaveBeenCalledOnce();
  });

  it('offers to open one when there are none', async () => {
    const user = userEvent.setup();
    const { props } = panel({ tabs: [], active: undefined });
    await user.click(screen.getByRole('button', { name: 'Open a terminal' }));
    expect(props.onNew).toHaveBeenCalledOnce();
  });
});

describe('TerminalNotice', () => {
  it('says what happened with what to do, as a status or an alert', async () => {
    const { container, rerender } = renderNacre(
      <TerminalNotice
        tone="ended"
        title="The shell ended (code 1)"
        actions={<Button>Restart</Button>}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('The shell ended (code 1)');
    await expectAccessible(container);
    rerender(<TerminalNotice tone="problem" title="Terminals are off" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Terminals are off');
  });
});

describe('TerminalKeys', () => {
  it('sends the keys phones lack, and holds Ctrl for the next key', async () => {
    const user = userEvent.setup();
    const onKey = vi.fn();
    const onCtrlChange = vi.fn();
    const { container } = renderNacre(
      <TerminalKeys onKey={onKey} ctrl={false} onCtrlChange={onCtrlChange} />,
    );
    await user.click(screen.getByRole('button', { name: 'Escape' }));
    expect(onKey).toHaveBeenLastCalledWith('\x1b');
    await user.click(screen.getByRole('button', { name: 'Up' }));
    expect(onKey).toHaveBeenLastCalledWith('\x1b[A');
    await user.click(screen.getByRole('button', { name: 'Ctrl' }));
    expect(onCtrlChange).toHaveBeenCalledWith(true);
    await expectAccessible(container);
  });

  it('turns Ctrl + a letter into its control character', () => {
    expect(withCtrl('c')).toBe('\x03');
    expect(withCtrl('D')).toBe('\x04');
    expect(withCtrl('[')).toBe('\x1b');
    expect(withCtrl('1')).toBe('1');
    expect(withCtrl('ab')).toBe('ab');
  });
});
