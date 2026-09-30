import { describe, expect, it } from 'vitest';

import { fit, plain, split, toDiscordMarkdown, toSlackMrkdwn, toTelegramHtml } from './format';

describe('toTelegramHtml', () => {
  it('turns the common Markdown into Telegram HTML', () => {
    expect(toTelegramHtml('# Plan\n**Bold** and *italic* and `x < y` and ~~old~~')).toBe(
      '<b>Plan</b>\n<b>Bold</b> and <i>italic</i> and <code>x &lt; y</code> and <s>old</s>',
    );
  });

  it('escapes what would otherwise be read as tags', () => {
    expect(toTelegramHtml('a <b> & c')).toBe('a &lt;b&gt; &amp; c');
  });

  it('keeps links whole and escapes their labels', () => {
    expect(toTelegramHtml('See [the <docs>](https://example.com/a?b=1&c=2).')).toBe(
      'See <a href="https://example.com/a?b=1&amp;c=2">the &lt;docs&gt;</a>.',
    );
  });

  it('writes code blocks with their language and leaves their contents alone', () => {
    expect(toTelegramHtml('Run:\n```ts\nconst a = b && **c**;\n```')).toBe(
      'Run:\n<pre><code class="language-ts">const a = b &amp;&amp; **c**;</code></pre>',
    );
  });

  it('keeps an unclosed fence as code', () => {
    expect(toTelegramHtml('```\nhalf')).toBe('<pre><code>half</code></pre>');
  });

  it('does not italicise snake_case or lone asterisks', () => {
    expect(toTelegramHtml('snake_case_name and 2 * 3 * 4')).toBe('snake_case_name and 2 * 3 * 4');
  });

  it('writes lists as bullets and quotes as blockquotes', () => {
    expect(toTelegramHtml('- one\n  - two\n> said\n> this')).toBe(
      '• one\n  • two\n<blockquote>said\nthis</blockquote>',
    );
  });

  it('lines tables up as monospace', () => {
    expect(toTelegramHtml('| a | bb |\n|---|---|\n| ccc | d |')).toBe('<pre>a    bb\nccc  d</pre>');
  });
});

describe('toSlackMrkdwn', () => {
  it('uses Slack’s own markers', () => {
    expect(toSlackMrkdwn('## Hi\n**b** *i* ~~s~~ [x](https://a.b/c) <tag>')).toBe(
      '*Hi*\n*b* _i_ ~s~ <https://a.b/c|x> &lt;tag&gt;',
    );
  });

  it('drops the language from code fences', () => {
    expect(toSlackMrkdwn('```js\na()\n```')).toBe('```\na()\n```');
  });
});

describe('toDiscordMarkdown', () => {
  it('keeps Markdown but boxes tables', () => {
    expect(toDiscordMarkdown('**b**\n| a | b |\n| - | - |\n| 1 | 2 |')).toBe(
      '**b**\n```\na  b\n1  2\n```',
    );
  });
});

describe('plain', () => {
  it('takes the markup out', () => {
    expect(plain('# T\n**b** `c` [l](https://x.y)')).toBe('T\nb c l (https://x.y)');
  });
});

describe('split', () => {
  it('leaves short answers whole', () => {
    expect(split('hello', 100)).toEqual(['hello']);
    expect(split('   ', 100)).toEqual([]);
  });

  it('cuts between paragraphs first', () => {
    const a = 'a'.repeat(60);
    const b = 'b'.repeat(60);
    expect(split(`${a}\n\n${b}`, 100)).toEqual([a, b]);
  });

  it('never makes a part longer than the limit', () => {
    const text = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ');
    const parts = split(text, 120);
    expect(parts.length).toBeGreaterThan(5);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(120);
    expect(parts.join(' ')).toBe(text);
  });

  it('closes and reopens a code block that has to be cut', () => {
    const code = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
    const parts = split(`Here:\n\`\`\`py\n${code}\n\`\`\``, 150);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(150);
      expect((part.match(/```/g) ?? []).length % 2).toBe(0);
    }
    expect(parts[1]?.startsWith('```py\n')).toBe(true);
  });

  it('cuts a single enormous word', () => {
    const parts = split('x'.repeat(250), 100);
    expect(parts.every((p) => p.length <= 100)).toBe(true);
    expect(parts.join('')).toBe('x'.repeat(250));
  });
});

describe('fit', () => {
  it('cuts again when formatting makes a part too long (a padded table)', () => {
    const rows = Array.from(
      { length: 40 },
      (_, i) => `| ${i === 3 ? 'x'.repeat(200) : `row ${i}`} | ok |`,
    );
    const table = ['| name | value |', '| --- | --- |', ...rows].join('\n');
    expect(table.length).toBeLessThan(2000);
    const measure = (part: string) => toDiscordMarkdown(part).length;
    expect(measure(table)).toBeGreaterThan(2000);
    const parts = fit(table, 1900, measure);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(measure(part)).toBeLessThanOrEqual(1900);
  });
});
