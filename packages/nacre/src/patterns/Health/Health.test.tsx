import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Button } from '../../components/Button';
import { expectAccessible, renderNacre } from '../../test/render';
import { RepairPanel, type RepairItem } from './RepairPanel';

const ok: RepairItem = {
  id: 'a',
  group: 'Conch',
  title: 'Claude Code',
  state: 'ok',
  message: 'Ready.',
};

const signIn: RepairItem = {
  id: 'b',
  group: 'Apps',
  title: 'Linear',
  state: 'needs-you',
  message: 'Signed out.',
  action: <Button size="sm">Sign in</Button>,
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

const group = (name: RegExp) => screen.getByRole('button', { name });

describe('RepairPanel', () => {
  it('is calm while everything works: each group one folded line', async () => {
    const { container, onRepair } = panel({
      items: [
        ok,
        { ...ok, id: 'a2', title: 'Codex' },
        { ...signIn, state: 'ok', action: undefined },
      ],
    });
    expect(screen.getByRole('status')).toHaveTextContent('Everything’s working');
    expect(screen.getByRole('status')).not.toHaveTextContent(/look/);
    const conch = group(/^Conch/);
    expect(conch).toHaveTextContent('2 working');
    expect(conch).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('list')).toBeNull();
    await userEvent.click(conch);
    expect(conch).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: /^Conch/ })).toHaveTextContent(
      'Working: Claude CodeReady.',
    );
    // Nothing to fix: Repair everything is there, but quiet.
    const repair = screen.getByRole('button', { name: 'Repair everything' });
    expect(repair).toHaveAttribute('data-variant', 'ghost');
    await userEvent.click(repair);
    expect(onRepair).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });

  it('opens the group with what needs you, first, with its button', async () => {
    const { container } = panel({ items: [ok, signIn] });
    expect(screen.getByRole('status')).toHaveTextContent('1 thing needs you');
    const apps = group(/^Apps/);
    expect(apps).toHaveTextContent('1 needs you');
    expect(apps).toHaveAttribute('aria-expanded', 'true');
    expect(group(/^Conch/)).toHaveAttribute('aria-expanded', 'false');
    // The group that needs you comes first.
    const heads = screen.getAllByRole('button', { expanded: true });
    expect(heads[0]).toBe(apps);
    const region = screen.getByRole('region', { name: /^Apps/ });
    expect(within(region).getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(region).toHaveTextContent('Needs you: Linear');
    expect(screen.getByRole('button', { name: 'Repair everything' })).toHaveAttribute(
      'data-variant',
      'solid',
    );
    await expectAccessible(container);
  });

  it('remembers a group a person folded', async () => {
    const onOpenedChange = vi.fn();
    panel({ items: [ok, signIn], onOpenedChange });
    await userEvent.click(group(/^Apps/));
    expect(group(/^Apps/)).toHaveAttribute('aria-expanded', 'false');
    expect(onOpenedChange).toHaveBeenLastCalledWith({ Apps: false });
  });

  it('follows the groups it is given', () => {
    panel({ items: [ok, signIn], opened: { Conch: true, Apps: false } });
    expect(group(/^Conch/)).toHaveAttribute('aria-expanded', 'true');
    expect(group(/^Apps/)).toHaveAttribute('aria-expanded', 'false');
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
    expect(group(/^Conch/)).toHaveTextContent('1 fixed');
  });

  it('tells news and what’s off without calling either a problem', async () => {
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
        {
          id: 't',
          group: 'Talk to me here',
          title: 'Telegram',
          state: 'off',
          message: 'Not set up.',
        },
      ],
    });
    expect(screen.getByRole('status')).toHaveTextContent('Everything’s working');
    expect(screen.getByRole('status')).toHaveTextContent('1 piece of news');
    const updates = group(/^Updates/);
    expect(updates).toHaveTextContent('1 new');
    expect(updates).toHaveAttribute('aria-expanded', 'false');
    expect(group(/^Talk to me here/)).toHaveTextContent('Off');
    expect(group(/^Talk to me here/)).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(updates);
    const region = screen.getByRole('region', { name: /^Updates/ });
    expect(region).toHaveTextContent('News: ConchConch 0.3 is ready.');
    expect(within(region).getByRole('button', { name: 'See what’s new' })).toBeInTheDocument();
    await expectAccessible(container);
  });
});
