import type { ModelCatalog } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { biggerWindow } from './bigger';

const model = (id: string, context?: number, tools?: boolean) => ({
  id,
  label: id,
  description: '',
  efforts: [],
  supportsFastMode: false,
  supportsAutoMode: false,
  ...(context && { context }),
  ...(tools !== undefined && { tools }),
});

const catalog = {
  providers: [
    {
      engine: 'ollama',
      label: 'On this computer',
      models: [model('llama3.2', 16_384), model('qwen3:4b', 32_768)],
    },
    {
      engine: 'openrouter',
      label: 'OpenRouter',
      models: [model('google/gemini-2.5-flash', 1_048_576), model('chat-only', 2_000_000, false)],
    },
    {
      engine: 'anthropic-api',
      label: 'Anthropic API',
      message: 'Add your key',
      models: [model('claude', 4_000_000)],
    },
  ],
} as unknown as ModelCatalog;

describe('a model that reads more at once (ADR 0055)', () => {
  it('is the ready one with the biggest window that can use the apps', () => {
    expect(biggerWindow(catalog, 'ollama', 'llama3.2')).toMatchObject({
      engine: 'openrouter',
      model: { id: 'google/gemini-2.5-flash' },
    });
  });

  it('must read clearly more than the one that was too small', () => {
    const local = {
      providers: [catalog.providers[0]],
    } as unknown as ModelCatalog;
    expect(biggerWindow(local, 'ollama', 'llama3.2')).toMatchObject({
      model: { id: 'qwen3:4b' },
    });
    expect(biggerWindow(local, 'ollama', 'qwen3:4b')).toBeUndefined();
  });

  it('is nothing without a catalog', () => {
    expect(biggerWindow(undefined, 'ollama', 'x')).toBeUndefined();
  });
});
