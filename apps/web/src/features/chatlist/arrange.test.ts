import type { ChatFolder, ConversationSummary } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { arrange, datedGroup, staleChats, TIDY_FROM } from './arrange';
import { applyChange } from './useOrganise';

const NOW = new Date(2026, 9, 5, 15, 0); // 5 October 2026, mid-afternoon
const DAY = 86_400_000;

let n = 0;
function chat(over: Partial<ConversationSummary> = {}): ConversationSummary {
  n += 1;
  return {
    id: `c_${n}`,
    title: `Chat ${n}`,
    preview: '',
    createdAt: NOW.getTime() - DAY,
    updatedAt: NOW.getTime() - 60_000,
    status: 'idle',
    options: {},
    ...over,
  };
}

const folder = (over: Partial<ChatFolder> = {}): ChatFolder => ({
  id: 'f_work1',
  name: 'Work',
  glyph: 'briefcase',
  color: 'blue',
  order: 1,
  createdAt: 0,
  ...over,
});

describe('datedGroup', () => {
  it('names recent days, then the last month, then one group per month', () => {
    const at = (days: number) => NOW.getTime() - days * DAY;
    expect(datedGroup(at(0), NOW).label).toBe('Today');
    expect(datedGroup(at(1), NOW).label).toBe('Yesterday');
    expect(datedGroup(at(5), NOW).label).toBe('Previous 7 days');
    expect(datedGroup(at(20), NOW).label).toBe('Previous 30 days');
    expect(datedGroup(new Date(2026, 6, 10).getTime(), NOW)).toMatchObject({ key: '2026-07' });
    // Another year says which.
    expect(datedGroup(new Date(2025, 6, 10).getTime(), NOW).label).toMatch(/2025/);
  });
});

describe('arrange', () => {
  it('puts each chat in exactly one place: needs you, pinned, a folder, or by date', () => {
    const waiting = chat({ status: 'awaiting-permission', pinned: 1 });
    const pinnedB = chat({ pinned: 20 });
    const pinnedA = chat({ pinned: 10 });
    const filed = chat({ folderId: 'f_work1' });
    const loose = chat();
    const old = chat({ updatedAt: new Date(2026, 5, 1).getTime() });
    const archived = chat({ archivedAt: 1 });
    const routine = chat({ origin: { kind: 'routine', routineId: 'r', runId: 'x' } });
    const lost = chat({ folderId: 'f_gone11' });
    const list = arrange(
      [waiting, pinnedB, pinnedA, filed, loose, old, archived, routine, lost],
      [folder(), folder({ id: 'f_empty1', name: 'Empty', order: 2 })],
      { now: NOW },
    );
    expect(list.needsYou.map((c) => c.id)).toEqual([waiting.id]);
    expect(list.pinned.map((c) => c.id)).toEqual([pinnedA.id, pinnedB.id]);
    expect(list.folders.map((f) => [f.folder.name, f.chats.map((c) => c.id)])).toEqual([
      ['Work', [filed.id]],
      ['Empty', []],
    ]);
    // A chat whose folder went is back in the list, not lost.
    expect(list.dated.map((g) => [g.label, g.chats.map((c) => c.id)])).toEqual([
      ['Today', [loose.id, lost.id]],
      ['June', [old.id]],
    ]);
    expect(list.order).toHaveLength(7);
    expect(list.total).toBe(7);
  });

  it('filters to what’s new, or to chats from chat apps, hiding folders left empty', () => {
    const seen = chat({ seenAt: NOW.getTime() });
    const fresh = chat({ seenAt: 0, folderId: 'f_work1' });
    const telegram = chat({
      origin: { kind: 'channel', channelId: 'ch', channel: 'telegram' },
    });
    const unread = arrange([seen, fresh, telegram], [folder()], { filter: 'unread', now: NOW });
    expect(unread.order.map((c) => c.id)).toEqual([fresh.id]);
    expect(unread.total).toBe(3);
    const apps = arrange([seen, fresh, telegram], [folder()], { filter: 'apps', now: NOW });
    expect(apps.order.map((c) => c.id)).toEqual([telegram.id]);
    expect(apps.folders).toEqual([]);
  });
});

describe('staleChats', () => {
  it('offers chats untouched for a month, only once there are enough to bother', () => {
    const old = (over: Partial<ConversationSummary> = {}) =>
      chat({ updatedAt: NOW.getTime() - 40 * DAY, ...over });
    const few = Array.from({ length: TIDY_FROM - 1 }, () => old());
    expect(staleChats(few, NOW.getTime())).toEqual([]);
    const kept = [old({ pinned: 1 }), old({ folderId: 'f_work1' }), old({ seenAt: 0 })];
    const many = [...few, old(), ...kept, chat()];
    expect(staleChats(many, NOW.getTime())).toHaveLength(TIDY_FROM);
  });
});

describe('applyChange', () => {
  it('matches the gateway: archiving unpins, keeps the folder, and unset is absent', () => {
    const c = chat({ pinned: 5, folderId: 'f_work1' });
    const archived = applyChange(c, { archived: true });
    expect(archived.archivedAt).toEqual(expect.any(Number));
    expect('pinned' in archived).toBe(false);
    expect(archived.folderId).toBe('f_work1');
    expect('folderId' in applyChange(c, { folder: null })).toBe(false);
    expect(applyChange(chat(), { pinOrder: 3 }).pinned).toBeUndefined();
    expect(applyChange(c, { pinOrder: 3 }).pinned).toBe(3);
  });
});
