import type { VaultItemDetail, VaultItemSummary, VaultList, VaultSource } from '@conch/protocol';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation, useParams } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mockFetch, renderApp } from '../../test/harness';
import { PasswordsView } from './PasswordsView';

afterEach(() => vi.unstubAllGlobals());

const summary = (over: Partial<VaultItemSummary>): VaultItemSummary => ({
  id: 'pw_1',
  source: 'conch',
  type: 'login',
  title: 'Item',
  subtitle: '',
  domains: [],
  tags: [],
  favorite: false,
  totp: false,
  passkey: false,
  problems: [],
  readOnly: false,
  ...over,
});

const source = (over: Partial<VaultSource>): VaultSource => ({
  id: 'conch',
  name: 'Conch',
  state: 'ready',
  writable: true,
  unlock: 'none',
  ...over,
});

const list = (items: VaultItemSummary[], sources: VaultSource[] = [source({})]): VaultList => ({
  items,
  status: {
    lock: { enabled: false, locked: false, autoLockMinutes: 30 },
    protection: 'keychain',
    sources,
    health: { weak: 0, reused: 0, compromised: 0, expired: 0, insecure: 0 },
    trash: 0,
  },
});

const detail = (item: VaultItemSummary): VaultItemDetail => ({
  ...item,
  fields: [
    { id: 'username', label: 'Username', kind: 'text', value: item.subtitle, filled: true },
    { id: 'password', label: 'Password', kind: 'secret', filled: true },
  ],
  urls: [],
  notes: '',
  history: 0,
  usedBy: [],
  allowedSites: [],
  agentAccess: 'ask',
  agentRead: 'ask',
  passkeys: [],
});

/** Zero-padded, so A–Z order is the order they were made in. */
const many = (n: number, over: (i: number) => Partial<VaultItemSummary> = () => ({})) =>
  Array.from({ length: n }, (_, i) =>
    summary({
      id: `pw_${i}`,
      title: `Site ${String(i).padStart(4, '0')}`,
      subtitle: `user${i}`,
      ...over(i),
    }),
  );

function Page() {
  const { itemId } = useParams();
  const { pathname } = useLocation();
  return (
    <>
      <output data-testid="where">{pathname}</output>
      <PasswordsView itemId={itemId} />
    </>
  );
}

function open(
  items: VaultItemSummary[],
  /** `slow`: an item whose fields don't come until `answer()` (another app taking its time). */
  options: { route?: string; sources?: VaultSource[]; slow?: string } = {},
) {
  const calls = mockFetch({
    'GET /api/vault': () => list(items, options.sources),
    ...Object.fromEntries(
      items.map((item) => [`GET /api/vault/items/${item.id}`, () => detail(item)]),
    ),
  });
  const quick = globalThis.fetch;
  let answer = () => {};
  vi.stubGlobal('fetch', (input: string, init?: RequestInit) =>
    input === `/api/vault/items/${options.slow}`
      ? new Promise<Response>((resolve) => (answer = () => resolve(quick(input, init))))
      : quick(input, init),
  );
  const view = renderApp(
    <Routes>
      <Route path="/passwords" element={<Page />} />
      <Route path="/passwords/:itemId" element={<Page />} />
    </Routes>,
    { route: options.route ?? '/passwords' },
  );
  const asked = (id: string) =>
    calls.filter((c) => c.method === 'GET' && c.path === `/api/vault/items/${id}`).length;
  return { ...view, calls, asked, answer: () => answer() };
}

const inList = (selector: string) =>
  screen.getByRole('region', { name: 'Passwords' }).querySelector(selector);

const rowsDrawn = () => document.querySelectorAll('button[data-id]');
const where = () => screen.getByTestId('where').textContent;

describe('a long list of passwords', () => {
  it('draws only the rows in view, however many there are', async () => {
    open(many(800));
    expect(await screen.findByRole('button', { name: /^Site 0000,/ })).toBeInTheDocument();
    expect(rowsDrawn().length).toBeLessThan(60);
    expect(screen.queryByRole('button', { name: /^Site 0700,/ })).not.toBeInTheDocument();
    // Every one of them is still counted, and each row knows its place among them.
    expect(screen.getByRole('button', { name: /All items\s*800/ })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /^Site 0000,/ }).closest('[role="listitem"]'),
    ).toHaveAttribute('aria-setsize', '800');
  });

  it('finds one far down the list as you type, with what matched marked', async () => {
    const user = userEvent.setup();
    open(many(800));
    await screen.findByRole('button', { name: /^Site 0000,/ });
    await user.type(screen.getByRole('textbox', { name: 'Search passwords' }), '0700');
    const found = await screen.findByRole('button', { name: /^Site 0700,/ });
    expect(found.querySelector('mark')).toHaveTextContent('0700');
    expect(rowsDrawn()).toHaveLength(1);
  });

  it('heads the groups of a long list, and not a search', async () => {
    const user = userEvent.setup();
    open(many(40, (i) => ({ favorite: i === 7 })));
    await screen.findByRole('button', { name: /^Site 0000,/ });
    expect(screen.getAllByText('Favourites').length).toBeGreaterThan(0);
    expect(screen.getAllByText('S').length).toBeGreaterThan(0);
    await user.type(screen.getByRole('textbox', { name: 'Search passwords' }), 'site');
    await waitFor(() => expect(screen.queryByText('Favourites')).not.toBeInTheDocument());
  });

  it('wears a manager’s mark only when there is more than one manager to tell apart', async () => {
    const onePassword = source({ id: '1password', name: '1Password', writable: false });
    const first = open(
      many(5, (i) => ({ id: `op_v_${i}`, source: '1password', readOnly: true })),
      { sources: [source({}), onePassword] },
    );
    await screen.findByRole('button', { name: /^Site 0000, user0, from 1Password/ });
    expect(inList('[aria-label="1Password"]')).toBeNull();
    first.unmount();

    open(
      [
        summary({ id: 'op_v_1', title: 'Bank', source: '1password', readOnly: true }),
        summary({ id: 'bw_1', title: 'Forum', source: 'bitwarden', readOnly: true }),
      ],
      {
        sources: [
          source({}),
          onePassword,
          source({ id: 'bitwarden', name: 'Bitwarden', writable: false }),
        ],
      },
    );
    await screen.findByRole('button', { name: /^Bank, from 1Password/ });
    expect(inList('[aria-label="1Password"]')).not.toBeNull();
    expect(inList('[aria-label="Bitwarden"]')).not.toBeNull();
  });
});

