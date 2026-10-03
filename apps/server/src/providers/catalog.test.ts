import { recogniseKey } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { PROVIDER_COPY } from './catalog';

const providers = [...PROVIDER_COPY].map(([id, copy]) => ({ id, keyForm: copy.keyForm }));
const whose = (key: string) => recogniseKey(key, providers);

describe('knowing a pasted key', () => {
  it('connects straight away only on a prefix one company uses', () => {
    expect(whose('gsk_0123456789abcdefghijklmn')).toEqual({ ids: ['groq'], sure: true });
    expect(whose(`xai-${'a'.repeat(80)}`)).toEqual({ ids: ['xai'], sure: true });
    expect(whose('sk-ant-api03-abcdefghijklmnopqrstuv')).toEqual({
      ids: ['anthropic-api'],
      sure: true,
    });
    expect(whose(`sk-or-v1-${'a'.repeat(64)}`)).toEqual({ ids: ['openrouter'], sure: true });
    expect(whose('sk-proj-abcdefghijklmnopqrstuvwx')).toEqual({ ids: ['openai'], sure: true });
    expect(whose('csk-abcdefghijklmnopqrstuvwx')).toEqual({ ids: ['cerebras'], sure: true });
    expect(whose('sk-wsabcdefghijklmnopqrstuvwxyz0123')).toEqual({ ids: ['qwen'], sure: true });
    expect(whose(`AIza${'a'.repeat(35)}`)).toEqual({ ids: ['gemini'], sure: true });
  });

  it('asks whose a shared shape is, rather than try it at each company', () => {
    const hex = `sk-${'0123456789abcdef'.repeat(2)}`;
    expect(whose(hex)).toEqual({
      ids: expect.arrayContaining(['openai', 'deepseek', 'qwen']),
      sure: false,
    });
  });

  it('asks first when only one company’s shape fits but nothing says it’s theirs', () => {
    // Mistral and Z.ai keys have no documented prefix: a lookalike could be anyone's.
    expect(whose('abcdefghijklmnopqrstuvwxyz012345')).toEqual({ ids: ['mistral'], sure: false });
    expect(whose('0123456789abcdef0123456789abcdef.ABCDEFGHijklmnop')).toEqual({
      ids: ['zai'],
      sure: false,
    });
  });

  it('every pattern is a regular expression that compiles', () => {
    for (const { keyForm } of providers)
      for (const pattern of Object.values(keyForm?.recognise ?? {}))
        expect(() => new RegExp(pattern as string)).not.toThrow();
  });
});
