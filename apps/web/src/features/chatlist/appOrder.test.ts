import type { AppDockItem } from '@conch/nacre';
import { describe, expect, it } from 'vitest';

import { favouritesFirst, remember } from './appOrder';

const item = (key: string, extra: Partial<AppDockItem> = {}): AppDockItem => ({
  key,
  label: key,
  icon: null,
  source: 'Made in a chat',
  onOpen: () => undefined,
  ...extra,
});

describe('which apps the sidebar row shows first', () => {
  it('leads with the open one, then what you opened most recently', () => {
    const items = [item('a'), item('b'), item('c', { active: true }), item('d')];
    expect(favouritesFirst(items, ['d', 'b']).map((i) => i.key)).toEqual(['c', 'd', 'b', 'a']);
  });

  it('keeps the order they were added when nothing has been opened', () => {
    const items = [item('a'), item('b'), item('c')];
    expect(favouritesFirst(items, []).map((i) => i.key)).toEqual(['a', 'b', 'c']);
  });

  it('forgets an app that is no longer there, and never repeats one', () => {
    expect(remember(['a', 'b'], 'b')).toEqual(['b', 'a']);
    expect(remember([], 'a')).toEqual(['a']);
    const long = Array.from({ length: 30 }, (_, i) => `k${i}`);
    expect(remember(long, 'new')).toHaveLength(24);
    expect(remember(long, 'new')[0]).toBe('new');
  });
});
