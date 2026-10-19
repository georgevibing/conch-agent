import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { ConversationEvent, ConversationSummary, HealArea } from '@conch/protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { meaningItem } from '../doctor/checks';
import type { Embedder } from '../memory/embed';
import { fakeEmbedder } from '../test/meaning';
import { SearchIndex } from './index';
import { ChatMeaning, pieces } from './meaning';
import { SearchService } from './service';

const NOW = Date.now();
let seq = 0;
function turn(id: string, user: string, reply: string): ConversationEvent[] {
  const n = seq++;
  const base = () => ({ conversationId: id, seq: seq++, at: NOW });
  return [
    { ...base(), type: 'user.message', messageId: `u${n}`, text: user },
    { ...base(), type: 'assistant.delta', messageId: `a${n}`, kind: 'text', delta: reply },
    { ...base(), type: 'assistant.done', messageId: `a${n}` },
  ];
}

const summary = (id: string, title: string, updatedAt = NOW): ConversationSummary => ({
  id,
  title,
  preview: '',
  createdAt: 1,
  updatedAt,
  status: 'idle',
  options: {},
});

function chats() {
  return new Map<string, { conversation: ConversationSummary; events: ConversationEvent[] }>([
    [
      'c_bali',
      {
        conversation: summary('c_bali', 'Planning'),
        events: turn(
          'c_bali',
          'Book the flights for the trip to Bali in May',
          'Done: two seats to Denpasar, leaving the 3rd of May.',
        ),
      },
    ],
    [
      'c_lasagne',
      {
        conversation: summary('c_lasagne', 'Dinner'),
        events: turn(
          'c_lasagne',
          'Give me a lasagne recipe for six',
          'Here is one for six people.',
        ),
      },
    ],
    [
      'c_taxes',
      {
        conversation: summary('c_taxes', 'Taxes'),
        events: turn('c_taxes', 'When is the tax return due this year?', 'The 31st of July.'),
      },
    ],
  ]);
}

let open: { close(): void }[] = [];
afterEach(() => {
  for (const o of open) o.close();
  open = [];
});

async function setup(
  options: {
    embedder?: () => Embedder | undefined;
    room?: () => boolean;
    path?: string;
  } = {},
) {
  const home = await mkdtemp(join(tmpdir(), 'conch-chat-meaning-'));
  const all = chats();
  const notes: { area: HealArea; message: string }[] = [];
  const embedder = fakeEmbedder();
  const service = new SearchService({
    path: join(home, 'search.db'),
    source: {
      list: async () => [...all.values()].map((c) => c.conversation),
      events: async (id) => all.get(id)?.events ?? [],
      detail: async (id) => {
        const chat = all.get(id);
        if (!chat) throw new Error('gone');
        return chat;
      },
    },
    heal: (area, message) => void notes.push({ area, message }),
    meaning: {
      path: options.path ?? join(home, 'chats-meaning.db'),
      meaning: async () => (options.embedder ? options.embedder() : embedder),
      ...(options.room && { room: options.room }),
      sleep: async () => undefined,
    },
  });
  open.push(service);
  service.open();
  await service.meaningSettled();
  return { service, home, embedder, notes, all };
}

const ids = async (s: SearchService, q: string) => {
  const results = await s.search(q, {});
  if (results === 'unavailable') throw new Error('unavailable');
  return results;
};

