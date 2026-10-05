import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ConversationEvent, ConversationSummary, TaintSource } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import type { CompletionInput, Engine } from '../engines/types';
import { mintConsent } from '../memory/consent';
import { MemoryStore } from '../memory/store';
import { QuietLearning, type QuietLearningDeps } from './service';
import { LearningSpend } from './spend';

/** Keep, as the route answers it: the person's answer for the words they saw (ADR 0087). */
async function keep(learning: QuietLearning, entryId: string, seen?: string) {
  const entry = await learning.store.entry(entryId);
  const consent = mintConsent({ method: 'POST', url: '/api/learning/answer' }, 'keep', {
    id: entry?.after.id ?? '',
    content: seen ?? entry?.after.content ?? '',
  });
  return learning.answer(entryId, 'keep', consent);
}

const NOW = new Date(2026, 9, 10, 12).getTime();
const MIN = 60_000;

type Input = ConversationEvent extends infer E
  ? E extends ConversationEvent
    ? Omit<E, 'conversationId' | 'seq' | 'at'>
    : never
  : never;

const you = (text: string): Input => ({ type: 'user.message', messageId: `u${text}`, text });
const reply = (text = 'Done.'): Input[] => [
  { type: 'assistant.delta', messageId: 'a', kind: 'text', delta: text },
  { type: 'turn.completed', outcome: 'success', engine: 'mock' },
];
const taint = (source: TaintSource): Input => ({ type: 'taint', source });

/** A pretend provider: "no, I meant X" teaches a preference; "I moved to Y" moves "Lives in …". */
function provider(
  options: { fail?: boolean; garbled?: boolean; costUsd?: number; metered?: boolean } = {},
) {
  const asked: CompletionInput[] = [];
  const engine = {
    id: 'mock',
    label: 'Mock',
    // On this computer (free) unless it's a pay-as-you-go provider.
    local: !options.metered,
    integrations: { mode: 'bridge' },
    detect: async () => ({ state: 'ready', auth: { method: 'api-key', description: 'Key' } }),
  } as unknown as Engine;
  const complete = async (input: CompletionInput) => {
    asked.push(input);
    if (options.fail) throw new Error('down');
    if (options.garbled) return { text: 'Sure! I learned a lot.' };
    const changes: unknown[] = [];
    const meant = /<said[^>]*>(No, I meant ([^.<]+))/i.exec(input.prompt);
    if (meant)
      changes.push({
        op: 'add',
        kind: 'preference',
        text: `Prefers ${meant[2]}`,
        quote: meant[1],
        basis: 'corrected',
      });
    const moved = /<said[^>]*>[^<]*?(I moved to (\w+))/i.exec(input.prompt);
    const home = /^\[(m_\w+)\] \(\w+\) Lives in /m.exec(input.prompt);
    if (moved && home)
      changes.push({
        op: 'supersede',
        id: home[1],
        text: `Lives in ${moved[2]}`,
        why: 'You moved.',
        quote: moved[1],
      });
    return {
      text: JSON.stringify({ changes }),
      usage: {
        inputTokens: 300,
        outputTokens: 40,
        ...(options.costUsd !== undefined && { costUsd: options.costUsd }),
      },
    };
  };
  return { engine, complete, asked };
}

async function setup(
  chats: { summary: Partial<ConversationSummary> & { id: string }; events: Input[] }[],
  options: {
    model?: ReturnType<typeof provider> | null;
    autoMemory?: boolean;
    now?: { at: number };
  } = {},
) {
  const home = await mkdtemp(join(tmpdir(), 'conch-quiet-'));
  const memory = new MemoryStore(join(home, 'memory'));
  const clock = options.now ?? { at: NOW };
  const model = options.model === undefined ? provider() : options.model;
  const notes: { id: string; event: unknown }[] = [];
  const logs = new Map(
    chats.map((c) => [
      c.summary.id,
      c.events.map(
        (e, i) =>
          ({
            ...e,
            conversationId: c.summary.id,
            seq: i + 1,
            at: NOW - 30 * MIN + i,
          }) as ConversationEvent,
      ),
    ]),
  );
  const summaries: ConversationSummary[] = chats.map((c) => ({
    title: `Chat ${c.summary.id}`,
    preview: '',
    createdAt: NOW - 60 * MIN,
    updatedAt: NOW - 20 * MIN,
    status: 'idle',
    options: {},
    ...c.summary,
  }));
  const spend = new LearningSpend({ home, now: () => clock.at });
  const deps: QuietLearningDeps = {
    home,
    memory,
    search: async (q, limit) => (await memory.search(q, limit)).map((m) => ({ memory: m })),
    spend,
    chats: async () => summaries,
    events: async (id) => logs.get(id) ?? [],
    model: async () =>
      model ? { engine: model.engine, model: 'cheap', complete: model.complete } : undefined,
    settings: async () => ({ autoMemory: options.autoMemory ?? true }),
    note: async (id, event) => {
      notes.push({ id, event });
    },
    now: () => clock.at,
  };
  const learning = new QuietLearning(deps);
  return { learning, memory, notes, model, home, deps, clock, summaries };
}

