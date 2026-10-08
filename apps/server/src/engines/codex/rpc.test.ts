import { describe, expect, it } from 'vitest';

import { lastWords } from './rpc';

describe('what a Codex process said on its way out', () => {
  it('keeps the last line, without the Error prefix', () => {
    expect(lastWords('warming up\nError: invalid type in `permissions`\n')).toBe(
      'invalid type in `permissions`',
    );
  });

  it('blanks anything that looks like a credential', () => {
    const said = lastWords('failed: Bearer abc123secret and sk-abcdefghijklmnop');
    expect(said).not.toContain('abc123secret');
    expect(said).not.toContain('abcdefghijklmnop');
  });

  it('drops sign-in links, device codes, emails and home folders', () => {
    const said = lastWords(
      'open https://example.com/device?user_code=ABCD-1234 as me@example.com, code ABCD-1234 in /home/yiotis/.conch',
    );
    expect(said).not.toMatch(/example.com|ABCD-1234|yiotis/);
    expect(said).toContain('<address>');
  });

  it('says nothing when there was nothing', () => {
    expect(lastWords('')).toBe('');
  });
});