describe('searching with the keyboard', () => {
  it('moves through the results with the arrows while the keyboard stays in the search', async () => {
    const user = userEvent.setup();
    open(many(30));
    await screen.findByRole('button', { name: /^Site 0000,/ });
    const search = screen.getByRole('textbox', { name: 'Search passwords' });
    await user.type(search, 'site 002');
    await screen.findByRole('button', { name: /^Site 0029,/ });
    expect(screen.queryByRole('button', { name: /^Site 0000,/ })).not.toBeInTheDocument();

    await user.keyboard('{ArrowDown}');
    expect(where()).toBe('/passwords/pw_20');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(where()).toBe('/passwords/pw_22');
    await user.keyboard('{ArrowUp}');
    expect(where()).toBe('/passwords/pw_21');
    expect(search).toHaveFocus();
    expect(screen.getByRole('button', { name: /^Site 0021,/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(await screen.findByRole('heading', { name: 'Site 0021' })).toBeInTheDocument();
  });

  it('opens the best match on Enter', async () => {
    const user = userEvent.setup();
    open(many(30));
    await screen.findByRole('button', { name: /^Site 0000,/ });
    await user.type(screen.getByRole('textbox', { name: 'Search passwords' }), '0017{Enter}');
    await waitFor(() => expect(where()).toBe('/passwords/pw_17'));
  });

  it('brings a row far down the list into view when the arrows reach it', async () => {
    const user = userEvent.setup();
    open(many(200), { route: '/passwords/pw_150' });
    // Opened by its address: the list starts where that item is.
    const row = await screen.findByRole('button', { name: /^Site 0150,/ });
    expect(row).toHaveAttribute('aria-current', 'true');
    row.focus();
    await user.keyboard('{ArrowDown}');
    expect(where()).toBe('/passwords/pw_151');
    await waitFor(() => expect(screen.getByRole('button', { name: /^Site 0151,/ })).toHaveFocus());
  });
});

describe('opening an item', () => {
  it('shows what the list already knows at once, and holds the fields’ place while they come', async () => {
    const items = [
      summary({
        id: 'op_v_1',
        title: 'amazon.com',
        subtitle: 'ada@example.com',
        domains: ['amazon.com'],
        source: '1password',
        container: 'Private',
        readOnly: true,
      }),
    ];
    const { container, answer } = open(items, { route: '/passwords/op_v_1', slow: 'op_v_1' });

    expect(await screen.findByRole('heading', { name: 'amazon.com' })).toBeInTheDocument();
    expect(screen.getByText(/From 1Password · Private/)).toBeInTheDocument();
    const pane = screen.getByRole('region', { name: 'Item' });
    expect(pane.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-vault-skeleton="field"]').length).toBeGreaterThan(0);
    expect(screen.queryByRole('group', { name: 'Password' })).not.toBeInTheDocument();

    answer();
    expect(await screen.findByRole('group', { name: 'Password' })).toBeInTheDocument();
    expect(container.querySelector('[data-vault-skeleton="field"]')).toBeNull();
    expect(pane.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('asks only for the item the arrows land on, not each one passed on the way', async () => {
    const user = userEvent.setup();
    const { asked } = open(many(30));
    await screen.findByRole('button', { name: /^Site 0000,/ });
    await user.click(screen.getByRole('textbox', { name: 'Search passwords' }));
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(where()).toBe('/passwords/pw_3');
    expect(await screen.findByRole('group', { name: 'Password' })).toBeInTheDocument();
    expect(asked('pw_3')).toBe(1);
    expect(asked('pw_0') + asked('pw_1') + asked('pw_2')).toBe(0);
  });

  it('asks at once on a click', async () => {
    const user = userEvent.setup();
    const { asked } = open(many(30));
    await user.click(await screen.findByRole('button', { name: /^Site 0005,/ }));
    expect(asked('pw_5')).toBe(1);
  });
});

describe('getting an item ready before it’s chosen', () => {
  it('fetches one of Conch’s own while the pointer rests on it', async () => {
    const user = userEvent.setup();
    const { asked } = open(many(30));
    await user.hover(await screen.findByRole('button', { name: /^Site 0004,/ }));
    await waitFor(() => expect(asked('pw_4')).toBe(1));
    expect(where()).toBe('/passwords');
    // Chosen now, it's already here: nothing more is asked.
    await user.click(screen.getByRole('button', { name: /^Site 0004,/ }));
    expect(await screen.findByRole('group', { name: 'Password' })).toBeInTheDocument();
    expect(asked('pw_4')).toBe(1);
  });

  it('never asks another password manager on a hover: it could put up its own unlock prompt', async () => {
    const user = userEvent.setup();
    const { asked } = open(
      many(5, (i) => ({ id: `op_v_${i}`, source: '1password', readOnly: true })),
      {
        sources: [source({}), source({ id: '1password', name: '1Password', writable: false })],
      },
    );
    await user.hover(await screen.findByRole('button', { name: /^Site 0002,/ }));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(asked('op_v_2')).toBe(0);
  });
});
