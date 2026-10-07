import { COMMANDS } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import {
  builtins,
  expandCustom,
  findBuiltin,
  parseEffortArg,
  parseGoalArg,
  parseSlash,
  parseSwitch,
  parseThemeArg,
  resolveSlash,
  reviewPrompt,
  slashQuery,
  slashValueQuery,
} from './slash';

const custom = [
  {
    name: 'explain',
    description: '',
    prompt: 'Explain {{input}} simply.',
    createdAt: 0,
    updatedAt: 0,
  },
];
const engine = [
  { name: 'compact', description: 'Summarise', argumentHint: '' },
  { name: 'pr-comments', description: 'Read the PR comments', argumentHint: '' },
];

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
    expect(resolveSlash('/pr-comments', custom, engine)).toMatchObject({ kind: 'engine' });
    expect(resolveSlash('/nope', custom, engine)).toEqual({ kind: 'unknown', name: 'nope' });
  });

  it('has its own /compact for every provider, which hands over to a provider that has one (ADR 0055)', () => {
    expect(resolveSlash('/compact the compost', custom, engine)).toMatchObject({
      kind: 'builtin',
      builtin: { action: 'compact' },
      args: 'the compost',
    });
    expect(resolveSlash('/summarise', custom, [])).toMatchObject({
      builtin: { action: 'compact' },
    });
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
      id: 'review',
      name: 'review',
      title: 'Review',
      description: 'Reads it over.',
      source: 'conch' as const,
      sourceLabel: 'Conch',
      editable: true,
      mode: 'auto' as const,
      path: '/x',
      files: [],
      updatedAt: 0,
    };
    expect(resolveSlash('/review tighter', custom, engine, [skill])).toMatchObject({
      kind: 'skill',
      skill: { name: 'review' },
      args: 'tighter',
    });
    // Without the skill, Conch's own /review (which hands over to the provider's, if it has one).
    expect(resolveSlash('/review', custom, engine, [])).toMatchObject({
      kind: 'builtin',
      builtin: { action: 'review' },
    });
    expect(resolveSlash('/explain', custom, engine, [{ ...skill, name: 'explain' }])).toMatchObject(
      {
        kind: 'custom',
      },
    );
  });
});

describe('the commands people expect', () => {
  it('has the commands other agents have, each with words for the reference', () => {
    for (const name of [
      'help',
      'clear',
      'new',
      'compact',
      'model',
      'effort',
      'plan',
      'goal',
      'resume',
      'rename',
      'export',
      'copy',
      'undo',
      'retry',
      'usage',
      'status',
      'memory',
      'init',
      'review',
      'settings',
      'theme',
      'mode',
      'apps',
      'providers',
      'doctor',
      'task',
      'background',
      'folder',
    ])
      expect(findBuiltin(name), name).toBeDefined();
    for (const b of builtins) {
      expect(b.description.length, b.name).toBeGreaterThan(8);
      // The reference adds the full stop.
      expect(b.description.endsWith('.'), b.name).toBe(false);
    }
  });

  it('answers to the names other agents use', () => {
    expect(findBuiltin('reset')?.action).toBe('clear');
    expect(findBuiltin('rewind')?.action).toBe('undo');
    expect(findBuiltin('cost')?.action).toBe('usage');
    expect(findBuiltin('mcp')?.action).toBe('apps');
    expect(findBuiltin('login')?.action).toBe('providers');
    expect(findBuiltin('compress')?.action).toBe('compact');
    expect(findBuiltin('config')?.action).toBe('settings');
    expect(findBuiltin('cwd')?.action).toBe('folder');
  });

  it('keeps /clear apart from /new now that it clears the chat', () => {
    expect(resolveSlash('/clear', custom, engine)).toMatchObject({ builtin: { action: 'clear' } });
    expect(resolveSlash('/new', custom, engine)).toMatchObject({ builtin: { action: 'new' } });
  });

  it('is the same list chat apps use, without the ones only chat apps have', () => {
    expect(builtins.map((b) => b.name)).toEqual(
      COMMANDS.filter((c) => c.web !== false).map((c) => c.name),
    );
    for (const name of ['stop', 'start', 'cancel']) expect(findBuiltin(name), name).toBeUndefined();
    for (const b of builtins) expect(b.action).toBe(b.name);
  });

  it('never gives two commands the same name', () => {
    const names = builtins.flatMap((b) => [b.name, ...(b.aliases ?? [])]);
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives its newer commands up to yours of the same name, never its older ones', () => {
    const mine = [
      { name: 'export', description: '', prompt: 'Export it', createdAt: 0, updatedAt: 0 },
    ];
    expect(resolveSlash('/export', mine, [])).toMatchObject({ kind: 'custom' });
    expect(resolveSlash('/export', [], [])).toMatchObject({ kind: 'builtin' });
    const model = [{ ...mine[0], name: 'model' }] as typeof mine;
    expect(resolveSlash('/model', model, [])).toMatchObject({ kind: 'builtin' });
  });

  it('wins over a provider’s command of the same name', () => {
    const theirs = [{ name: 'clear', description: 'Clear', argumentHint: '' }];
    expect(resolveSlash('/clear', [], theirs)).toMatchObject({ kind: 'builtin' });
  });
});

describe('values after a command', () => {
  it('reads the command and the value typed so far, on one line', () => {
    expect(slashValueQuery('/effort ')).toEqual({ name: 'effort', value: '' });
    expect(slashValueQuery('/model gpt 5')).toEqual({ name: 'model', value: 'gpt 5' });
    expect(slashValueQuery('/Think hi')).toEqual({ name: 'think', value: 'hi' });
    expect(slashValueQuery('/goal ship it\nand more')).toBeNull();
    expect(slashValueQuery('/effort')).toBeNull();
    expect(slashValueQuery('hello /effort high')).toBeNull();
  });

  it('marks which commands go on to values, and which only suggest', () => {
    expect(findBuiltin('effort')?.values).toBe('choose');
    expect(findBuiltin('model')?.values).toBe('choose');
    expect(findBuiltin('goal')?.values).toBe('suggest');
    expect(findBuiltin('plan')?.values).toBe('suggest');
    expect(findBuiltin('clear')?.values).toBeUndefined();
  });
});

describe('arguments', () => {
  it('understands on, off and a toggle', () => {
    expect(parseSwitch('')).toBe('toggle');
    expect(parseSwitch('ON')).toBe('on');
    expect(parseSwitch('off')).toBe('off');
    expect(parseSwitch('refactor the parser')).toBeUndefined();
  });

  it('shows, clears or sets a goal', () => {
    expect(parseGoalArg('')).toEqual({ kind: 'show' });
    expect(parseGoalArg('clear')).toEqual({ kind: 'clear' });
    expect(parseGoalArg(' Ship the release notes ')).toEqual({
      kind: 'set',
      goal: 'Ship the release notes',
    });
    // A goal that only starts with a word like clear is still a goal.
    expect(parseGoalArg('clear out the garage')).toMatchObject({ kind: 'set' });
  });

  it('picks a theme, or toggles', () => {
    expect(parseThemeArg('dark')).toBe('dark');
    expect(parseThemeArg('auto')).toBe('system');
    expect(parseThemeArg('')).toBe('toggle');
  });

  it('writes a review any provider can do, with what to look at', () => {
    expect(reviewPrompt('')).toContain('Don’t change any files');
    expect(reviewPrompt('the parser')).toContain('Look especially at: the parser');
  });
});
