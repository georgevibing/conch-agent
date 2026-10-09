import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import {
  McpScopePicker,
  OtherAppsArt,
  OtherAppTargets,
  PairedAppList,
  PairedAppListSkeleton,
  type McpScopeChoice,
  type OtherAppTarget,
} from './OtherApps';

const targets: OtherAppTarget[] = [
  {
    app: 'claude-desktop',
    name: 'Claude Desktop',
    state: 'connected',
    detail: 'Your memory and Gmail',
  },
  { app: 'cursor', name: 'Cursor', state: 'ready' },
  { app: 'vscode', name: 'VS Code', state: 'missing' },
];

const choices: McpScopeChoice[] = [
  { scope: 'memory.read', kind: 'conch', title: 'Search what Conch knows about you' },
  { scope: 'browser', kind: 'conch', title: 'Use Conch’s browser' },
  { scope: 'app:gmail', kind: 'app', title: 'Gmail', brand: 'gmail' },
];

describe('OtherAppTargets', () => {
  it('says each app’s state in words, with the one thing to do', async () => {
    const user = userEvent.setup();
    const onConnect = vi.fn();
    const onManage = vi.fn();
    const { container } = renderNacre(
      <OtherAppTargets targets={targets} onConnect={onConnect} onManage={onManage} />,
    );
    const rows = within(screen.getByRole('list', { name: 'Apps Conch can connect' })).getAllByRole(
      'listitem',
    );
    expect(rows[0]).toHaveTextContent('Connected · Your memory and Gmail');
    expect(rows[1]).toHaveTextContent('On this computer');
    expect(rows[2]).toHaveTextContent('Not on this computer');
    expect(within(rows[2] as HTMLElement).queryByRole('button')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    expect(onConnect).toHaveBeenCalledWith(targets[1]);
    await user.click(screen.getByRole('button', { name: 'Change what Claude Desktop may use' }));
    expect(onManage).toHaveBeenCalledWith(targets[0]);
    await expectAccessible(container);
  });
});

describe('McpScopePicker', () => {
  it('ticks exactly what you choose, by keyboard too', async () => {
    const user = userEvent.setup();
    const seen: string[][] = [];
    function Picker() {
      const [value, setValue] = useState<string[]>(['memory.read']);
      return (
        <McpScopePicker
          choices={choices}
          value={value}
          onChange={(next) => {
            seen.push(next);
            setValue(next);
          }}
        />
      );
    }
    const { container } = renderNacre(<Picker />);
    expect(screen.getByRole('group', { name: 'In Conch' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Your apps' })).toBeInTheDocument();
    const gmail = screen.getByRole('checkbox', { name: 'Gmail' });
    gmail.focus();
    await user.keyboard(' ');
    expect(seen.at(-1)).toEqual(['memory.read', 'app:gmail']);
    await user.click(screen.getByRole('checkbox', { name: 'Search what Conch knows about you' }));
    expect(seen.at(-1)).toEqual(['app:gmail']);
    await expectAccessible(container);
  });

  it('says where to connect apps when there are none', () => {
    renderNacre(
      <McpScopePicker
        choices={choices.filter((c) => c.kind === 'conch')}
        value={[]}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByText(/Connect them in Apps/)).toBeInTheDocument();
  });
});

describe('PairedAppList', () => {
  it('shows what each may use and offers to see, change or remove it', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    const onOpen = vi.fn();
    const { container } = renderNacre(
      <PairedAppList
        apps={[
          {
            id: 'a',
            name: 'Claude Desktop',
            uses: 'Your memory',
            meta: 'Paired 3 Oct',
            remote: true,
          },
        ]}
        onOpen={onOpen}
        onEdit={() => undefined}
        onRemove={onRemove}
      />,
    );
    const row = screen.getByRole('listitem');
    expect(row).toHaveTextContent('From your address');
    expect(row).toHaveTextContent('Your memory');
    await user.click(screen.getByRole('button', { name: 'See what Claude Desktop did' }));
    expect(onOpen).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Remove Claude Desktop' }));
    expect(onRemove).toHaveBeenCalled();
    await expectAccessible(container);
  });

  it('says plainly when nothing is paired', () => {
    renderNacre(<PairedAppList apps={[]} />);
    expect(screen.getByText(/No other apps use Conch yet/)).toBeInTheDocument();
  });
});

describe('PairedAppListSkeleton', () => {
  it('holds room for each row, out of the way of assistive tech', async () => {
    const { container } = renderNacre(
      <div aria-busy="true">
        <PairedAppListSkeleton rows={3} />
      </div>,
    );
    const skeleton = container.querySelector('[data-skeleton]');
    expect(skeleton).toHaveAttribute('aria-hidden', 'true');
    expect(skeleton?.children).toHaveLength(3);
    expect(screen.queryByRole('list')).toBeNull();
    await expectAccessible(container);
  });
});

describe('OtherAppsArt', () => {
  it('is decoration only, with at most three apps', async () => {
    const { container } = renderNacre(
      <OtherAppsArt
        apps={[
          { name: 'Claude Desktop' },
          { name: 'Cursor' },
          { name: 'VS Code' },
          { name: 'Zed' },
        ]}
      />,
    );
    const art = container.querySelector('[aria-hidden]');
    expect(art).toHaveAttribute('aria-hidden', 'true');
    expect(art).not.toHaveTextContent('Z');
    expect(screen.queryByRole('img')).toBeNull();
    await expectAccessible(container);
  });

  it('draws any app when none are named', () => {
    const { container } = renderNacre(<OtherAppsArt />);
    expect(container.querySelectorAll('svg').length).toBeGreaterThanOrEqual(3);
  });
});
