import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { ConversationEvent, ConversationSummary, HealArea } from '@conch/protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { isBroken } from './index';
import { SearchService } from './service';

const chats: ConversationSummary[] = [
  {
    id: 'c_voyager',
    title: 'Voyager',
    preview: '',
    createdAt: 1,
    updatedAt: 2,
    status: 'idle',
    options: {},
  },
];
const events: ConversationEvent[] = [
  {
    conversationId: 'c_voyager',
    seq: 0,
    at: 1,
    type: 'user.message',
    messageId: 'm1',
    text: 'Tell me about the Voyager golden record',
  },
];

let service: SearchService | undefined;
afterEach(() => {
  service?.close();
  service = undefined;
});

async function setup(damage?: string) {
  const home = await mkdtemp(join(tmpdir(), 'conch-search-heal-'));
  const path = join(home, 'search.db');
  if (damage !== undefined) await writeFile(path, damage);
  const notes: { area: HealArea; message: string }[] = [];
  const errors: unknown[] = [];
  service = new SearchService({
    path,
    source: {
      list: async () => chats,
      events: async () => events,
      detail: async () => ({ conversation: chats[0] as ConversationSummary, events }),
    },
    heal: (area, message) => void notes.push({ area, message }),
    log: (error) => void errors.push(error),
  });
  service.open();
  await service.settled();
  return { service, home, path, notes, errors };
}

/** What another program (or a failing disk) could do to the file under Conch. */
function breakIndex(path: string) {
  const db = new DatabaseSync(path);
  db.exec('DROP TABLE docs_fts');
  db.close();
}

const kept = async (home: string) =>
  (await readdir(home)).filter((n) => n.startsWith('search.db.broken-'));

const found = async (s: SearchService, q = 'golden record') => {
  const results = await s.search(q, {});
  return results === 'unavailable' ? results : results.groups.map((g) => g.conversationId);
};

describe('isBroken', () => {
  it('tells a damaged index from a query SQLite couldn’t parse', () => {
    const db = new DatabaseSync(':memory:');
    db.exec("CREATE VIRTUAL TABLE t USING fts5(text, tokenize = 'trigram')");
    const thrown = (fn: () => unknown) => {
      try {
        fn();
      } catch (error) {
        return error;
      }
      return undefined;
    };
    expect(isBroken(thrown(() => db.prepare('SELECT * FROM t WHERE t MATCH ?').all('"ab')))).toBe(
      false,
    );
    expect(isBroken(thrown(() => db.prepare('SELECT * FROM docs').all()))).toBe(true);
    expect(
      isBroken({ code: 'ERR_SQLITE_ERROR', errcode: 26, message: 'file is not a database' }),
    ).toBe(true);
    expect(isBroken(new Error('no such table: docs'))).toBe(false);
    db.close();
  });
});

describe('SearchService', () => {
  it('rebuilds an index that won’t open, then searches as usual', async () => {
    const { service, home, notes } = await setup('this is not a database at all');
    expect(service.state).toBe('ready');
    expect(await found(service)).toEqual(['c_voyager']);
    expect(await kept(home)).toHaveLength(1);
    expect(notes).toEqual([
      {
        area: 'search',
        message: 'Rebuilt search from your chats',
      },
    ]);
  });

  it('says it’s catching up, not that search failed, while it rebuilds', async () => {
    const { service, path } = await setup();
    breakIndex(path);
    const during = await service.search('golden record', {});
    expect(during).toMatchObject({ groups: [], catchingUp: true });
    await service.settled();
    expect(await service.search('golden record', {})).not.toHaveProperty('catchingUp');
  });

  it('rebuilds once when it breaks at runtime, and doesn’t loop when it breaks again', async () => {
    const { service, home, path, notes } = await setup();
    expect(await found(service)).toEqual(['c_voyager']);

    breakIndex(path);
    await service.search('golden record', {});
    await service.settled();
    expect(await found(service)).toEqual(['c_voyager']);
    expect(notes.map((n) => n.message)).toEqual(['Rebuilt search from your chats']);

    // Broken again in the same run: no second rebuild, just a calm "unavailable".
    breakIndex(path);
    expect(await found(service)).toBe('unavailable');
    await service.settled();
    expect(await found(service)).toBe('unavailable');
    expect(service.state).toBe('unavailable');
    expect(notes).toHaveLength(1);
    expect(await kept(home)).toHaveLength(1);

    // A person pressing Repair tries once more.
    expect(await service.repair()).toBe('catching-up');
    await service.settled();
    expect(await found(service)).toEqual(['c_voyager']);
    expect(notes).toHaveLength(1);
  });

  it('counts a burst of errors from one broken index as one failure', async () => {
    const { service, path, notes } = await setup();
    breakIndex(path);
    await Promise.all([
      service.search('golden record', {}),
      service.search('voyager', {}),
      service.preview('c_voyager', undefined, ''),
    ]);
    await service.settled();
    expect(service.state).toBe('ready');
    expect(notes).toHaveLength(1);
  });
});
