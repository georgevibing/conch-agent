import { describe, expect, it } from 'vitest';

import { collapseStalePages, staleNote } from './pages';

const whole = (title: string, body = 'x'.repeat(2_000)) =>
  `Page: ${title}\nAddress: https://shop.example/${title}\n<page-content>\n(warning)\n${body}\n</page-content>`;
const changes = (title: string) =>
  `Page: ${title}\nAddress: https://shop.example/${title}\n<page-changes>\n(warning)\n+ - button "Buy" [ref=e9]\n</page-changes>`;

describe('stale pages go first (ADR 0077)', () => {
  it('keeps the newest whole view and the changes after it, in OpenAI’s shape', () => {
    const messages = [
      { role: 'user', content: 'Find me a mug' },
      { role: 'tool', tool_call_id: 'a', content: `(Declined cookies.)\n${whole('home')}` },
      { role: 'tool', tool_call_id: 'b', content: changes('home') },
      { role: 'tool', tool_call_id: 'c', content: whole('mugs') },
      { role: 'tool', tool_call_id: 'd', content: changes('mugs') },
      { role: 'tool', tool_call_id: 'e', content: 'Saved to memory.' },
    ];
    const { messages: out, collapsed } = collapseStalePages(messages);
    expect(collapsed).toBe(2);
    expect(out[1]?.content).toBe(
      '(Declined cookies.)\n[An earlier view of the page “home” (https://shop.example/home), left out to save room: the page has changed since. browser_read shows it as it is now.]',
    );
    expect(String(out[2]?.content)).toMatch(/^\[An earlier view/);
    expect(out[3]).toBe(messages[3]);
    expect(out[4]).toBe(messages[4]);
    expect(out[5]).toBe(messages[5]);
    // The model's own messages and the person's words are never touched.
    expect(out[0]).toBe(messages[0]);
  });

  it('works inside Anthropic’s tool_result blocks', () => {
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'a', content: whole('one') },
          { type: 'tool_result', tool_use_id: 'b', content: 'ok' },
        ],
      },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'c', name: 'browser_click', input: {} }],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c', content: whole('two') }] },
    ];
    const { messages: out, collapsed } = collapseStalePages(messages);
    expect(collapsed).toBe(1);
    const blocks = out[0]?.content as { content: string }[];
    expect(blocks[0]?.content).toMatch(/^\[An earlier view of the page “one”/);
    expect(blocks[1]?.content).toBe('ok');
    expect(out[2]).toBe(messages[2]);
  });

  it('does nothing with one page, or none', () => {
    expect(collapseStalePages([{ role: 'tool', content: whole('only') }]).collapsed).toBe(0);
    expect(collapseStalePages([{ role: 'user', content: 'hi' }]).collapsed).toBe(0);
  });

  it('says where a page was even without a title', () => {
    expect(
      staleNote('Page: \nAddress: https://a.example\n<page-content>\n</page-content>'),
    ).toContain('(https://a.example)');
  });
});
