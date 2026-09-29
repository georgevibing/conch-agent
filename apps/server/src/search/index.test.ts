import type { ConversationEvent } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { extractDocs, plainText } from './extract';
import { SearchIndex } from './index';

let seq = 0;
const base = (conversationId: string, at = Date.now()) => ({ conversationId, seq: seq++, at });

function turn(id: string, user: string, reply: string, at?: number): ConversationEvent[] {
  const m = `m${seq}`;
  return [
    { ...base(id, at), type: 'user.message', messageId: `u${seq}`, text: user },
    {
      ...base(id, at),
      type: 'assistant.delta',
      messageId: m,
      kind: 'thinking',
      delta: 'hmm secret',
    },
    {
      ...base(id, at),
      type: 'assistant.delta',
      messageId: m,
      kind: 'text',
      delta: reply.slice(0, 5),
    },
    { ...base(id, at), type: 'assistant.delta', messageId: m, kind: 'text', delta: reply.slice(5) },
    { ...base(id, at), type: 'assistant.done', messageId: m },
  ];
}

const convo = (id: string, title: string, updatedAt = 1) => ({
  id,
  title,
  createdAt: 1,
  updatedAt,
});

describe('extractDocs', () => {
  it('merges deltas, skips thinking, and strips markdown', () => {
    const docs = extractDocs(turn('c1', 'hello', '**Bold** and `code` in a [link](http://x)'));
    expect(docs.map((d) => [d.role, d.text])).toEqual([
      ['user', 'hello'],
      ['assistant', 'Bold and code in a link'],
    ]);
  });

  it('keeps code but drops fences and list markers', () => {
    expect(plainText('# Title\n\n- one\n- two\n\n```ts\nconst x = 1;\n```')).toBe(
      'Title\n\none\ntwo\n\n\nconst x = 1;',
    );
  });
});

describe('SearchIndex', () => {
  it('finds substrings across conversations, grouped, with highlighted snippets', () => {
    const index = new SearchIndex(':memory:');
    const a = turn(
      'a',
      'How do I redeploy the staging stack?',
      'Run the deploy script with --stage staging.',
    );
    const b = turn(
      'b',
      'Plan a trip to Lisbon',
      'Lisbon in spring is lovely. Deployment of sunscreen advised.',
    );
    index.index(convo('a', 'Staging deploys'), a);
    index.index(convo('b', 'Lisbon trip'), b);

    const res = index.search('deplo');
    expect(res.mode).toBe('exact');
    expect(res.groups.map((g) => g.conversationId).sort()).toEqual(['a', 'b']);
    const groupA = res.groups.find((g) => g.conversationId === 'a');
    expect(groupA).toMatchObject({ title: 'Staging deploys', matches: 2 });
    for (const hit of res.groups.flatMap((g) => g.hits)) {
      expect(hit.ranges.length).toBeGreaterThan(0);
      for (const [s, e] of hit.ranges) expect(hit.snippet.slice(s, e).toLowerCase()).toBe('deplo');
    }
  });

  it('requires every term, is accent-insensitive, and can scope to one conversation', () => {
    const index = new SearchIndex(':memory:');
    index.index(convo('a', 'Café'), turn('a', 'Best café in Zürich?', 'Try the one by the lake.'));
    index.index(convo('b', 'Other'), turn('b', 'cafe hours', 'Most open at 8.'));
    expect(index.search('zurich cafe').groups.map((g) => g.conversationId)).toEqual(['a']);
    expect(index.search('cafe', { in: 'b' }).groups.map((g) => g.conversationId)).toEqual(['b']);
    expect(index.search('cafe lake').groups.map((g) => g.conversationId)).toEqual(['a']);
  });

  it('falls back to typo-tolerant matches', () => {
    const index = new SearchIndex(':memory:');
    index.index(
      convo('a', 'K8s'),
      turn('a', 'my kubernetes pod keeps restarting', 'Check the liveness probe.'),
    );
    const res = index.search('kubernets');
    expect(res.mode).toBe('fuzzy');
    expect(res.groups[0]?.conversationId).toBe('a');
    expect(index.search('zzqxw').groups).toEqual([]);
  });

  it('reports short queries and never throws on odd syntax', () => {
    const index = new SearchIndex(':memory:');
    index.index(convo('a', 'x'), turn('a', 'NEAR( "quote* ^', 'ok'));
    expect(index.search('ab').mode).toBe('short');
    expect(() => index.search('NEAR( "quote* ^')).not.toThrow();
    expect(index.search('"quote*').groups).toHaveLength(1);
  });

  it('updates incrementally, retitles and removes', () => {
    const index = new SearchIndex(':memory:');
    const events = turn('a', 'first question about parsers', 'answer one');
    index.index(convo('a', 'Parsers'), events);
    events.push(...turn('a', 'second question about lexers', 'answer two'));
    index.index(convo('a', 'Parsers', 2), events);
    expect(index.indexedAt('a')).toBe(2);
    expect(index.search('lexers').groups).toHaveLength(1);
    index.retitle('a', 'Compilers', 3);
    expect(index.search('parsers').groups[0]?.title).toBe('Compilers');
    index.remove('a');
    expect(index.search('parsers').groups).toEqual([]);
    expect(index.ids()).toEqual([]);
  });

  it('previews the matching message with its neighbours', () => {
    const index = new SearchIndex(':memory:');
    const events = [
      ...turn('a', 'one', 'reply one'),
      ...turn('a', 'the needle question', 'reply two'),
      ...turn('a', 'three', 'reply three'),
    ];
    index.index(convo('a', 'Haystack'), events);
    const hit = index.search('needle').groups[0]?.hits[0];
    const preview = index.preview('a', hit?.anchor, 'needle');
    expect(preview?.messageCount).toBe(6);
    expect(preview?.messages.map((m) => m.text)).toEqual([
      'one',
      'reply one',
      'the needle question',
      'reply two',
      'three',
    ]);
    const focus = preview?.messages.find((m) => m.focus);
    expect(focus?.ranges).toEqual([[4, 10]]);
    expect(index.preview('a', undefined, '')?.messages).toHaveLength(4);
    expect(index.preview('missing', undefined, '')).toBeNull();
  });

  it('stays fast with a large history', () => {
    const index = new SearchIndex(':memory:');
    const words = [
      'alpha',
      'bravo',
      'charlie',
      'delta',
      'echo',
      'foxtrot',
      'golf',
      'hotel',
      'india',
    ];
    const sentence = (n: number) =>
      Array.from({ length: 40 }, (_, i) => words[(n * 7 + i * i + i) % words.length]).join(' ');
    for (let c = 0; c < 1000; c++) {
      const events: ConversationEvent[] = [];
      for (let t = 0; t < 10; t++)
        events.push(...turn(`c${c}`, sentence(c + t), sentence(c * t + 1)));
      if (c === 500) events.push(...turn(`c${c}`, 'the unique zebracorn', 'indeed'));
      index.index(convo(`c${c}`, `Conversation ${c}`), events);
    }
    const t0 = performance.now();
    const rare = index.search('zebracorn');
    const rareMs = performance.now() - t0;
    const t1 = performance.now();
    const common = index.search('charlie delta');
    const commonMs = performance.now() - t1;
    expect(rare.groups[0]?.conversationId).toBe('c500');
    expect(common.groups.length).toBeGreaterThan(0);
    expect(common.capped).toBe(true);
    console.warn(`20k docs: rare ${rareMs.toFixed(1)}ms, common ${commonMs.toFixed(1)}ms`);
    expect(rareMs).toBeLessThan(50);
    expect(commonMs).toBeLessThan(400);
  }, 60_000);
});
