/**
 * Long chats on every model (ADR 0055), through the engine: the transcript
 * fits the model's window, the start is summarised by the cheapest model, a
 * "too long" refusal heals itself once, and `/compact` folds on request.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ModelInfo } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import type { CompletionInput, EngineEvent, TurnInput } from '../types';
import { SUMMARY_SYSTEM } from './context';
import { ApiEngine } from './engine';
import { collect, fakeHome } from './fake';
import { sessionsDir } from './session';
import { ApiError, TOO_LONG, type ApiVariant, type WireEvent, type WireRequest } from './types';
import type { Wire } from './wire';

const CHAT = 'acme/chat-large';
const CHEAP = 'acme/chat-mini';

const model = (id: string, context?: number): { info: ModelInfo; tools: boolean } => ({
  info: {
    id,
    label: id === CHAT ? 'Acme Large' : 'Acme Mini',
    description: '',
    efforts: [],
    supportsFastMode: false,
    supportsAutoMode: false,
    ...(context && { context }),
  },
  // Chat only keeps the tool list out of the arithmetic.
  tools: false,
});

interface Script {
  /** What the chat model streams back; throwing is a refusal. */
  answer?: (request: WireRequest, n: number) => AsyncIterable<WireEvent>;
  /** What a summarising request gets back. */
  summary?: (input: CompletionInput, n: number) => string | Promise<string>;
  window?: number;
  local?: boolean;
  models?: string[];
}

function said(text: string, inputTokens = 0): AsyncIterable<WireEvent> {
  return (async function* () {
    yield { type: 'text', delta: text };
    yield {
      type: 'end',
      message: { role: 'assistant', content: text },
      toolCalls: [],
      stop: 'end',
      usage: { inputTokens, outputTokens: 5 },
    };
  })();
}

async function setup(script: Script = {}) {
  const requests: WireRequest[] = [];
  const completions: CompletionInput[] = [];
  const wire: Wire = {
    source: 'Acme',
    check: async () => ({ description: 'Acme' }),
    models: async () =>
      (script.models ?? [CHAT, CHEAP]).map((id) =>
        model(id, id === CHAT ? (script.window ?? 16_000) : 128_000),
      ),
    stream: (request) => {
      requests.push({ ...request, messages: structuredClone(request.messages) });
      return script.answer?.(request, requests.length) ?? said('Sure.');
    },
    complete: async (request) => {
      completions.push({ ...request, signal: new AbortController().signal });
      const text = await (script.summary?.(request, completions.length) ??
        `What the person wants\n- Summary number ${completions.length}.`);
      return { text, usage: { inputTokens: 100, outputTokens: 50, costUsd: 0.001 } };
    },
    userMessage: (content) => ({ role: 'user', content }),
    toolResults: (results) =>
      results.map((r) => ({ role: 'tool', tool_call_id: r.id, content: r.text })),
    smallModel: () => undefined,
  };
  const { home, settings, keys } = await fakeHome();
  await keys.save('openrouter', 'sk-' + 'test-key-value');
  const variant: ApiVariant = {
    id: 'openrouter',
    label: 'Acme',
    docsUrl: 'https://example.com',
    keyUrl: 'https://example.com',
    canSignIn: false,
    wire,
    home,
    ...(script.local && { local: true, keyless: true }),
  };
  const engine = new ApiEngine(variant, settings, keys);
  let resumeId: string | undefined;
  const ask = async (prompt: string, seq: number) => {
    const turn: TurnInput = {
      conversationId: 'c_1',
      prompt,
      seq,
      ...(resumeId && { resumeId }),
      systemAppend: 'You are Pearl.',
      cwd: process.cwd(),
      tools: [],
      requestPermission: async () => 'allow',
      signal: new AbortController().signal,
      options: { model: CHAT, effort: 'auto', fastMode: false, permissionMode: 'default' },
    };
    const events = await collect(engine.runTurn(turn));
    const session = events.find((e) => e.type === 'session');
    if (session?.type === 'session') resumeId = session.resumeId;
    return events;
  };
  const stored = async () =>
    JSON.parse(await readFile(join(sessionsDir(home), `${resumeId}.json`), 'utf8')) as {
      messages: { role: string; content: unknown }[];
      summary?: { text: string; turns: number };
      seqs: (number | null)[];
    };
  return { engine, ask, requests, completions, stored, resumeId: () => resumeId };
}