describe('searching chats by meaning (ADR 0139)', () => {
  it('finds “the trip to Bali” for “our honeymoon”, though no word is shared', async () => {
    const { service } = await setup();
    const results = await ids(service, 'our honeymoon');
    expect(results.groups.map((g) => g.conversationId)).toEqual(['c_bali']);
    const [hit] = results.groups[0]?.hits ?? [];
    expect(hit).toMatchObject({ byMeaning: true, ranges: [], role: 'user' });
    expect(hit?.snippet).toContain('trip to Bali');
    expect(results.byMeaning).toBe(true);
    expect(results.groups[0]?.title).toBe('Planning');
  });

  it('blends: a chat with the words comes before one found only by meaning', async () => {
    const { service } = await setup();
    // "recipe" is a word of the lasagne chat; "Bali" a word of the trip one. Both match by meaning too.
    const results = await ids(service, 'lasagne recipe');
    expect(results.groups[0]?.conversationId).toBe('c_lasagne');
    expect(results.groups[0]?.hits[0]?.byMeaning).toBeUndefined();
    // Nothing unrelated comes along: taxes are far from cooking.
    expect(results.groups.map((g) => g.conversationId)).not.toContain('c_taxes');
  });

  it('leaves finding in one chat, and short queries, to words', async () => {
    const { service } = await setup();
    const inOne = await service.search('honeymoon', { in: 'c_bali' });
    expect(inOne !== 'unavailable' && inOne.groups).toEqual([]);
    const short = await ids(service, 'ba');
    expect(short.mode).toBe('short');
    expect(short.groups).toEqual([]);
  });

  it('embeds only your words and the answers, each message once', async () => {
    const { embedder } = await setup();
    expect(embedder.texts).toHaveLength(6);
    expect(new Set(embedder.texts).size).toBe(6);
  });

  it('goes on by words while there is no model, and catches up when one arrives', async () => {
    let model: Embedder | undefined;
    const { service } = await setup({ embedder: () => model });
    const before = await ids(service, 'honeymoon');
    expect(before.groups).toEqual([]);
    expect(before.byMeaning).toBeUndefined();
    expect((await ids(service, 'Denpasar')).groups.map((g) => g.conversationId)).toEqual([
      'c_bali',
    ]);
    expect((await service.meaningStatus())?.state).toBe('off');
    // A model that fails to answer is the same as none.
    model = {
      ...fakeEmbedder(),
      embed: async () => {
        throw new Error('model stopped');
      },
    };
    expect((await ids(service, 'honeymoon')).groups).toEqual([]);
    model = fakeEmbedder();
    await service.meaningLanded();
    expect((await ids(service, 'honeymoon')).groups.map((g) => g.conversationId)).toEqual([
      'c_bali',
    ]);
    expect(await service.meaningStatus()).toMatchObject({ state: 'ready', indexed: 3, total: 3 });
  });

  it('answers by words when the model is too slow, instead of keeping the search waiting', async () => {
    const slow: Embedder = {
      ...fakeEmbedder(),
      embed: () => new Promise(() => undefined),
    };
    const meaning = new ChatMeaning({
      path: ':memory:',
      source: () => undefined,
      meaning: async () => slow,
      waitMs: 20,
    });
    open.push(meaning);
    expect(await meaning.search('honeymoon')).toBeUndefined();
  });

  it('takes a deleted chat’s vectors with it', async () => {
    const { service, home, all } = await setup();
    all.delete('c_bali');
    service.onEvent({ type: 'conversation.deleted', conversationId: 'c_bali' });
    expect((await ids(service, 'honeymoon')).groups).toEqual([]);
    await service.settled();
    const db = new DatabaseSync(join(home, 'chats-meaning.db'));
    const left = db
      .prepare("SELECT count(*) AS n FROM vectors WHERE conversation_id = 'c_bali'")
      .get() as { n: number };
    db.close();
    expect(left.n).toBe(0);
  });

  it('drops vectors of chats deleted while Conch was off', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-chat-meaning-'));
    const index = new SearchIndex(':memory:');
    open.push(index);
    for (const [, chat] of chats()) index.index(chat.conversation, chat.events);
    const make = () =>
      new ChatMeaning({
        path: join(home, 'chats-meaning.db'),
        source: () => index,
        meaning: async () => fakeEmbedder(),
        sleep: async () => undefined,
      });
    const first = make();
    await first.wake();
    first.close();
    index.remove('c_bali');
    const second = make();
    open.push(second);
    await second.wake();
    expect(await second.search('honeymoon')).toEqual([]);
  });

  it('resumes a backfill cut short, never embedding a message twice', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-chat-meaning-'));
    const index = new SearchIndex(':memory:');
    open.push(index);
    // Many messages in one chat: several batches.
    const events = Array.from({ length: 30 }, (_, i) =>
      turn('c_long', `Message number ${i} about the trip`, `Reply number ${i} about the trip`),
    ).flat();
    index.index({ id: 'c_long', title: 'Long', createdAt: 1, updatedAt: NOW }, events);
    for (const [, chat] of chats()) index.index(chat.conversation, chat.events);
    const embedded: string[] = [];
    let calls = 0;
    const cutShort: Embedder = {
      ...fakeEmbedder(),
      async embed(texts) {
        // The computer went to sleep (or Conch restarted) after two batches.
        if (++calls > 2) throw new Error('gone');
        embedded.push(...texts);
        return fakeEmbedder().embed(texts);
      },
    };
    const first = new ChatMeaning({
      path: join(home, 'chats-meaning.db'),
      source: () => index,
      meaning: async () => cutShort,
      sleep: async () => undefined,
    });
    await first.wake();
    first.close();
    const done = embedded.length;
    expect(done).toBeGreaterThan(0);
    expect(done).toBeLessThan(66);

    const rest = fakeEmbedder();
    const second = new ChatMeaning({
      path: join(home, 'chats-meaning.db'),
      source: () => index,
      meaning: async () => rest,
      sleep: async () => undefined,
    });
    open.push(second);
    await second.wake();
    // Every message once, over both runs.
    expect(done + rest.texts.length).toBe(66);
    expect(new Set([...embedded, ...rest.texts]).size).toBe(66);
    expect(await second.status()).toMatchObject({ state: 'ready', indexed: 4, total: 4 });
    // Nothing left: a third look makes nothing.
    await second.wake();
    expect(rest.texts.length).toBe(66 - done);
  });

  it('waits while the gateway says there is no room', async () => {
    let room = false;
    const index = new SearchIndex(':memory:');
    open.push(index);
    for (const [, chat] of chats()) index.index(chat.conversation, chat.events);
    const embedder = fakeEmbedder();
    let waits = 0;
    const meaning = new ChatMeaning({
      path: ':memory:',
      source: () => index,
      meaning: async () => embedder,
      room: () => room,
      sleep: async () => {
        if (!room && ++waits >= 3) room = true;
      },
    });
    open.push(meaning);
    await meaning.wake();
    expect(waits).toBe(3);
    expect(embedder.texts).toHaveLength(6);
  });

  it('makes new messages searchable after they’re sent', async () => {
    const { service, all } = await setup();
    const chat = all.get('c_taxes');
    if (!chat) throw new Error('no chat');
    chat.events.push(...turn('c_taxes', 'Also, what should I cook tonight?', 'A risotto.'));
    chat.conversation = { ...chat.conversation, updatedAt: NOW + 1 };
    service.onEvent({
      type: 'conversation.event',
      event: chat.events.at(-3) as ConversationEvent,
    });
    await service.settled('c_taxes');
    await service.meaningSettled();
    expect((await ids(service, 'a recipe')).groups.map((g) => g.conversationId)).toContain(
      'c_taxes',
    );
  });

  it('makes a damaged file again by itself, and says so quietly', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-chat-meaning-'));
    const path = join(home, 'chats-meaning.db');
    await writeFile(path, 'not a database at all, just some bytes '.repeat(200));
    const { service, notes } = await setup({ path });
    expect(notes).toContainEqual({ area: 'search', message: 'Rebuilt chat search by meaning' });
    expect((await ids(service, 'honeymoon')).groups.map((g) => g.conversationId)).toEqual([
      'c_bali',
    ]);
  });

  it('Repair everything: a damaged file is made again, a backfill is news', async () => {
    const calls: string[] = [];
    let damaged = true;
    const search = {
      meaningStatus: async () => ({
        state: 'ready' as const,
        model: 'pretend',
        indexed: 3,
        total: 3,
        damaged,
      }),
      repairMeaning: async () => {
        calls.push('repair');
        damaged = false;
      },
    };
    expect(await meaningItem(search, false)).toMatchObject({
      state: 'warning',
      repairable: true,
    });
    expect(await meaningItem(search, true)).toMatchObject({ state: 'fixed' });
    expect(calls).toEqual(['repair']);
    expect(await meaningItem(search, false)).toMatchObject({ state: 'ok' });
    const catching = {
      ...search,
      meaningStatus: async () => ({
        state: 'catching-up' as const,
        indexed: 1,
        total: 3,
        damaged: false,
      }),
    };
    expect(await meaningItem(catching, false)).toMatchObject({
      state: 'info',
      message: '2 chats aren’t searchable by meaning yet. Conch is catching up.',
    });
    // No model here: nothing to say (memory's check offers it).
    const off = {
      ...search,
      meaningStatus: async () => ({ state: 'off' as const, indexed: 0, total: 3, damaged: false }),
    };
    expect(await meaningItem(off, false)).toBeUndefined();
  });

  it('really repairs: the vectors are made again from the chats', async () => {
    const { service } = await setup();
    await service.repairMeaning();
    await service.meaningSettled();
    expect(await service.meaningStatus()).toMatchObject({ state: 'ready', damaged: false });
    expect((await ids(service, 'honeymoon')).groups.map((g) => g.conversationId)).toEqual([
      'c_bali',
    ]);
  });

  it('drops vectors from another model instead of comparing them', async () => {
    const index = new SearchIndex(':memory:');
    open.push(index);
    for (const [, chat] of chats()) index.index(chat.conversation, chat.events);
    let model = fakeEmbedder('fake:v1');
    const meaning = new ChatMeaning({
      path: ':memory:',
      source: () => index,
      meaning: async () => model,
      sleep: async () => undefined,
    });
    open.push(meaning);
    await meaning.wake();
    model = fakeEmbedder('fake:v2');
    expect(await meaning.status()).toMatchObject({ state: 'catching-up', indexed: 0 });
    await meaning.settled();
    expect(model.texts).toHaveLength(6);
    expect(await meaning.status()).toMatchObject({ state: 'ready', indexed: 3 });
  });
});

describe('pieces', () => {
  it('keeps a short message whole and cuts a long one between sentences, four at most', () => {
    expect(pieces('  Hello there  ')).toEqual(['Hello there']);
    const long = Array.from({ length: 200 }, (_, i) => `Sentence ${i} is here.`).join(' ');
    const cut = pieces(long);
    expect(cut).toHaveLength(4);
    for (const piece of cut) {
      expect(piece.length).toBeLessThanOrEqual(1000);
      expect(piece.endsWith('.')).toBe(true);
    }
  });
});