describe('QuietLearning (ADR 0088)', () => {
  it('a correction in a chat you were in is learned, and the chat says so', async () => {
    const { learning, memory, notes } = await setup([
      {
        summary: { id: 'c1' },
        events: [you('Write it in Python'), ...reply(), you('No, I meant TypeScript.'), ...reply()],
      },
    ]);
    const result = await learning.review('c1', { trigger: 'idle' });
    expect('learned' in result && result.learned.map((e) => e.state)).toEqual(['applied']);
    const [kept] = await memory.list();
    expect(kept).toMatchObject({
      content: 'Prefers TypeScript',
      kind: 'preference',
      source: 'agent',
      conversationId: 'c1',
    });
    expect(kept?.learned).toMatch(/^le_/);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.event).toMatchObject({
      type: 'learning.noted',
      items: [{ text: 'Prefers TypeScript', change: 'added', state: 'applied' }],
    });
    const [entry] = await learning.store.entries();
    expect(entry?.from).toMatchObject({
      quotes: ['No, I meant TypeScript'],
      signals: ['correction'],
      trigger: 'idle',
    });
    // Read once: nothing new to read again.
    expect(await learning.review('c1', { trigger: 'idle' })).toEqual({ why: 'nothing-new' });
  });

  it('nothing lasting and nothing corrected: no model is asked', async () => {
    const { learning, model } = await setup([
      { summary: { id: 'c1' }, events: [you('What is the capital of Peru?'), ...reply('Lima.')] },
    ]);
    expect(await learning.review('c1', { trigger: 'idle' })).toEqual({ why: 'nothing-to-learn' });
    expect(model?.asked).toHaveLength(0);
    expect(await learning.review('c1', { trigger: 'idle' })).toEqual({ why: 'nothing-new' });
  });

  it('after reading something from outside: it waits, as a memory waiting for your OK', async () => {
    const { learning, memory, notes } = await setup([
      {
        summary: { id: 'c1' },
        events: [
          you('Find me a recipe'),
          taint({ kind: 'web', label: 'recipes.example' }),
          ...reply(),
          you('No, I meant vegetarian.'),
          ...reply(),
        ],
      },
    ]);
    const result = await learning.review('c1', { trigger: 'idle' });
    expect('learned' in result && result.learned[0]?.state).toBe('waiting');
    const [waiting] = await memory.list();
    expect(waiting).toMatchObject({
      pending: true,
      untrusted: 'Learned in a chat that read recipes.example.',
    });
    expect(notes[0]?.event).toMatchObject({
      items: [{ state: 'waiting', waits: 'Learned in a chat that read recipes.example.' }],
    });
    // Keep: it's remembered, and the chat says so.
    await keep(learning, ('learned' in result && result.learned[0]?.id) || '');
    expect((await memory.list())[0]?.pending).toBeUndefined();
    expect(notes.at(-1)?.event).toMatchObject({ type: 'learning.decided', state: 'kept' });
  });

  it('nobody watching (a chat app): it waits, and the chat gets no line', async () => {
    const { learning, notes } = await setup([
      {
        summary: {
          id: 'c1',
          origin: { kind: 'channel', channelId: 'tg', channel: 'telegram' },
        },
        events: [you('Summarise it'), ...reply(), you('No, I meant in bullet points.'), ...reply()],
      },
    ]);
    const result = await learning.review('c1', { trigger: 'idle' });
    expect('learned' in result && result.learned[0]?.state).toBe('waiting');
    expect(notes).toHaveLength(0);
  });

  it('someone else’s words, routines, tasks and guests: nothing is learned', async () => {
    const { learning, model } = await setup([
      {
        summary: { id: 'c1' },
        events: [
          you('Hi'),
          taint({ kind: 'person', label: 'Sam' }),
          ...reply(),
          you('No, I meant tea.'),
        ],
      },
      {
        summary: { id: 'c2', origin: { kind: 'routine', routineId: 'r', runId: 'x' } },
        events: [you('No, I meant tea.')],
      },
      {
        summary: { id: 'c3', origin: { kind: 'task', taskId: 't' } },
        events: [you('No, I meant tea.')],
      },
    ]);
    expect(await learning.review('c1', { trigger: 'idle' })).toEqual({ why: 'someone-else' });
    expect(await learning.review('c2', { trigger: 'idle' })).toEqual({ why: 'not-yours' });
    expect(await learning.review('c3', { trigger: 'idle' })).toEqual({ why: 'not-yours' });
    expect(model?.asked).toHaveLength(0);
  });

  it('learning off, or a chat marked not to learn from: nothing', async () => {
    const off = await setup(
      [{ summary: { id: 'c1' }, events: [you('a'), ...reply(), you('No, I meant b.')] }],
      { autoMemory: false },
    );
    expect(await off.learning.review('c1', { trigger: 'idle' })).toEqual({ why: 'off' });
    const quiet = await setup([
      { summary: { id: 'c1' }, events: [you('a'), ...reply(), you('No, I meant b.')] },
    ]);
    await quiet.learning.quiet('c1', true);
    expect(await quiet.learning.review('c1', { trigger: 'idle' })).toEqual({ why: 'quiet' });
    expect((await quiet.learning.status()).quiet).toEqual(['c1']);
  });

  it('no model to ask: the words wait for a later look', async () => {
    const { learning } = await setup(
      [
        {
          summary: { id: 'c1' },
          events: [you('a'), ...reply(), you('No, I meant b.'), ...reply()],
        },
      ],
      { model: null },
    );
    expect(await learning.review('c1', { trigger: 'idle' })).toEqual({ why: 'no-model' });
    expect((await learning.store.chat('c1')).reviewed).toBeUndefined();
    expect((await learning.status()).paused).toEqual({ reason: 'no-model' });
  });

  it('at the cap: it rests, and the words wait', async () => {
    const model = provider({ costUsd: 0.6, metered: true });
    const { learning } = await setup(
      [
        {
          summary: { id: 'c1' },
          events: [you('a'), ...reply(), you('No, I meant b.'), ...reply()],
        },
        {
          summary: { id: 'c2' },
          events: [you('a'), ...reply(), you('No, I meant c.'), ...reply()],
        },
        {
          summary: { id: 'c3' },
          events: [you('a'), ...reply(), you('No, I meant d.'), ...reply()],
        },
      ],
      { model },
    );
    await learning.review('c1', { trigger: 'idle' });
    await learning.review('c2', { trigger: 'idle' });
    expect(await learning.review('c3', { trigger: 'idle' })).toEqual({ why: 'cap' });
    expect((await learning.store.chat('c3')).reviewed).toBeUndefined();
    expect((await learning.status()).paused).toMatchObject({ reason: 'cap' });
  });

  it('“I moved” supersedes: the old one is kept, dated, and Undo brings it back', async () => {
    const { learning, memory } = await setup([
      {
        summary: { id: 'c1' },
        events: [
          you('Weekend ideas?'),
          ...reply(),
          you('I moved to Lisbon last month, so somewhere there.'),
          ...reply(),
        ],
      },
    ]);
    const berlin = await memory.add({ content: 'Lives in Berlin', source: 'agent' });
    const result = await learning.review('c1', { trigger: 'idle' });
    const entry = 'learned' in result ? result.learned[0] : undefined;
    expect(entry).toMatchObject({
      change: 'superseded',
      state: 'applied',
      before: { content: 'Lives in Berlin' },
    });
    expect((await memory.list()).map((m) => m.content)).toEqual(['Lives in Lisbon']);
    expect((await memory.listPast()).map((m) => m.content)).toEqual(['Lives in Berlin']);

    await learning.answer(entry?.id ?? '', 'undo');
    expect(await memory.list()).toEqual([berlin]);
    expect(await memory.listPast()).toEqual([]);
    expect((await learning.store.never()).map((n) => n.text)).toEqual(['Lives in Lisbon']);
  });

  it('replacing something you wrote yourself waits; Keep makes it so', async () => {
    const { learning, memory } = await setup([
      {
        summary: { id: 'c1' },
        events: [
          you('Weekend ideas?'),
          ...reply(),
          you('I moved to Porto, by the way.'),
          ...reply(),
        ],
      },
    ]);
    await memory.add({ content: 'Lives in Berlin', source: 'user' });
    const result = await learning.review('c1', { trigger: 'idle' });
    const entry = 'learned' in result ? result.learned[0] : undefined;
    expect(entry?.state).toBe('waiting');
    // It waits as a memory waiting for your OK; Berlin is still what's true.
    expect((await memory.usable()).map((m) => m.content)).toEqual(['Lives in Berlin']);
    const kept = await keep(learning, entry?.id ?? '');
    expect(typeof kept === 'object' && kept.state).toBe('kept');
    expect((await memory.list()).map((m) => m.content)).toEqual(['Lives in Porto']);
    expect((await memory.listPast()).map((m) => m.content)).toEqual(['Lives in Berlin']);
  });

  it('what you undid is never learned again', async () => {
    const { learning, memory } = await setup([
      {
        summary: { id: 'c1' },
        events: [you('a'), ...reply(), you('No, I meant TypeScript.'), ...reply()],
      },
      {
        summary: { id: 'c2' },
        events: [you('b'), ...reply(), you('No, I meant TypeScript.'), ...reply()],
      },
    ]);
    const first = await learning.review('c1', { trigger: 'idle' });
    await learning.answer(('learned' in first && first.learned[0]?.id) || '', 'undo');
    expect(await memory.list()).toEqual([]);
    const again = await learning.review('c2', { trigger: 'idle' });
    expect(again).toEqual({ learned: [] });
    expect(await memory.list()).toEqual([]);
  });

  it('forgetting a memory Conch wrote puts it on the list; one you wrote never does', async () => {
    const { learning, memory } = await setup([]);
    const theirs = await memory.add({ content: 'Prefers tea', source: 'agent' });
    const yours = await memory.add({ content: 'Prefers coffee', source: 'user' });
    await learning.forgotten(theirs);
    await learning.forgotten(yours);
    expect((await learning.store.never()).map((n) => n.text)).toEqual(['Prefers tea']);
  });

  it('a fact about this computer is learned by code, without a model', async () => {
    const { learning, memory, model } = await setup([
      {
        summary: { id: 'c1' },
        events: [
          you('Run the script'),
          {
            type: 'tool.started',
            toolUseId: 't1',
            name: 'Bash',
            input: { command: 'python run.py' },
          },
          {
            type: 'tool.finished',
            toolUseId: 't1',
            status: 'error',
            output: 'bash: python: command not found',
          },
          { type: 'tool.started', toolUseId: 't2', name: 'Bash', input: { command: 'py run.py' } },
          { type: 'tool.finished', toolUseId: 't2', status: 'success', output: 'ok' },
          ...reply(),
        ],
      },
    ]);
    const result = await learning.review('c1', { trigger: 'idle' });
    expect('learned' in result && result.learned[0]?.after).toMatchObject({
      content: 'On this computer, `python` isn’t found; `py` works.',
      about: 'environment',
      kind: 'fact',
    });
    expect(model?.asked).toHaveLength(0);
    expect((await memory.list())[0]?.about).toBe('environment');
  });

  it('compaction reads only the words before the cut; the rest later', async () => {
    const { learning, memory } = await setup([
      {
        summary: { id: 'c1' },
        events: [
          you('a'),
          ...reply(),
          you('No, I meant TypeScript.'),
          ...reply(),
          you('No, I meant Rust.'),
          ...reply(),
        ],
      },
    ]);
    await learning.review('c1', { trigger: 'compaction', beforeSeq: 7 });
    expect((await memory.list()).map((m) => m.content)).toEqual(['Prefers TypeScript']);
    expect((await learning.store.chat('c1')).reviewed).toBe(6);
    await learning.review('c1', { trigger: 'idle' });
    expect((await memory.list()).map((m) => m.content).sort()).toEqual([
      'Prefers Rust',
      'Prefers TypeScript',
    ]);
  });

  it('an answer it can’t read twice: those words are passed over', async () => {
    const { learning } = await setup(
      [
        {
          summary: { id: 'c1' },
          events: [you('a'), ...reply(), you('No, I meant b.'), ...reply()],
        },
      ],
      { model: provider({ garbled: true }) },
    );
    expect(await learning.review('c1', { trigger: 'idle' })).toEqual({ why: 'unreadable' });
    expect((await learning.store.chat('c1')).reviewed).toBeUndefined();
    expect(await learning.review('c1', { trigger: 'idle' })).toEqual({ why: 'unreadable' });
    expect((await learning.store.chat('c1')).reviewed).toBe(6);
  });

  it('the sweep looks only at quiet chats with something new, a couple at a time', async () => {
    const { learning, summaries, model } = await setup([
      {
        summary: { id: 'busy', status: 'running' },
        events: [you('a'), ...reply(), you('No, I meant b.')],
      },
      {
        summary: { id: 'fresh', updatedAt: NOW - MIN },
        events: [you('a'), ...reply(), you('No, I meant c.')],
      },
      { summary: { id: 'q1' }, events: [you('a'), ...reply(), you('No, I meant d.'), ...reply()] },
      { summary: { id: 'q2' }, events: [you('a'), ...reply(), you('No, I meant e.'), ...reply()] },
      { summary: { id: 'q3' }, events: [you('a'), ...reply(), you('No, I meant f.'), ...reply()] },
    ]);
    expect(summaries).toHaveLength(5);
    expect(await learning.sweep()).toBe(2);
    expect(model?.asked).toHaveLength(2);
    expect(await learning.sweep()).toBe(1);
    // Nothing happened since: nothing to look at.
    expect(await learning.sweep()).toBe(0);
  });

  it('a look that waited for a model is tried again an hour on, and not before', async () => {
    const clock = { at: NOW };
    const model: { current: ReturnType<typeof provider> | null } = { current: null };
    const t = await setup(
      [
        {
          summary: { id: 'c1' },
          events: [you('a'), ...reply(), you('No, I meant Rust.'), ...reply()],
        },
      ],
      { now: clock },
    );
    t.deps.model = async () =>
      model.current
        ? { engine: model.current.engine, model: 'cheap', complete: model.current.complete }
        : undefined;
    const learning = new QuietLearning(t.deps);
    expect(await learning.sweep()).toBe(1);
    expect(await learning.sweep()).toBe(0);
    model.current = provider();
    clock.at += 61 * MIN;
    expect(await learning.sweep()).toBe(1);
    expect(model.current.asked).toHaveLength(1);
    expect((await learning.store.entries()).map((e) => e.after.content)).toEqual(['Prefers Rust']);
  });

  it('a provider that didn’t answer: the words wait for it, not passed over', async () => {
    const clock = { at: NOW };
    const down = provider({ fail: true });
    const t = await setup(
      [
        {
          summary: { id: 'c1' },
          events: [you('a'), ...reply(), you('No, I meant Rust.'), ...reply()],
        },
      ],
      { model: down, now: clock },
    );
    expect(await t.learning.review('c1', { trigger: 'idle' })).toEqual({ why: 'failed' });
    expect((await t.learning.store.chat('c1')).reviewed).toBeUndefined();
    // An hour on, it answers: the same words are read.
    const up = provider();
    t.deps.model = async () => ({ engine: up.engine, model: 'cheap', complete: up.complete });
    clock.at += 61 * MIN;
    expect(await t.learning.sweep()).toBe(1);
    expect((await t.memory.list()).map((m) => m.content)).toEqual(['Prefers Rust']);
  });

  it('what was said while a chat was marked not to learn from is never read', async () => {
    const { learning, memory, model } = await setup([
      {
        summary: { id: 'c1' },
        events: [you('a'), ...reply(), you('No, I meant Rust.'), ...reply()],
      },
    ]);
    await learning.quiet('c1', true);
    await learning.quiet('c1', false);
    expect(await learning.review('c1', { trigger: 'idle' })).toEqual({ why: 'nothing-new' });
    expect(model?.asked).toHaveLength(0);
    expect(await memory.list()).toEqual([]);
  });

  it('learning turned back on starts from there', async () => {
    const { learning, memory } = await setup([
      {
        summary: { id: 'c1' },
        events: [you('a'), ...reply(), you('No, I meant Rust.'), ...reply()],
      },
    ]);
    await learning.resumed();
    expect(await learning.review('c1', { trigger: 'idle' })).toEqual({ why: 'nothing-new' });
    expect(await memory.list()).toEqual([]);
  });

  it('what a compaction learned is said with the rest, once the chat goes quiet', async () => {
    const { learning, notes } = await setup([
      {
        summary: { id: 'c1' },
        events: [
          you('a'),
          ...reply(),
          you('No, I meant TypeScript.'),
          ...reply(),
          you('No, I meant Rust.'),
          ...reply(),
        ],
      },
    ]);
    // Mid-chat: nothing is said yet, so nothing lands in the middle of a reply.
    await learning.review('c1', { trigger: 'compaction', beforeSeq: 7 });
    expect(notes).toHaveLength(0);
    await learning.review('c1', { trigger: 'idle' });
    expect(notes).toHaveLength(1);
    expect(notes[0]?.event).toMatchObject({
      type: 'learning.noted',
      items: [{ text: 'Prefers TypeScript' }, { text: 'Prefers Rust' }],
    });
    expect((await learning.store.chat('c1')).unsaid).toEqual([]);
  });

  it('forgetting what replaced something leaves it gone, not undone', async () => {
    const { learning, memory } = await setup([
      {
        summary: { id: 'c1' },
        events: [you('Weekend ideas?'), ...reply(), you('I moved to Lisbon in May.'), ...reply()],
      },
    ]);
    await memory.add({ content: 'Lives in Berlin', source: 'agent' });
    const result = await learning.review('c1', { trigger: 'idle' });
    const entry = 'learned' in result ? result.learned[0] : undefined;
    const lisbon = (await memory.list())[0];
    if (lisbon) await learning.forgotten(lisbon);
    expect((await learning.store.entry(entry?.id ?? ''))?.state).toBe('gone');
  });

  it('Keep is for the words you saw: different words now keep nothing', async () => {
    const { learning, memory } = await setup([
      {
        summary: { id: 'c1' },
        events: [
          you('Find me a recipe'),
          taint({ kind: 'web', label: 'recipes.example' }),
          ...reply(),
          you('No, I meant vegetarian.'),
          ...reply(),
        ],
      },
    ]);
    const result = await learning.review('c1', { trigger: 'idle' });
    const id = ('learned' in result && result.learned[0]?.id) || '';
    expect(await keep(learning, id, 'Prefers steak')).toBe('changed');
    expect((await memory.list())[0]?.pending).toBe(true);
    const kept = await keep(learning, id, 'Prefers vegetarian');
    expect(typeof kept === 'object' && kept.state).toBe('kept');
  });

  it('a chat read through isn’t picked again until something new happens', async () => {
    const { learning, summaries } = await setup([
      { summary: { id: 'c1' }, events: [you('What is the capital of Peru?'), ...reply()] },
    ]);
    expect(await learning.sweep()).toBe(1);
    expect(await learning.sweep()).toBe(0);
    const chat = summaries[0];
    if (chat) chat.updatedAt += 1;
    expect(await learning.sweep()).toBe(1);
  });

  it('putting a memory back takes its words off the never-list', async () => {
    const { learning, memory } = await setup([]);
    const tea = await memory.add({ content: 'Prefers tea', source: 'agent' });
    await learning.forgotten(tea);
    expect((await learning.store.never()).map((n) => n.text)).toEqual(['Prefers tea']);
    await learning.kept(tea);
    expect(await learning.store.never()).toEqual([]);
  });

  it('Undo on what the assistant remembered in a chat tells that chat’s pill', async () => {
    const { learning, memory, notes } = await setup([]);
    const saved = await memory.add({
      content: 'Prefers tea',
      source: 'agent',
      conversationId: 'c1',
    });
    await learning.remembered(saved, { id: 'c1', title: 'Drinks' });
    const [entry] = await learning.store.entries();
    await learning.answer(entry?.id ?? '', 'undo');
    expect(notes.at(-1)).toEqual({
      id: 'c1',
      event: { type: 'memory.decided', memoryId: saved.id, kept: false },
    });
  });

  it('survives a restart: how far it read is kept', async () => {
    const { learning, deps } = await setup([
      {
        summary: { id: 'c1' },
        events: [you('a'), ...reply(), you('No, I meant TypeScript.'), ...reply()],
      },
    ]);
    await learning.review('c1', { trigger: 'idle' });
    const again = new QuietLearning(deps);
    expect(await again.review('c1', { trigger: 'idle' })).toEqual({ why: 'nothing-new' });
    expect(await again.store.entries()).toHaveLength(1);
  });

  it('the week at a glance until you’ve seen it', async () => {
    const { learning } = await setup([
      {
        summary: { id: 'c1' },
        events: [you('a'), ...reply(), you('No, I meant TypeScript.'), ...reply()],
      },
    ]);
    await learning.review('c1', { trigger: 'idle' });
    expect((await learning.status()).recap).toMatchObject({
      count: 1,
      items: ['Prefers TypeScript'],
    });
    await learning.seeRecap();
    expect((await learning.status()).recap).toBeUndefined();
  });
});