const compactions = (events: EngineEvent[]) =>
  events.filter((e): e is Extract<EngineEvent, { type: 'compacted' }> => e.type === 'compacted');
/** About 1,000 tokens of the person's words. */
const long = (n: number) => `Message ${n}: ${'plant the tomatoes by the fence '.repeat(125)}`;

describe('a long chat on a model API', () => {
  it('fits a small window by summarising the start with the cheapest model, and says where memory starts', async () => {
    const chat = await setup();
    const all: EngineEvent[] = [];
    for (let i = 0; i < 14; i++) all.push(...(await chat.ask(long(i), i * 10)));

    const folded = compactions(all);
    expect(folded.length).toBeGreaterThan(0);
    // Not every turn: it folds down to half the budget, so it happens rarely.
    expect(folded.length).toBeLessThan(5);
    expect(chat.completions[0]).toMatchObject({ model: CHEAP, system: SUMMARY_SYSTEM });
    expect(chat.completions[0]?.prompt).toContain('Person: Message 0:');
    expect(folded[0]).toMatchObject({ model: 'Acme Large', summary: expect.any(String) });

    // The model's word-for-word memory starts at the first turn it still has.
    const file = await chat.stored();
    const last = folded.at(-1);
    expect(file.seqs[0]).toBe(last?.fromSeq);
    expect(file.summary?.turns).toBe(last?.turns);
    expect(
      (file.messages[0]?.content as string).startsWith(`Message ${(last?.fromSeq ?? 0) / 10}:`),
    ).toBe(true);

    // Every request fits: the summary rides in front, and the window is never exceeded.
    const request = chat.requests.at(-1);
    expect(request?.messages[0]?.content).toMatch(/^<earlier-in-this-chat>/);
    expect(JSON.stringify(request?.messages).length / 4).toBeLessThan(16_000);
  });

  it('folds the summary so far into the next one', async () => {
    const chat = await setup({ window: 9_000 });
    const all: EngineEvent[] = [];
    for (let i = 0; i < 16; i++) all.push(...(await chat.ask(long(i), i)));
    expect(compactions(all).length).toBeGreaterThan(1);
    const second = chat.completions.find((c) => c.prompt.includes('<summary>'));
    expect(second?.prompt).toContain('Summary number 1.');
  });

  it('counts what summarising cost in the turn that needed it', async () => {
    const chat = await setup({ window: 9_000 });
    let done: Extract<EngineEvent, { type: 'done' }> | undefined;
    let asked = 0;
    for (let i = 0; i < 8; i++) {
      const before = chat.completions.length;
      const events = await chat.ask(long(i), i);
      if (compactions(events).length) {
        done = events.at(-1) as typeof done;
        asked = chat.completions.length - before;
      }
    }
    expect(done?.usage?.inputTokens).toBeGreaterThanOrEqual(100);
    // Each summarising request costs $0.001; a small window takes the chat in pieces that fit it.
    expect(asked).toBeGreaterThan(0);
    expect(done?.usage?.costUsd).toBeCloseTo(0.001 * asked, 6);
  });

  it('says what summarising cost as soon as it’s paid, before the next request (ADR 0057)', async () => {
    const chat = await setup({ window: 9_000 });
    for (let i = 0; i < 8; i++) {
      const before = chat.completions.length;
      const events = await chat.ask(long(i), i);
      if (!compactions(events).length) continue;
      const folded = events.findIndex((e) => e.type === 'compacted');
      const said = events.findIndex((e, at) => at > folded && e.type === 'usage');
      expect(said).toBeGreaterThan(folded);
      const asked = chat.completions.length - before;
      expect(events[said]).toMatchObject({ type: 'usage', usage: { costUsd: 0.001 * asked } });
      // Before the model's answer: an unattended run can stop at its limit first.
      expect(said).toBeLessThan(events.findIndex((e) => e.type === 'text'));
      return;
    }
    throw new Error('never compacted');
  });

  it('keeps every turn while the chat is short, and the prefix the same from turn to turn', async () => {
    const chat = await setup();
    for (let i = 0; i < 3; i++) await chat.ask(`short ${i}`, i);
    expect(chat.completions).toHaveLength(0);
    const [first, second, third] = chat.requests;
    expect(second?.messages.slice(0, first?.messages.length)).toEqual(first?.messages);
    expect(third?.messages.slice(0, second?.messages.length)).toEqual(second?.messages);
  });

  it('keeps the prefix the same between compactions, so the provider’s cache keeps working', async () => {
    const chat = await setup();
    const runs: EngineEvent[][] = [];
    for (let i = 0; i < 14; i++) runs.push(await chat.ask(long(i), i));
    const at = runs.findIndex(
      (events, i) => compactions(events).length > 0 && !compactions(runs[i + 1] ?? []).length,
    );
    expect(at).toBeGreaterThan(0);
    // The turn after a compaction starts with exactly what the compacted turn sent.
    const during = chat.requests[at];
    const after = chat.requests[at + 1];
    expect(during?.messages[0]?.content).toMatch(/^<earlier-in-this-chat>/);
    expect(after?.messages.slice(0, during?.messages.length)).toEqual(during?.messages);
  });

  it('drops the oldest turns as before when no model will summarise, and carries on', async () => {
    const chat = await setup({
      window: 9_000,
      summary: () => {
        throw new Error('down');
      },
    });
    const all: EngineEvent[] = [];
    for (let i = 0; i < 8; i++) all.push(...(await chat.ask(long(i), i)));
    const folded = compactions(all);
    expect(folded.length).toBeGreaterThan(0);
    expect(folded[0]?.summary).toBe('');
    expect(all.filter((e) => e.type === 'done').every((e) => e.outcome === 'success')).toBe(true);
    expect((await chat.stored()).summary).toBeUndefined();
    // It tried the cheap model, then the chat's own.
    expect(chat.completions.slice(0, 2).map((c) => c.model)).toEqual([CHEAP, CHAT]);
  });

  it('asks the chat’s own model when the cheap one sends something that isn’t a summary', async () => {
    const chat = await setup({
      window: 9_000,
      summary: (input) =>
        input.model === CHEAP ? "I'm sorry, I can't do that." : 'Decided or done\n- Tomatoes.',
    });
    const all: EngineEvent[] = [];
    for (let i = 0; i < 8; i++) all.push(...(await chat.ask(long(i), i)));
    expect(compactions(all)[0]?.summary).toBe('Decided or done\n- Tomatoes.');
  });

  it('summarises a model on this computer with that same model, never loading another', async () => {
    const chat = await setup({ window: 9_000, local: true });
    for (let i = 0; i < 8; i++) await chat.ask(long(i), i);
    expect(chat.completions.length).toBeGreaterThan(0);
    expect(new Set(chat.completions.map((c) => c.model))).toEqual(new Set([CHAT]));
  });

  it('never changes the provider’s own messages it keeps', async () => {
    const signed = {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'reasoning', signature: 'sig-abc' },
        { type: 'redacted_thinking', data: 'opaque' },
        { type: 'text', text: 'Done.' },
      ],
    };
    const chat = await setup({
      window: 9_000,
      answer: () =>
        (async function* (): AsyncIterable<WireEvent> {
          yield { type: 'text', delta: 'Done.' };
          yield { type: 'end', message: signed, toolCalls: [], stop: 'end' };
        })(),
    });
    for (let i = 0; i < 8; i++) await chat.ask(long(i), i);
    const kept = (await chat.stored()).messages.filter((m) => m.role === 'assistant');
    for (const message of kept) expect(message).toEqual(signed);
  });

  it('shortens one huge paste to fit, keeping its start and its end', async () => {
    const chat = await setup({ window: 16_000 });
    const paste = `START ${'lorem ipsum dolor sit amet '.repeat(20_000)} END`;
    await chat.ask(paste, 0);
    const sent = chat.requests[0]?.messages[0]?.content as string;
    expect(sent.length).toBeLessThan(64_000);
    expect(sent).toMatch(/^START/);
    expect(sent).toMatch(/END$/);
    expect(sent).toContain('characters left out so this fits');
  });
});

