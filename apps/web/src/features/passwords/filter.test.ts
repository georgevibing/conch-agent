import type { VaultItemSummary } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { ago, counts, matches, visibleItems } from './filter';

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

describe('finding passwords', () => {
  it('needs every word somewhere, sites included', () => {
    expect(matches(items[0] as VaultItemSummary, 'gmail work')).toBe(true);
    expect(matches(items[1] as VaultItemSummary, 'gmail work')).toBe(false);
    expect(matches(items[0] as VaultItemSummary, 'google')).toBe(true);
    expect(matches(items[2] as VaultItemSummary, 'cards')).toBe(true);
  });

  it('filters, keeps deleted ones apart, and puts favourites first', () => {
    const all = visibleItems(items, { query: '', filter: { kind: 'all' }, sort: 'name' });
    expect(all.map((i) => i.id)).toEqual(['b', 'e', 'a', 'c']);
    expect(
      visibleItems(items, { query: '', filter: { kind: 'deleted' }, sort: 'name' }).map(
        (i) => i.id,
      ),
    ).toEqual(['d']);
    expect(
      visibleItems(items, { query: '', filter: { kind: 'codes' }, sort: 'name' }).map((i) => i.id),
    ).toEqual(['e']);
    expect(
      visibleItems(items, { query: '', filter: { kind: 'tag', tag: 'Work' }, sort: 'name' }).map(
        (i) => i.id,
      ),
    ).toEqual(['a']);
    expect(
      visibleItems(items, {
        query: '',
        filter: { kind: 'source', source: '1password' },
        sort: 'name',
      }).map((i) => i.id),
    ).toEqual(['e']);
    expect(visibleItems(items, { query: '', filter: { kind: 'all' }, sort: 'used' })[0]?.id).toBe(
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
