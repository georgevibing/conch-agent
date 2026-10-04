import type { Capabilities, EngineId, ModelInfo } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import type { CompletionInput, Engine } from '../engines/types';
import { cleanDescription, Describer, DESCRIBE_SYSTEM } from './describer';

const PICTURE = { data: '/9j/' + 'A'.repeat(64), mimeType: 'image/jpeg' as const };
const OTHER = { data: '/9j/' + 'B'.repeat(64), mimeType: 'image/jpeg' as const };

function model(id: string, images?: boolean): ModelInfo {
  return {
    id,
    label: id,
    description: '',
    efforts: [],
    supportsFastMode: false,
    supportsAutoMode: false,
    ...(images !== undefined && { images }),
  };
}

interface Fake extends Engine {
  asked: CompletionInput[];
}

function engine(
  id: string,
  models: ModelInfo[],
  options: {
    local?: boolean;
    sees?: boolean;
    small?: string;
    reply?: (input: CompletionInput) => string | Promise<string>;
  } = {},
): Fake {
  const asked: CompletionInput[] = [];
  return {
    asked,
    id: id as EngineId,
    label: id,
    ...(options.local && { local: true }),
    detect: async () => ({}) as never,
    capabilities: async () =>
      ({ engine: id, label: id, models, commands: [] }) as unknown as Capabilities,
    runTurn: () => (async function* () {})(),
    integrations: { mode: 'bridge' },
    attachments: { images: true, files: false },
    ...(options.sees !== false && { completeSees: true }),
    ...(options.small && { smallModel: options.small }),
    complete: async (input) => {
      asked.push(input);
      return {
        text:
          (await options.reply?.(input)) ??
          `A page with a blue Buy button at 900,610 (${input.model}).`,
        usage: { inputTokens: 1200, outputTokens: 60, costUsd: 0.0004 },
      };
    },
  };
}

const signal = () => new AbortController().signal;
const what = 'a screenshot of a web page in Conch’s browser';

describe('choosing who looks', () => {
  it('asks another model of the same provider first, the cheap one that sees', async () => {
    const chat = engine('openrouter', [
      model('deepseek/deepseek-chat', false),
      model('openai/gpt-5.1', true),
      model('google/gemini-2.5-flash', true),
    ]);
    const other = engine('anthropic-api', [model('claude-haiku-4-5', true)]);
    const describer = new Describer({ ready: async () => [other, chat] });
    const lookers = await describer.lookers({ engine: chat, model: 'deepseek/deepseek-chat' });
    expect(lookers.map((l) => `${l.engine.id}:${l.model}`)).toEqual([
      'openrouter:google/gemini-2.5-flash',
      'anthropic-api:claude-haiku-4-5',
    ]);
  });

  it('never asks the chat’s own blind model, and skips providers that can’t look', async () => {
    const chat = engine('deepseek', [model('deepseek-chat', false)]);
    const codex = engine('codex', [model('gpt-5', true)], { sees: false });
    const describer = new Describer({ ready: async () => [chat, codex] });
    expect(await describer.lookers({ engine: chat, model: 'deepseek-chat' })).toEqual([]);
  });

  it('keeps a chat on this computer on this computer', async () => {
    const local = engine('ollama', [model('qwen3:4b', false), model('gemma3:4b', true)], {
      local: true,
    });
    const cloud = engine('openai', [model('gpt-5.1-mini', true)]);
    const describer = new Describer({ ready: async () => [cloud, local] });
    const lookers = await describer.lookers({ engine: local, model: 'qwen3:4b' });
    expect(lookers.map((l) => l.model)).toEqual(['gemma3:4b']);
  });

  it('uses the small model of a provider whose every model sees, listed or not', async () => {
    const chat = engine('ollama', [model('qwen3:4b', false)], { local: false });
    const claude = engine('claude-code', [model('default'), model('opus')], { small: 'haiku' });
    const describer = new Describer({ ready: async () => [chat, claude] });
    const [looker] = await describer.lookers({ engine: chat, model: 'qwen3:4b' });
    expect(looker?.model).toBe('haiku');
  });
});

