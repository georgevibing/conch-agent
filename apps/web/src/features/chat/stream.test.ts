import { describe, expect, it } from 'vitest';

import { closeOpenMarkdown, splitBlocks, verbsFor } from './stream';

describe('splitBlocks', () => {
  it('splits at blank lines and keeps offsets', () => {
    const text = 'One.\n\nTwo **b**.\n\n- a\n- b';
    const blocks = splitBlocks(text);
    expect(blocks.map((b) => b.text)).toEqual(['One.\n\n', 'Two **b**.\n\n', '- a\n- b']);
    expect(blocks.map((b) => b.start)).toEqual([0, 6, 18]);
    expect(blocks.map((b) => b.text).join('')).toBe(text);
  });

  it('never splits inside a code fence or before an indented continuation', () => {
    const text = '```ts\na\n\nb\n```\n\n- item\n\n  more';
    expect(splitBlocks(text).map((b) => b.text)).toEqual([
      '```ts\na\n\nb\n```\n\n',
      '- item\n\n  more',
    ]);
  });
});

describe('closeOpenMarkdown', () => {
  it('closes an open fence, bold and inline code', () => {
    expect(closeOpenMarkdown('Look:\n```ts\nconst a')).toBe('Look:\n```ts\nconst a\n```');
    expect(closeOpenMarkdown('This is **very ')).toBe('This is **very**');
    expect(closeOpenMarkdown('Run `npm')).toBe('Run `npm`');
  });

  it('closes an open italic and strikethrough, innermost first', () => {
    expect(closeOpenMarkdown('It runs *fast')).toBe('It runs *fast*');
    expect(closeOpenMarkdown('It runs ~~slow')).toBe('It runs ~~slow~~');
    expect(closeOpenMarkdown('**bold and *both')).toBe('**bold and *both***');
    expect(closeOpenMarkdown('*mock · auto effort')).toBe('*mock · auto effort*');
  });

  it('never takes a list bullet or a sum for an italic', () => {
    expect(closeOpenMarkdown('* one\n* two')).toBe('* one\n* two');
    expect(closeOpenMarkdown('So 2 * 3 is six')).toBe('So 2 * 3 is six');
    expect(closeOpenMarkdown('*done* and more')).toBe('*done* and more');
  });

  it('leaves balanced text alone', () => {
    const text = '**done** and `code`\n\n```\nx\n```\n';
    expect(closeOpenMarkdown(text)).toBe(text);
  });
});

describe('verbsFor', () => {
  it('opens by listening and follows the request', () => {
    expect(verbsFor('Why does my build fail?', 'starting').slice(0, 2)).toEqual([
      'Listening',
      'Tracing the problem',
    ]);
    expect(verbsFor('Draft an email to Sam', 'starting')).toContain('Finding the words');
    expect(verbsFor('hello', 'starting')).toContain('Thinking it through');
  });

  it('admits a long think and reads results after tools', () => {
    const verbs = verbsFor('hello', 'starting');
    expect(verbs.at(-1)).toBe('Still with you');
    expect(verbsFor('hello', 'after-tool')).toContain('Reading the results');
  });
});
