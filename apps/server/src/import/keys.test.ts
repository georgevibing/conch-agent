import { describe, expect, it } from 'vitest';

import { PROVIDER_COPY } from '../providers/catalog';
import { KEY_SOURCES, keysInEnv } from './found';

describe('provider keys another app kept (ADR 0042, ADR 0053)', () => {
  it('finds one key per provider, under any of the names apps use for it', () => {
    expect(
      keysInEnv(
        {
          ANTHROPIC_API_KEY: 'sk-ant-1',
          GOOGLE_API_KEY: 'AIza-google',
          GEMINI_API_KEY: 'AIza-gemini',
          KIMI_API_KEY: 'sk-kimi',
          DASHSCOPE_API_KEY: ' sk-ws-qwen ',
          EMPTY: '',
          MISTRAL_API_KEY: '',
        },
        'Hermes',
      ),
    ).toEqual([
      { provider: 'anthropic-api', value: 'sk-ant-1', from: 'Hermes' },
      // The first name that holds one wins.
      { provider: 'gemini', value: 'AIza-gemini', from: 'Hermes' },
      { provider: 'moonshot', value: 'sk-kimi', from: 'Hermes' },
      { provider: 'qwen', value: 'sk-ws-qwen', from: 'Hermes' },
    ]);
  });

  it('only brings keys for providers that take one, and looks where Conch itself looks', () => {
    for (const source of KEY_SOURCES) {
      const copy = PROVIDER_COPY.get(source.provider);
      expect(copy?.keyForm, source.provider).toBeDefined();
      // Every variable Conch offers from this computer's own environment, an app's .env is read for too.
      for (const variable of copy?.envKeys ?? []) expect(source.env).toContain(variable);
    }
  });

  it('never brings a coding plan’s key, whose terms keep it to the tools they list', () => {
    const names = KEY_SOURCES.flatMap((s) => s.names);
    expect(names).not.toContain('kimi-coding');
    expect(names).not.toContain('zai-coding');
  });
});
