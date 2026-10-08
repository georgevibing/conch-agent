import { describe, expect, it } from 'vitest';

import { answeredId, JsonLines } from './json-lines';

/** Every line, fed in chunks of `size` bytes. */
function feed(lines: JsonLines, bytes: Buffer, size = 65_536) {
  const out: string[] = [];
  const skipped: { head: string; size: number }[] = [];
  for (let at = 0; at < bytes.length; at += size) {
    const got = lines.push(bytes.subarray(at, at + size));
    out.push(...got.lines);
    skipped.push(...got.skipped);
  }
  return { lines: out, skipped };
}

describe('reading one JSON message a line', () => {
  it('joins a line split across chunks, even inside a character', () => {
    const lines = new JsonLines();
    const bytes = Buffer.from('{"a":"é"}\n{"b":1}\n');
    const at = bytes.indexOf(0xc3) + 1; // between the two bytes of é
    expect(lines.push(bytes.subarray(0, at)).lines).toEqual([]);
    expect(lines.push(bytes.subarray(at)).lines).toEqual(['{"a":"é"}', '{"b":1}']);
  });

  it('sets a 20 MB photo aside and keeps the rest of the message', () => {
    const photo = `data:image/jpeg;base64,${Buffer.alloc(15_000_000, 7).toString('base64')}`;
    const message = {
      method: 'item/started',
      params: {
        item: {
          type: 'userMessage',
          content: [
            { type: 'image', url: photo },
            { type: 'text', text: 'Look "here"' },
          ],
        },
      },
    };
    const line = Buffer.from(`${JSON.stringify(message)}\n{"id":2,"result":{}}\n`);
    expect(line.length).toBeGreaterThan(20_000_000);
    const { lines, skipped } = feed(new JsonLines({ max: 1_000_000 }), line, 100_003);
    expect(skipped).toEqual([]);
    expect(lines).toHaveLength(2);
    const read = JSON.parse(lines[0] ?? '') as typeof message;
    expect(read.params.item.content).toEqual([
      { type: 'image', url: 'data:image/jpeg;base64,' },
      { type: 'text', text: 'Look "here"' },
    ]);
    expect(lines[0]?.length).toBeLessThan(200);
    expect(JSON.parse(lines[1] ?? '')).toEqual({ id: 2, result: {} });
  });

  it('keeps long words and code whole, escapes and all', () => {
    const text = `${'a line of "output"\n\\'.repeat(20_000)}`;
    const line = `${JSON.stringify({ result: { text } })}\n`;
    const { lines } = feed(new JsonLines({ long: 1000 }), Buffer.from(line), 777);
    expect((JSON.parse(lines[0] ?? '') as { result: { text: string } }).result.text).toBe(text);
  });

  it('keeps a picture whole for a connection that reads one back', () => {
    const result = Buffer.alloc(6_000_000, 7).toString('base64');
    const line = `${JSON.stringify({ method: 'item/completed', params: { item: { type: 'imageGeneration', result } } })}\n`;
    const { lines } = feed(new JsonLines({ max: 50_000_000, keepLong: true }), Buffer.from(line));
    const item = (JSON.parse(lines[0] ?? '') as { params: { item: { result: string } } }).params
      .item;
    expect(Buffer.from(item.result, 'base64').length).toBe(6_000_000);
  });

  it('skips a line still too long, says which request it answered, and reads on', () => {
    const big = `{"id":7,"result":{"text":"${'x'.repeat(5_000)}"}}\n{"id":8,"result":{}}\n`;
    const { lines, skipped } = feed(new JsonLines({ max: 1_000 }), Buffer.from(big), 333);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.size).toBe(big.indexOf('\n'));
    expect(answeredId(skipped[0]?.head ?? '')).toBe(7);
    expect(lines).toEqual(['{"id":8,"result":{}}']);
  });

  it('keeps a line exactly at its limit', () => {
    expect(new JsonLines({ max: 10 }).push(Buffer.from('0123456789\n')).lines).toEqual([
      '0123456789',
    ]);
    expect(new JsonLines({ max: 10 }).push(Buffer.from('0123456789a\n')).skipped).toHaveLength(1);
  });

  it('tells a request’s answer from a notification', () => {
    expect(answeredId('{"jsonrpc":"2.0","id":12,"result":')).toBe(12);
    expect(answeredId('{"method":"item/started","params":{"id":3')).toBeUndefined();
  });
});
