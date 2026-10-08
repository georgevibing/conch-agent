import { describe, expect, it } from 'vitest';

import { LineTooLong, Lines, lastWords } from './rpc';

describe('reading Codex’s messages line by line', () => {
  it('joins a line split across chunks, even inside a character', () => {
    const lines = new Lines(100);
    const bytes = Buffer.from('{"a":"é"}\n{"b":1}\n');
    const at = bytes.indexOf(0xc3) + 1; // between the two bytes of é
    expect(lines.push(bytes.subarray(0, at))).toEqual([]);
    expect(lines.push(bytes.subarray(at))).toEqual(['{"a":"é"}', '{"b":1}']);
  });

  it('reads a multi-megabyte picture item when the connection allows it', () => {
    const result = Buffer.alloc(6_000_000, 7).toString('base64');
    const line = `${JSON.stringify({ method: 'item/completed', params: { item: { type: 'imageGeneration', result } } })}\n`;
    const bytes = Buffer.from(line);
    const lines = new Lines(50_000_000);
    const got: string[] = [];
    for (let at = 0; at < bytes.length; at += 65_536)
      got.push(...lines.push(bytes.subarray(at, at + 65_536)));
    expect(got).toHaveLength(1);
    const item = (JSON.parse(got[0] ?? '') as { params: { item: { result: string } } }).params.item;
    expect(Buffer.from(item.result, 'base64').length).toBe(6_000_000);
  });

  it('stops at its limit, however the line was split', () => {
    const lines = new Lines(1_000);
    expect(lines.push(Buffer.alloc(600, 0x61))).toEqual([]);
    expect(() => lines.push(Buffer.alloc(600, 0x61))).toThrow(LineTooLong);
    expect(() => new Lines(10).push(Buffer.from('0123456789ab\n'))).toThrow(LineTooLong);
    // A line exactly at the limit is fine.
    expect(new Lines(10).push(Buffer.from('0123456789\n'))).toEqual(['0123456789']);
  });
});

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