describe('when the provider says “too long”', () => {
  it('folds harder and sends again by itself, once, and remembers the window it named', async () => {
    const chat = await setup({
      window: 128_000,
      answer: (request, n) =>
        n === 4
          ? (async function* (): AsyncIterable<WireEvent> {
              yield* [];
              throw new ApiError('context', TOO_LONG, { window: 4_000 });
            })()
          : said('Sure.'),
    });
    for (let i = 0; i < 3; i++) await chat.ask(long(i), i);
    const events = await chat.ask(long(3), 3);

    const healed = compactions(events);
    expect(healed).toHaveLength(1);
    expect(healed[0]).toMatchObject({ healed: true, fromSeq: 3 });
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'success' });
    // The second try carried only the summary and the turn being answered.
    const retry = chat.requests[4];
    expect(retry?.messages).toHaveLength(1);
    expect(retry?.messages[0]?.content).toMatch(/^<earlier-in-this-chat>/);

    // The window it named is kept: the next turn fits it without being refused.
    await chat.ask('and now?', 4);
    expect(JSON.stringify(chat.requests.at(-1)?.messages).length / 4).toBeLessThan(4_000);
  });

  it('says so plainly with one next step when it still doesn’t fit', async () => {
    const chat = await setup({
      answer: () =>
        (async function* (): AsyncIterable<WireEvent> {
          yield* [];
          throw new ApiError('context', TOO_LONG);
        })(),
    });
    const events = await chat.ask('hello', 0);
    // Asked twice: the second time folded and shortened.
    expect(chat.requests).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      outcome: 'error',
      problem: 'too-long',
      error: TOO_LONG,
    });
  });

  it('never asks again after the model has started answering', async () => {
    const chat = await setup({
      answer: () =>
        (async function* (): AsyncIterable<WireEvent> {
          yield { type: 'text', delta: 'Half an ans' };
          throw new ApiError('context', TOO_LONG);
        })(),
    });
    const events = await chat.ask('hello', 0);
    expect(chat.requests).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ outcome: 'error', problem: 'too-long' });
  });
});

