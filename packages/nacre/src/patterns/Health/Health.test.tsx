import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Button } from '../../components/Button';
import { expectAccessible, renderNacre } from '../../test/render';
import { RepairPanel, type RepairItem } from './RepairPanel';

const ok: RepairItem = {
  id: 'a',
  group: 'Providers',
  title: 'Claude Code',
  state: 'ok',
  message: 'Ready.',
};

function panel(props: Partial<Parameters<typeof RepairPanel>[0]> = {}) {
  const onRepair = vi.fn();
  const onCheck = vi.fn();
  const view = renderNacre(
    <RepairPanel
      items={[ok]}
      running={false}
      repairing={false}
      checkedAt={Date.now()}
      onRepair={onRepair}
      onCheck={onCheck}
      {...props}
    />,
  );
  return { ...view, onRepair, onCheck };
}

describe('RepairPanel', () => {
  it('is one calm line while everything works, with the details folded away', async () => {
    const { container, onRepair } = panel();
    expect(screen.getByRole('status')).toHaveTextContent('Everything’s working');
    expect(screen.queryByRole('list')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Show details' }));
    expect(screen.getByRole('list')).toHaveTextContent('Working: Claude CodeReady.');
    await userEvent.click(screen.getByRole('button', { name: 'Repair everything' }));
    expect(onRepair).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });

  it('opens what needs you by itself, each with its one button', async () => {
    const { container } = panel({
      items: [
        ok,
        {
          id: 'b',
          group: 'Providers',
          title: 'Codex',
          state: 'needs-you',
          message: 'Signed out.',
          action: <Button size="sm">Sign in</Button>,
        },
      ],
    });
    expect(screen.getByRole('status')).toHaveTextContent('1 thing needs you');
    const list = screen.getByRole('list');
    expect(within(list).getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(list).toHaveTextContent('Needs you: Codex');
    await expectAccessible(container);
  });

  it('says it’s repairing while it does, and what it fixed after', () => {
    const { rerender } = panel({ running: true, repairing: true });
    expect(screen.getByRole('status')).toHaveTextContent('Repairing…');
    expect(screen.getByRole('button', { name: 'Repair everything' })).toBeDisabled();
    rerender(
      <RepairPanel
        items={[{ ...ok, state: 'fixed', message: 'Working again.' }]}
        running={false}
        repairing
        checkedAt={Date.now()}
        onRepair={() => {}}
        onCheck={() => {}}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Fixed 1 thing — everything’s working');
  });

  it('tells news without calling it a problem', async () => {
    const { container } = panel({
      items: [
        ok,
        {
          id: 'u',
          group: 'Updates',
          title: 'Conch',
          state: 'info',
          message: 'Conch 0.3 is ready.',
          action: <Button size="sm">See what’s new</Button>,
        },
      ],
    });
    expect(screen.getByRole('status')).toHaveTextContent('Everything’s working');
    expect(screen.getByRole('status')).toHaveTextContent('1 piece of news');
    await userEvent.click(screen.getByRole('button', { name: 'Show details' }));
    const list = screen.getAllByRole('list').find((l) => l.textContent?.includes('News'));
    if (!list) throw new Error('no news');
    expect(list).toHaveTextContent('News: ConchConch 0.3 is ready.');
    // News comes before what's simply working.
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('News: Conch');
    expect(within(list).getByRole('button', { name: 'See what’s new' })).toBeInTheDocument();
    await expectAccessible(container);
  });
});
