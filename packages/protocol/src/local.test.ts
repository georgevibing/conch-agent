import { describe, expect, it } from 'vitest';

import { LocalModelName, LocalPullBody } from './local';

describe('LocalModelName', () => {
  it.each([
    'llama3.2:3b',
    'qwen3:8b',
    'gpt-oss:20b',
    'llama3.2',
    'library/llama3.2:latest',
    'hf.co/bartowski/Llama-3.2-3B-Instruct-GGUF:Q4_K_M',
    'qwen3:4b-instruct-2507-q4_K_M',
  ])('accepts %s', (name) => {
    expect(LocalModelName.safeParse(name).success).toBe(true);
  });

  it.each([
    '',
    '../../etc/passwd',
    'llama3.2/../../x',
    './llama',
    '/llama3.2',
    'llama3.2:3b/../x',
    'C:\\models\\llama',
    'llama\\3',
    'llama 3.2',
    'llama3.2:3b?x=1',
    'llama%2e%2e',
    'a/b/c/d:tag',
    'llama3.2::3b',
    '-rf',
    'llama3.2:\n3b',
  ])('refuses %j', (name) => {
    expect(LocalModelName.safeParse(name).success).toBe(false);
  });

  it('checks the body of a pull', () => {
    expect(LocalPullBody.safeParse({ model: 'llama3.2:3b' }).success).toBe(true);
    expect(LocalPullBody.safeParse({ model: '../x' }).success).toBe(false);
    expect(LocalPullBody.safeParse({}).success).toBe(false);
  });
});
