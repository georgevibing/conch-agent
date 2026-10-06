import { describe, expect, it } from 'vitest';

import {
  CHAT_COMMANDS,
  COMMANDS,
  expandCustom,
  findCommand,
  parseChatCommand,
  parseEffortArg,
  parseGoalArg,
  parseSwitch,
  similarCommands,
} from './commands';

describe('parseChatCommand', () => {
  it('reads a command and what follows it, as a chat app sends it', () => {
    expect(parseChatCommand('/model opus')).toEqual({ name: 'model', args: 'opus' });
    expect(parseChatCommand('  /Goal  Ship it\nby Friday ')).toEqual({
      name: 'goal',
      args: 'Ship it\nby Friday',
    });
    // Telegram adds the bot's name in a group.
    expect(parseChatCommand('/new@my_conch_bot')).toEqual({ name: 'new', args: '' });
    expect(parseChatCommand('/weekly-review for Tuesday')).toEqual({
      name: 'weekly-review',
      args: 'for Tuesday',
    });
  });

  it('never takes a path, a lone slash or words for a command', () => {
    expect(parseChatCommand('/Users/ada/notes.txt what is this?')).toBeUndefined();
    expect(parseChatCommand('/')).toBeUndefined();
    expect(parseChatCommand('see /model')).toBeUndefined();
  });
});

describe('similarCommands', () => {
  const names = ['model', 'mode', 'clear', 'compact', 'effort', 'help'];

  it('finds a slip of a letter or two, and the start of a name', () => {
    expect(similarCommands('claer', names)).toEqual(['clear']);
    expect(similarCommands('efort', names)).toEqual(['effort']);
    expect(similarCommands('comp', names)).toEqual(['compact']);
    expect(similarCommands('hepl', names)).toEqual(['help']);
  });

  it('suggests nothing for a word nowhere near', () => {
    expect(similarCommands('xyzzy', names)).toEqual([]);
    expect(similarCommands('', names)).toEqual([]);
  });

  it('suggests the command an other name stands for', () => {
    expect(similarCommands('rset', new Map([['reset', 'clear']]))).toEqual(['clear']);
  });
});

describe('the list', () => {
  it('answers to other names in both places', () => {
    expect(findCommand('reset')?.name).toBe('clear');
    expect(findCommand('think', 'chat')?.name).toBe('effort');
    expect(findCommand('cancel')).toBeUndefined();
    expect(findCommand('cancel', 'chat')?.name).toBe('cancel');
  });

  it('says how every chat app command is used, and who may use it', () => {
    expect(CHAT_COMMANDS.length).toBeGreaterThan(10);
    for (const c of CHAT_COMMANDS) expect(['owner', 'people']).toContain(c.chat.who);
    // What changes how Conch works is the owner's.
    for (const name of ['model', 'effort', 'fast', 'mode', 'goal', 'plan', 'settings'])
      expect(findCommand(name, 'chat')?.chat?.who, name).toBe('owner');
    expect(COMMANDS.filter((c) => c.chat?.groups).map((c) => c.name)).toEqual([
      'new',
      'stop',
      'help',
      'start',
    ]);
  });
});

describe('values', () => {
  it('reads effort, switches, goals and your own commands the same everywhere', () => {
    expect(parseEffortArg('Extra')).toBe('xhigh');
    expect(parseEffortArg('maximum')).toBe('max');
    expect(parseEffortArg('loud')).toBeUndefined();
    expect(parseSwitch('')).toBe('toggle');
    expect(parseSwitch('Enable')).toBe('on');
    expect(parseSwitch('done')).toBe('off');
    expect(parseSwitch('sideways')).toBeUndefined();
    expect(parseGoalArg('clear')).toEqual({ kind: 'clear' });
    expect(parseGoalArg(' ship it ')).toEqual({ kind: 'set', goal: 'ship it' });
    expect(expandCustom({ prompt: 'Explain {{input}} simply.' }, '')).toBe('Explain this simply.');
    expect(expandCustom({ prompt: 'Summarise.' }, 'the PR')).toBe('Summarise.\n\nthe PR');
  });
});
