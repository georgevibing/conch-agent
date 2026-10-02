import { describe, expect, it } from 'vitest';

import { appsModel, canUseApps, modelOf } from './apps';
import { ReleaseTurnBody } from './index';

const model = (id: string, label: string, tools?: boolean) => ({
  id,
  label,
  description: '',
  efforts: [],
  supportsFastMode: false,
  supportsAutoMode: false,
  ...(tools !== undefined && { tools }),
});
const host = { host: true, files: true, shell: true, approvals: true };

describe('models that can’t use apps', () => {
  it('reads the model a chat answers with', () => {
    const provider = { models: [model('default', 'Default'), model('lite', 'Lite', false)] };
    expect(modelOf(provider, 'lite')?.id).toBe('lite');
    expect(modelOf(provider, undefined)?.id).toBe('default');
    expect(modelOf(provider, 'default')?.id).toBe('default');
    expect(modelOf({ models: [model('a', 'A')] }, undefined)?.id).toBe('a');
    expect(modelOf(provider, 'gone')).toBeUndefined();
  });

  it('counts a chat-only model, or a provider without tools, as unable', () => {
    expect(canUseApps({ tools: host }, model('a', 'A', false))).toBe(false);
    expect(canUseApps({ tools: { ...host, host: false } }, model('a', 'A'))).toBe(false);
    expect(canUseApps({ tools: host }, model('a', 'A', true))).toBe(true);
    // Unknown is able: a false “can’t” would stop a chat that works.
    expect(canUseApps({}, model('a', 'A'))).toBe(true);
    expect(canUseApps({}, undefined)).toBe(true);
  });

  it('switches within the same provider first, to a named model', () => {
    const providers = [
      {
        engine: 'openrouter' as const,
        label: 'OpenRouter',
        tools: host,
        models: [model('tiny', 'Tiny', false), model('big', 'Big (recommended)', true)],
      },
      {
        engine: 'claude-code' as const,
        label: 'Claude Code',
        tools: host,
        models: [model('default', 'Default'), model('opus', 'Opus')],
      },
    ];
    expect(appsModel(providers, { engine: 'openrouter', model: 'tiny' })).toEqual({
      engine: 'openrouter',
      model: 'big',
      label: 'Big',
      provider: 'OpenRouter',
    });
  });

  it('then the default provider (its default model), never one that isn’t set up', () => {
    const ollama = {
      engine: 'ollama' as const,
      label: 'This computer',
      tools: host,
      models: [model('gemma', 'Gemma', false)],
    };
    const anthropic = {
      engine: 'anthropic-api' as const,
      label: 'Anthropic',
      tools: host,
      models: [model('haiku', 'Haiku', true)],
    };
    const claude = {
      engine: 'claude-code' as const,
      label: 'Claude Code',
      tools: host,
      models: [model('default', 'Default'), model('opus', 'Opus'), model('sonnet', 'Sonnet')],
    };
    const providers = [ollama, anthropic, claude];
    expect(
      appsModel(
        providers,
        { engine: 'ollama', model: 'gemma' },
        { engine: 'claude-code', model: 'sonnet' },
      ),
    ).toMatchObject({ engine: 'claude-code', model: 'sonnet' });
    // Without a default that can, the next one listed.
    expect(appsModel(providers, { engine: 'ollama', model: 'gemma' })).toMatchObject({
      engine: 'anthropic-api',
      model: 'haiku',
    });
    // A provider that couldn't list its models, or has no tools, isn't a choice.
    expect(
      appsModel(
        [
          ollama,
          { ...anthropic, message: 'Couldn’t list its models.' },
          { ...claude, tools: { ...host, host: false } },
        ],
        { engine: 'ollama', model: 'gemma' },
      ),
    ).toBeUndefined();
  });

  it('only switches a waiting message to a model with its provider', () => {
    expect(ReleaseTurnBody.safeParse({ engine: 'mock', model: 'opus' }).success).toBe(true);
    expect(ReleaseTurnBody.safeParse({ model: 'opus' }).success).toBe(false);
    expect(ReleaseTurnBody.safeParse({ engine: 'mock', model: 'x'.repeat(201) }).success).toBe(
      false,
    );
  });
});
