import { describe, expect, it } from 'vitest';

import { modelLabel, pickerProviders } from './catalog';

describe('modelLabel', () => {
  it('moves an engine’s “(recommended)” into a badge', () => {
    expect(modelLabel('Default (recommended)')).toEqual({
      label: 'Default',
      badge: 'Recommended',
    });
    expect(modelLabel('Sonnet (Recommended) ')).toEqual({
      label: 'Sonnet',
      badge: 'Recommended',
    });
  });

  it('leaves other names alone, including other parentheses', () => {
    expect(modelLabel('Opus 5.5')).toEqual({ label: 'Opus 5.5' });
    expect(modelLabel('Opus 5.5 (1M context)')).toEqual({ label: 'Opus 5.5 (1M context)' });
  });
});

describe('pickerProviders', () => {
  const model = (id: string, tools?: boolean) => ({
    id,
    label: id,
    description: '',
    efforts: [],
    supportsFastMode: false,
    supportsAutoMode: false,
    ...(tools !== undefined && { tools }),
  });
  it('lists Codex once when Codex CLI is connected too, unless a chat is on it', () => {
    const both = ['codex-cli', 'codex-agent'].map((engine) => ({
      engine: engine as 'codex-cli',
      label: engine,
      local: false,
      models: [model('gpt')],
      commands: [],
      permissionModes: ['default' as const],
    }));
    const key = (e: string, m: string) => `${e}|${m}`;
    expect(pickerProviders(both, 'codex-cli', key).map((p) => p.id)).toEqual(['codex-cli']);
    expect(pickerProviders(both, 'codex-cli', key, 'codex-agent').map((p) => p.id)).toEqual([
      'codex-cli',
      'codex-agent',
    ]);
  });
  it('marks a model that can only chat (ADR 0050)', () => {
    const [provider] = pickerProviders(
      [
        {
          engine: 'openrouter',
          label: 'OpenRouter',
          local: false,
          models: [model('able', true), model('lite', false), model('unknown')],
          commands: [],
          permissionModes: ['default'],
        },
      ],
      'openrouter',
      (engine, id) => `${engine}|${id}`,
    );
    expect(provider?.models.map((m) => [m.id, m.chatOnly ?? false])).toEqual([
      ['openrouter|able', false],
      ['openrouter|lite', true],
      ['openrouter|unknown', false],
    ]);
  });
});