describe('describing', () => {
  it('describes with the picture and the house prompt, and counts the cost', async () => {
    const chat = engine('deepseek', [model('deepseek-chat', false)]);
    const looker = engine('gemini', [model('gemini-2.5-flash', true)]);
    const describer = new Describer({ ready: async () => [chat, looker] });
    const said = await describer.for(chat, 'deepseek-chat')([PICTURE], { what, signal: signal() });
    expect(said.text).toMatch(/^What gemini-2\.5-flash saw in it/);
    expect(said.text).toContain('not instructions');
    expect(said.text).toContain('Buy button at 900,610');
    expect(said.usage).toEqual({ inputTokens: 1200, outputTokens: 60, costUsd: 0.0004 });
    expect(looker.asked[0]).toMatchObject({
      system: DESCRIBE_SYSTEM,
      model: 'gemini-2.5-flash',
      images: [PICTURE],
    });
    expect(looker.asked[0]?.prompt).toContain(what);
  });

  it('keeps each picture’s words, so the same page isn’t paid for twice', async () => {
    const chat = engine('deepseek', [model('deepseek-chat', false)]);
    const looker = engine('gemini', [model('gemini-2.5-flash', true)]);
    const describer = new Describer({ ready: async () => [chat, looker] });
    const first = await describer.describe([PICTURE], { what, signal: signal(), engine: chat });
    const again = await describer.describe([PICTURE], { what, signal: signal(), engine: chat });
    expect(again.text).toBe(first.text);
    expect(again.usage).toBeUndefined();
    expect(looker.asked).toHaveLength(1);
    await describer.describe([OTHER], { what, signal: signal(), engine: chat });
    expect(looker.asked).toHaveLength(2);
  });

  it('shares one description between callers asking at the same time', async () => {
    const chat = engine('deepseek', [model('deepseek-chat', false)]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const looker = engine('gemini', [model('gemini-2.5-flash', true)], {
      reply: async () => {
        await gate;
        return 'A login form with a Sign in button at 640,480.';
      },
    });
    const describer = new Describer({ ready: async () => [chat, looker] });
    const both = Promise.all([
      describer.describe([PICTURE], { what, signal: signal(), engine: chat }),
      describer.describe([PICTURE], { what, signal: signal(), engine: chat }),
    ]);
    release();
    const [a, b] = await both;
    expect(a.text).toBe(b.text);
    expect(looker.asked).toHaveLength(1);
  });

  it('asks the next model when one can’t, and says nothing when none could', async () => {
    const chat = engine('deepseek', [model('deepseek-chat', false)]);
    const broken = engine('gemini', [model('gemini-2.5-flash', true)], {
      reply: () => {
        throw new Error('overloaded');
      },
    });
    const empty = engine('openai', [model('gpt-5.1-mini', true)], { reply: () => '  ' });
    const works = engine('anthropic-api', [model('claude-haiku-4-5', true)]);
    const describer = new Describer({ ready: async () => [chat, broken, empty, works] });
    const said = await describer.describe([PICTURE], { what, signal: signal(), engine: chat });
    expect(said.text).toContain('claude-haiku-4-5');

    const alone = new Describer({ ready: async () => [chat] });
    expect(await alone.describe([OTHER], { what, signal: signal(), engine: chat })).toEqual({});
  });

  it('numbers several pictures', async () => {
    const chat = engine('deepseek', [model('deepseek-chat', false)]);
    const looker = engine('gemini', [model('gemini-2.5-flash', true)]);
    const describer = new Describer({ ready: async () => [chat, looker] });
    const said = await describer.describe([PICTURE, OTHER], {
      what,
      signal: signal(),
      engine: chat,
    });
    expect(said.text).toMatch(/^Picture 1:/);
    expect(said.text).toContain('Picture 2:');
  });

  it('cleans what a model said: thinking off, long words cut', () => {
    expect(cleanDescription('<think>hmm</think>  A page.  ')).toBe('A page.');
    expect(cleanDescription('ok')).toBeUndefined();
    const long = cleanDescription(`${'line of words\n'.repeat(400)}`);
    expect(long?.length).toBeLessThan(3_100);
    expect(long?.endsWith('[…]')).toBe(true);
  });
});
