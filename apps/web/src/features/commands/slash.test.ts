import { describe, expect, it } from 'vitest';

import { expandCustom, parseEffortArg, parseSlash, resolveSlash, slashQuery } from './slash';

const custom = [
  {
    name: 'explain',
    description: '',
    prompt: 'Explain {{input}} simply.',
    createdAt: 0,
    updatedAt: 0,
  },
];
const engine = [{ name: 'compact', description: 'Summarise', argumentHint: '' }];

describe('slash commands', () => {
  it('parses names and arguments', () => {
    expect(parseSlash('/model opus')).toEqual({ name: 'model', args: 'opus' });
    expect(parseSlash('/Remember I like tea\nand cake')).toEqual({
      name: 'remember',
      args: 'I like tea\nand cake',
    });
    expect(parseSlash('not a command')).toBeUndefined();
    expect(parseSlash('/usr/bin is a path')).toBeUndefined();
  });

  it('only opens the menu while typing the command name', () => {
    expect(slashQuery('/')).toBe('');
    expect(slashQuery('/mo')).toBe('mo');
    expect(slashQuery('/model opus')).toBeNull();
    expect(slashQuery('hello /x')).toBeNull();
  });

  it('resolves builtins (incl. aliases), then custom, then engine commands', () => {
    expect(resolveSlash('/think high', custom, engine)).toMatchObject({
      kind: 'builtin',
      builtin: { action: 'effort' },
      args: 'high',
    });
    expect(resolveSlash('/explain monads', custom, engine)).toMatchObject({ kind: 'custom' });
    expect(resolveSlash('/compact', custom, engine)).toMatchObject({ kind: 'engine' });
    expect(resolveSlash('/nope', custom, engine)).toEqual({ kind: 'unknown', name: 'nope' });
  });

  it('expands templates', () => {
    expect(expandCustom({ prompt: 'Explain {{input}} simply.' }, 'monads')).toBe(
      'Explain monads simply.',
    );
    expect(expandCustom({ prompt: 'Summarise.' }, 'the README')).toBe('Summarise.\n\nthe README');
  });

  it('understands effort words', () => {
    expect(parseEffortArg('High')).toBe('high');
    expect(parseEffortArg('extra')).toBe('xhigh');
    expect(parseEffortArg('banana')).toBeUndefined();
  });

  it('finds your skills after your commands and before the provider’s', () => {
    const skill = {
      id: 'compact',
      name: 'compact',
      title: 'Compact',
      description: 'Squeezes things.',
      source: 'conch' as const,
      sourceLabel: 'Conch',
      editable: true,
      mode: 'auto' as const,
      path: '/x',
      files: [],
      updatedAt: 0,
    };
    expect(resolveSlash('/compact tighter', custom, engine, [skill])).toMatchObject({
      kind: 'skill',
      skill: { name: 'compact' },
      args: 'tighter',
    });
    expect(resolveSlash('/compact', custom, engine, [])).toMatchObject({ kind: 'engine' });
    expect(resolveSlash('/explain', custom, engine, [{ ...skill, name: 'explain' }])).toMatchObject(
      {
        kind: 'custom',
      },
    );
  });
});
