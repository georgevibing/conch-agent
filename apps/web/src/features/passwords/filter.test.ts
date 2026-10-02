import type { VaultItemSummary } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import {
  ago,
  counts,
  indexItems,
  listRows,
  matches,
  titleRanges,
  visibleItems,
  type VaultFilter,
  type VaultSort,
} from './filter';

const item = (over: Partial<VaultItemSummary>): VaultItemSummary => ({
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

const items = [
  item({
    id: 'a',
    title: 'Gmail',
    subtitle: 'ada@work.example',
    domains: ['mail.google.com'],
    tags: ['Work'],
  }),
  item({
    id: 'b',
    title: 'Gmail',
    subtitle: 'ada@home.example',
    domains: ['mail.google.com'],
    favorite: true,
  }),
  item({ id: 'c', title: 'Visa', type: 'card', subtitle: '•••• 4242', updatedAt: 5 }),
  item({ id: 'd', title: 'Old', problems: ['weak'], deletedAt: 1 }),
  item({ id: 'e', title: 'Bank', source: '1password', totp: true, usedAt: 9 }),
];

const index = indexItems(items);

describe('finding passwords', () => {
  it('needs every word somewhere, sites included', () => {
    expect(matches(items[0] as VaultItemSummary, 'gmail work')).toBe(true);
    expect(matches(items[1] as VaultItemSummary, 'gmail work')).toBe(false);
    expect(matches(items[0] as VaultItemSummary, 'google')).toBe(true);
    expect(matches(items[2] as VaultItemSummary, 'cards')).toBe(true);
  });

  it('filters, keeps deleted ones apart, and puts favourites first', () => {
    const all = visibleItems(index, { query: '', filter: { kind: 'all' }, sort: 'name' });
    expect(all.map((i) => i.id)).toEqual(['b', 'e', 'a', 'c']);
    expect(
      visibleItems(index, { query: '', filter: { kind: 'deleted' }, sort: 'name' }).map(
        (i) => i.id,
      ),
    ).toEqual(['d']);
    expect(
      visibleItems(index, { query: '', filter: { kind: 'codes' }, sort: 'name' }).map((i) => i.id),
    ).toEqual(['e']);
    expect(
      visibleItems(index, { query: '', filter: { kind: 'tag', tag: 'Work' }, sort: 'name' }).map(
        (i) => i.id,
      ),
    ).toEqual(['a']);
    expect(
      visibleItems(index, {
        query: '',
        filter: { kind: 'source', source: '1password' },
        sort: 'name',
      }).map((i) => i.id),
    ).toEqual(['e']);
    expect(visibleItems(index, { query: '', filter: { kind: 'all' }, sort: 'used' })[0]?.id).toBe(
      'e',
    );
    expect(counts(items)).toMatchObject({
      all: 4,
      favorites: 1,
      codes: 1,
      deleted: 1,
      tags: [['Work', 1]],
    });
  });

  it('finds the same things through the index as one at a time', () => {
    for (const query of ['gmail work', 'google', 'cards', 'bank 1password', 'nothing'])
      expect(
        visibleItems(index, { query, filter: { kind: 'all' }, sort: 'name' })
          .map((i) => i.id)
          .sort(),
      ).toEqual(
        items
          .filter((i) => !i.deletedAt && matches(i, query))
          .map((i) => i.id)
          .sort(),
      );
  });
});

describe('ranking what was found', () => {
  const found = (query: string, list: VaultItemSummary[]) =>
    visibleItems(indexItems(list), { query, filter: { kind: 'all' }, sort: 'name' }).map(
      (i) => i.title,
    );

  it('puts a title that starts with what was typed above one that only contains it', () => {
    const list = [
      item({ id: '1', title: 'Panama Papers' }),
      item({ id: '2', title: 'Amazon' }),
      item({ id: '3', title: 'Shop', domains: ['amazon.de'] }),
      item({ id: '4', title: 'My Amazon seller' }),
    ];
    expect(found('ama', list)).toEqual(['Amazon', 'My Amazon seller', 'Panama Papers', 'Shop']);
  });

  it('keeps favourites first among equally good matches', () => {
    const list = [
      item({ id: '1', title: 'Amazon' }),
      item({ id: '2', title: 'Amazon Prime', favorite: true }),
    ];
    expect(found('amazon', list)).toEqual(['Amazon Prime', 'Amazon']);
  });

  it('says which parts of a title matched, once each, in order', () => {
    expect(titleRanges('Amazon', 'ama')).toEqual([[0, 3]]);
    expect(titleRanges('Gmail work Gmail', 'work gmail')).toEqual([
      [0, 5],
      [6, 10],
      [11, 16],
    ]);
    // Overlapping words become one mark.
    expect(titleRanges('Netflix', 'net etf')).toEqual([[0, 4]]);
    expect(titleRanges('Netflix', '')).toEqual([]);
    expect(titleRanges('Netflix', 'hulu')).toEqual([]);
  });
});

describe('the list in groups', () => {
  const now = new Date(2026, 9, 2, 12, 0).getTime();
  const day = 86_400_000;
  const many = (titles: string[], over: (i: number) => Partial<VaultItemSummary> = () => ({})) =>
    titles.map((title, i) => item({ id: `p${i}`, title, ...over(i) }));
  const names = [
    '1Password',
    '3D Texel',
    'Aade',
    'Adobe',
    'Ámbito',
    'Bank',
    'bitbucket',
    'Dropbox',
    ...Array.from({ length: 14 }, (_, i) => `Zed ${i}`),
  ];
  const rowsFor = (
    list: VaultItemSummary[],
    options: { query?: string; filter?: VaultFilter; sort?: VaultSort } = {},
  ) => {
    const all = { query: '', filter: { kind: 'all' } as VaultFilter, sort: 'name' as VaultSort };
    return listRows(visibleItems(indexItems(list), { ...all, ...options, query: '' }), {
      ...all,
      ...options,
      now,
    });
  };
  const labels = (rows: ReturnType<typeof listRows>) =>
    rows.flatMap((r) => (r.kind === 'header' ? [r.label] : []));

  it('heads each letter, with favourites first and everything else under #', () => {
    const list = many(names, (i) => ({ favorite: i === 5 }));
    const rows = rowsFor(list);
    expect(labels(rows)).toEqual(['Favourites', '#', 'A', 'B', 'D', 'Z']);
    // A header sits right above its first item.
    const a = rows.findIndex((r) => r.kind === 'header' && r.label === 'A');
    expect(rows[a + 1]).toMatchObject({ kind: 'item', item: { title: 'Aade' } });
    expect(rows.filter((r) => r.kind === 'item')).toHaveLength(list.length);
    expect(new Set(rows.map((r) => (r.kind === 'header' ? r.id : r.item.id))).size).toBe(
      rows.length,
    );
  });

  it('heads by how long ago when sorted by time', () => {
    const used = [now - 3_600_000, now - 3 * day, now - 20 * day, now - 90 * day];
    const list = many(names, (i) => ({ usedAt: used[i] }));
    expect(labels(rowsFor(list, { sort: 'used' }))).toEqual([
      'Today',
      'Previous 7 days',
      'Previous 30 days',
      'Earlier',
      'Not used yet',
    ]);
  });

  it('has no headers for a search, for Recently deleted, or for a short list', () => {
    const list = many(names);
    expect(labels(rowsFor(list, { query: 'zed' }))).toEqual([]);
    expect(
      labels(
        rowsFor(
          many(names, () => ({ deletedAt: 1 })),
          { filter: { kind: 'deleted' } },
        ),
      ),
    ).toEqual([]);
    expect(labels(rowsFor(list.slice(0, 6)))).toEqual([]);
  });
});

describe('ago', () => {
  it('says how long ago in the words people use', () => {
    const now = new Date(2026, 9, 1, 15, 0).getTime();
    expect(ago(now - 20_000, now)).toBe('just now');
    expect(ago(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(ago(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(ago(now - 8 * 3_600_000, now)).toBe('today');
    expect(ago(now - 26 * 3_600_000, now)).toBe('yesterday');
    expect(ago(undefined, now)).toBe('never');
  });
});