describe('/compact', () => {
  it('folds everything but the newest turn now, keeping what the person asked for', async () => {
    const chat = await setup();
    for (let i = 0; i < 4; i++) await chat.ask(`turn ${i}`, i * 10);

    const done = await chat.engine.context.compact({
      resumeId: chat.resumeId() ?? '',
      model: CHAT,
      focus: 'the compost',
      signal: new AbortController().signal,
    });

    expect(done).toMatchObject({ turns: 3, fromSeq: 30, model: 'Acme Large' });
    expect(chat.completions[0]?.prompt).toContain('keep this above all: the compost');
    const file = await chat.stored();
    expect(file.messages).toHaveLength(2);
    expect(file.seqs).toEqual([30]);
    expect(file.summary?.text).toBe(done?.summary);

    // The next turn carries the summary in front.
    await chat.ask('what about the compost?', 40);
    expect(chat.requests.at(-1)?.messages[0]?.content).toMatch(/^<earlier-in-this-chat>/);
  });

  it('has nothing to fold in a chat of one turn, or one it doesn’t know', async () => {
    const chat = await setup();
    await chat.ask('hello', 0);
    const signal = new AbortController().signal;
    expect(
      await chat.engine.context.compact({ resumeId: chat.resumeId() ?? '', signal }),
    ).toBeUndefined();
    expect(await chat.engine.context.compact({ resumeId: '../x', signal })).toBeUndefined();
  });

  it('leaves the chat as it was when no summary can be written', async () => {
    const chat = await setup({
      summary: () => {
        throw new Error('down');
      },
    });
    for (let i = 0; i < 3; i++) await chat.ask(`turn ${i}`, i);
    await expect(
      chat.engine.context.compact({
        resumeId: chat.resumeId() ?? '',
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/couldn’t write a summary/);
    expect((await chat.stored()).messages).toHaveLength(6);
  });
});
