import type { ConversationEvent } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { environmentFact, signalsOf } from './signals';

type Input = ConversationEvent extends infer E
  ? E extends ConversationEvent
    ? Omit<E, 'conversationId' | 'seq' | 'at'>
    : never
  : never;

/** A chat's log from these events, in order. */
function chat(...events: Input[]): ConversationEvent[] {
  return events.map(
    (e, i) => ({ ...e, conversationId: 'c1', seq: i + 1, at: 1000 + i }) as ConversationEvent,
  );
}

const you = (text: string): Input => ({ type: 'user.message', messageId: `u${text.length}`, text });
const done = (outcome: 'success' | 'interrupted' | 'error' = 'success'): Input => ({
  type: 'turn.completed',
  outcome,
});
let tools = 0;
function command(text: string, status: 'success' | 'error', output = ''): Input[] {
  const toolUseId = `t${++tools}`;
  return [
    { type: 'tool.started', toolUseId, name: 'Bash', input: { command: text } },
    { type: 'tool.finished', toolUseId, status, output },
  ];
}

describe('what a chat says about how it went (ADR 0088 § 2)', () => {
  it.each([
    ['No, I meant TypeScript', 'correction'],
    ['Actually, make it shorter', 'correction'],
    ['I said metric units', 'correction'],
    ['Ugh, for the third time: no emoji', 'frustration'],
    ['Perfect, thanks!', 'pleased'],
  ] as const)('“%s” after a reply is %s', (text, signal) => {
    const s = signalsOf(chat(you('Write a function'), done(), you(text)));
    expect(s.signals).toEqual([signal]);
    expect(s.said.at(-1)?.signal).toBe(signal);
  });

  it('the first message corrects nothing', () => {
    expect(signalsOf(chat(you('No idea where to start'))).signals).toEqual([]);
  });

  it('the same message again is a retry; nearly the same is a rephrase', () => {
    expect(
      signalsOf(chat(you('Summarise my inbox'), done('error'), you('summarise my inbox'))).signals,
    ).toEqual(['retry']);
    expect(
      signalsOf(
        chat(you('Summarise my inbox today'), done(), you('Summarise today’s inbox for me')),
      ).signals,
    ).toEqual(['rephrase']);
  });

  it('a Stop, an Undo of files and an Undo of a memory', () => {
    const s = signalsOf(
      chat(
        you('Rename the files'),
        done('interrupted'),
        { type: 'files.restored', changeSetId: 'cs1', direction: 'undo', files: [] },
        { type: 'memory.decided', memoryId: 'm1', kept: false },
      ),
    );
    expect(s.signals).toEqual(['memory-undone', 'files-undone', 'stopped']);
  });

  it('python isn’t found, py works: a fact about this computer, written by code', () => {
    const s = signalsOf(
      chat(
        you('Run the script'),
        ...command('python script.py --fast', 'error', 'bash: python: command not found'),
        ...command('py script.py --fast', 'success', 'done'),
        done(),
      ),
    );
    expect(s.signals).toEqual(['worked-another-way']);
    expect(s.environment).toEqual([
      { text: 'On this computer, `python` isn’t found; `py` works.', quote: 'py script.py --fast' },
    ]);
  });

  it('PowerShell says it another way, and may still end "successfully"', () => {
    const s = signalsOf(
      chat(
        you('Check the version'),
        ...command(
          'python3 --version',
          'success',
          "python3 : The term 'python3' is not recognized as the name of a cmdlet, function, script file, or operable program.",
        ),
        ...command('python --version', 'success', 'Python 3.13.1'),
      ),
    );
    expect(s.environment.map((f) => f.text)).toEqual([
      'On this computer, `python3` isn’t found; `python` works.',
    ]);
  });

  it('a missing file is not a missing program', () => {
    const s = signalsOf(
      chat(
        you('Show me the notes'),
        ...command('cat notes.txt', 'error', 'cat: notes.txt: No such file or directory'),
        ...command('type notes.txt', 'success', 'hello'),
      ),
    );
    expect(s.environment).toEqual([]);
  });

  it('a different job after a failure is no fact', () => {
    const s = signalsOf(
      chat(
        you('Run it'),
        ...command('python build.py', 'error', 'python: command not found'),
        ...command('npm test', 'success', 'ok'),
      ),
    );
    expect(s.environment).toEqual([]);
  });

  it('reads only the stretch it’s given, with what came before for context', () => {
    const events = chat(
      you('Write it in Python'),
      done(),
      you('No, I meant TypeScript'),
      done(),
      you('Thanks'),
    );
    const later = signalsOf(events, { afterSeq: 2 });
    expect(later.said.map((s) => s.text)).toEqual(['No, I meant TypeScript', 'Thanks']);
    expect(later.signals).toEqual(['correction', 'pleased']);
    const before = signalsOf(events, { beforeSeq: 3 });
    expect(before.said.map((s) => s.text)).toEqual(['Write it in Python']);
  });

  it('notices words about something lasting', () => {
    expect(signalsOf(chat(you('I always want metric units'))).durable).toBe(true);
    expect(signalsOf(chat(you('My partner is vegetarian'))).durable).toBe(true);
    expect(signalsOf(chat(you('What is the capital of Peru?'))).durable).toBe(false);
  });
});

describe('environmentFact', () => {
  it('only plain, single programs, and the same job', () => {
    expect(environmentFact('python a.py', 'py a.py')?.text).toContain('`python`');
    expect(environmentFact('python a.py && ls', 'py a.py')).toBeUndefined();
    expect(environmentFact('python a.py', 'python a.py')).toBeUndefined();
    expect(environmentFact('$(which python) a.py', 'py a.py')).toBeUndefined();
    expect(environmentFact('python a.py', 'py b.py c.py d.py')).toBeUndefined();
  });
});
