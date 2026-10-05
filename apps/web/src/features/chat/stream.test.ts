import { describe, expect, it } from 'vitest';

import { closeOpenMarkdown, splitBlocks } from './stream';
import { ALL_VERBS, familyOf, verbsFor } from './verbs';

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
    expect(verbsFor('hello', 'starting').length).toBeGreaterThan(8);
  });

  it('admits a long think, and talks about what just ran after a tool', () => {
    expect(verbsFor('hello', 'starting').slice(-3).join(' ')).toMatch(
      /still|deeper|right|careful|thorough|time|solid|persisting|twice|corners|mile|harder|haul|properly/i,
    );
    expect(verbsFor('fix the tests', 'after-tool', { tool: 'shell' }).join(' ')).toMatch(
      /output|log|print|exit|ran|run|passed|lines|trace|warn|error|verdict|left|command|numbers|changed|bit|worked|said|tail/i,
    );
    expect(familyOf('Bash')).toBe('shell');
    expect(familyOf('mcp__conch__browser_click')).toBe('browser');
    expect(familyOf('mcp__conch__remember')).toBe('memory');
    expect(familyOf('mcp__notion__create_page')).toBe('apps');
  });

  it('has hundreds of words, and every wait gets its own order', () => {
    expect(ALL_VERBS.size).toBeGreaterThan(300);
    const firsts = new Set(
      Array.from({ length: 20 }, (_, i) => verbsFor('x', 'after-tool', { seed: `step ${i}` })[0]),
    );
    expect(firsts.size).toBeGreaterThan(8);
    // The same wait keeps its words while it lasts.
    expect(verbsFor('x', 'after-tool', { seed: 'a' })).toEqual(
      verbsFor('x', 'after-tool', { seed: 'a' }),
    );
  });
});
