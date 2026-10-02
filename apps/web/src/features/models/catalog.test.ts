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
