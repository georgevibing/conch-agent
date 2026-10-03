import type { VaultItemDetail, VaultItemSummary, VaultList, VaultSource } from '@conch/protocol';
import { Toaster } from '@conch/nacre';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation, useParams } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mockFetch, renderApp } from '../../test/harness';
import { PasswordsLink } from './PasswordsLink';
import { PasswordsView } from './PasswordsView';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

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
      <Toaster />
    </>
  );
}

function open(
  items: VaultItemSummary[],
  /** `slow`: an item whose fields don't come until `answer()` (another app taking its time). */
  options: {
    route?: string;
    sources?: VaultSource[];
    slow?: string;
    routes?: Record<string, (body: unknown) => unknown>;
  } = {},
) {
  const calls = mockFetch({
    'GET /api/vault': () => list(items, options.sources),
    ...options.routes,
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

  it('wears where each item lives only when the list holds more than one place', async () => {
    const onePassword = source({ id: '1password', name: '1Password', writable: false });
    const first = open(
      many(5, (i) => ({ id: `op_v_${i}`, source: '1password', readOnly: true })),
      { sources: [source({}), onePassword] },
    );
    await screen.findByRole('button', { name: /^Site 0000, user0, from 1Password/ });
    expect(inList('[title="1Password"]')).toBeNull();
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
    expect(inList('[title="1Password"]')).not.toBeNull();
    expect(inList('[title="Bitwarden"]')).not.toBeNull();
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

describe('another password manager’s own approval window', () => {
  it('can only come up from Passwords itself: the sidebar asks without looking', async () => {
    const { calls } = open(many(2));
    await screen.findByRole('button', { name: /^Site 0001,/ });
    expect(calls.filter((c) => c.path.startsWith('/api/vault')).map((c) => c.path)).toEqual([
      '/api/vault?look=1',
    ]);
    vi.unstubAllGlobals();

    const elsewhere = mockFetch({ 'GET /api/vault': () => list(many(2)) });
    renderApp(<PasswordsLink />, { route: '/' });
    await waitFor(() => expect(elsewhere.map((c) => c.path)).toEqual(['/api/vault']));
  });
});

describe('where items live, and doing things to several', () => {
  const onePassword = (over: Partial<VaultSource> = {}) =>
    source({ id: '1password', name: '1Password', writable: false, ...over });
  const mixed = () => [
    summary({ id: 'pw_1', title: 'Bank', subtitle: 'ada', source: 'conch' }),
    summary({ id: 'pw_2', title: 'Forum', subtitle: 'ada', source: 'conch' }),
    summary({
      id: 'op_v_1',
      title: 'Mail',
      subtitle: 'ada',
      source: '1password',
      container: 'Private',
      readOnly: true,
    }),
  ];

  it('says on every row where it lives, and shows one place at a press', async () => {
    const user = userEvent.setup();
    open(mixed(), { sources: [source({}), onePassword()] });
    expect(await screen.findByRole('button', { name: /^Bank, ada, in Conch/ })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /^Mail, ada, from 1Password, Private/ }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: '1Password, 1 item' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /^Bank,/ })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /^Mail,/ })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Conch, 2 items' }));
    await screen.findByRole('button', { name: /^Bank,/ });
    expect(screen.queryByRole('button', { name: /^Mail,/ })).not.toBeInTheDocument();
  });

  it('chooses several with ⌘/Ctrl- and Shift-click, deletes Conch’s own, and can undo', async () => {
    const user = userEvent.setup();
    const { calls } = open(mixed(), {
      sources: [source({}), onePassword()],
      routes: {
        'POST /api/vault/trash': () => ({ ok: true }),
        'POST /api/vault/restore': () => ({ ok: true }),
      },
    });
    const bank = await screen.findByRole('button', { name: /^Bank,/ });
    await user.keyboard('{Control>}');
    await user.click(bank);
    await user.keyboard('{/Control}');
    await user.keyboard('{Shift>}');
    await user.click(screen.getByRole('button', { name: /^Mail,/ }));
    await user.keyboard('{/Shift}');
    const bar = screen.getByRole('toolbar', { name: 'Chosen items' });
    expect(bar).toHaveTextContent('3 chosen');
    // Choosing doesn't open anything.
    expect(where()).toBe('/passwords');
    expect(screen.getByRole('button', { name: /^Bank,/ })).toHaveAttribute('aria-pressed', 'true');

    // A manager's item isn't deleted here: the button says how many of Conch's it deletes.
    await user.click(within(bar).getByRole('button', { name: 'Delete 2 items' }));
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/api/vault/trash')?.body).toEqual({
        ids: ['pw_1', 'pw_2'],
      }),
    );
    expect(screen.queryByRole('toolbar', { name: 'Chosen items' })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/api/vault/restore')?.body).toEqual({
        ids: ['pw_1', 'pw_2'],
      }),
    );
  });

  it('copies a manager’s item into Conch from its right-click menu', async () => {
    const user = userEvent.setup();
    const { calls } = open(mixed(), {
      sources: [source({}), onePassword()],
      routes: {
        'POST /api/vault/sources/1password/transfer': () => ({
          jobId: 'vjob_1',
          source: '1password',
          sourceName: '1Password',
          state: 'done',
          total: 1,
          done: 1,
          copied: 1,
          updated: 0,
          skipped: 0,
          failed: [],
          startedAt: 1,
        }),
      },
    });
    const mail = await screen.findByRole('button', { name: /^Mail,/ });
    await user.pointer({ keys: '[MouseRight]', target: mail });
    await user.click(await screen.findByRole('menuitem', { name: 'Copy into Conch' }));
    await waitFor(() =>
      expect(
        calls.find((c) => c.path === '/api/vault/sources/1password/transfer')?.body,
      ).toMatchObject({ ids: ['op_v_1'], commit: true, skipDuplicates: true, keepSynced: false }),
    );
    expect(await screen.findByText('“Mail” copied into Conch')).toBeInTheDocument();
  });

  it('copies Conch’s own to a manager that takes them, into the vault chosen', async () => {
    const user = userEvent.setup();
    const { calls } = open(mixed(), {
      sources: [
        source({}),
        onePassword({
          accepts: true,
          places: [
            { id: 'vprivate', name: 'Private' },
            { id: 'vwork', name: 'Work' },
          ],
        }),
      ],
      routes: {
        'POST /api/vault/sources/1password/copy': () => ({ copied: 1, skipped: 0, failed: [] }),
      },
    });
    const bank = await screen.findByRole('button', { name: /^Bank,/ });
    await user.pointer({ keys: '[MouseRight]', target: bank });
    (await screen.findByRole('menuitem', { name: 'Copy to 1Password' })).focus();
    await user.keyboard('{ArrowRight}');
    await screen.findByRole('menuitem', { name: 'Work' });
    await user.keyboard('{ArrowDown}{Enter}');
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/api/vault/sources/1password/copy')?.body).toEqual({
        ids: ['pw_1'],
        place: 'vwork',
        skipDuplicates: true,
      }),
    );
    expect(await screen.findByText('“Bank” copied to 1Password (Work)')).toBeInTheDocument();
    // A manager's own item has no Copy to; Conch's has no Copy into Conch.
    await user.keyboard('{Escape}');
  });

  it('copies the password of the open item with ⌘/Ctrl+C, revealed for that one copy', async () => {
    const user = userEvent.setup();
    const { calls } = open(mixed(), {
      route: '/passwords/pw_1',
      routes: {
        'POST /api/vault/items/pw_1/reveal': () => ({ value: 'river-otter-copper' }),
      },
    });
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText, readText: async () => '' },
    });
    await screen.findByRole('heading', { name: 'Bank' });
    await user.keyboard('{Control>}c{/Control}');
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('river-otter-copper'));
    expect(calls.find((c) => c.path === '/api/vault/items/pw_1/reveal')?.body).toEqual({
      fieldId: 'password',
      copy: true,
    });
  });

  it('points to the same account in another place', async () => {
    open(
      [
        summary({ id: 'pw_1', title: 'Mail', subtitle: 'ada', domains: ['mail.example'] }),
        summary({
          id: 'op_v_1',
          title: 'Mail (1P)',
          subtitle: 'ada',
          domains: ['mail.example'],
          source: '1password',
          readOnly: true,
        }),
      ],
      { route: '/passwords/pw_1', sources: [source({}), onePassword()] },
    );
    const other = await screen.findByRole('button', { name: 'Open the one in 1Password' });
    await userEvent.click(other);
    await waitFor(() => expect(where()).toBe('/passwords/op_v_1'));
  });
});
