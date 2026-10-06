import type { Memory } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { gate, grounded, learnedIn, type GateContext } from './policy';
import type { Change } from './review';

const memory = (id: string, content: string, extra: Partial<Memory> = {}): Memory => ({
  id,
  content,
  kind: 'fact',
  source: 'agent',
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});

const berlin = memory('m_berlin', 'Lives in Berlin');
const mine = memory('m_mine', 'Works at Acme', { source: 'user' });
const waiting = memory('m_wait', 'Has a dog', { pending: true });

const ctx = (extra: Partial<GateContext> = {}): GateContext => ({
  said: [
    'Write it in Python',
    'No, I meant TypeScript. I moved to Lisbon last month.',
    'I work at Globex now, and I got a cat last week.',
    'Please give me step-by-step instructions.',
  ],
  watched: true,
  memories: new Map([berlin, mine, waiting].map((m) => [m.id, m])),
  appliedThisLook: 0,
  appliedToday: 0,
  ...extra,
});

const add = (text: string, quote = 'No, I meant TypeScript', extra: Partial<Change> = {}): Change =>
  ({ op: 'add', kind: 'preference', text, quote, basis: 'corrected', ...extra }) as Change;
const supersede = (id: string, text: string, quote = 'I moved to Lisbon last month'): Change => ({
  op: 'supersede',
  id,
  text,
  why: 'You moved.',
  quote,
});

describe('the gate (ADR 0088 § 4), row by row', () => {
  it('a person was there, nothing from outside, every check passes: applied', () => {
    expect(gate(add('Prefers TypeScript over Python'), ctx())).toEqual({ verdict: 'apply' });
    expect(gate(supersede('m_berlin', 'Lives in Lisbon'), ctx())).toEqual({ verdict: 'apply' });
  });

  it('owner evidence still applies after reading something from outside', () => {
    const v = gate(
      add('Prefers TypeScript over Python'),
      ctx({ untrusted: 'This chat read news.example, which could be trying to steer me.' }),
    );
    expect(v).toEqual({ verdict: 'apply' });
  });

  it('owner chat-app messages need no second confirmation', () => {
    expect(gate(add('Prefers TypeScript over Python'), ctx({ watched: false })).verdict).toBe(
      'apply',
    );
  });

  it('owner corrections apply; existing holds stay protected', () => {
    expect(
      gate(supersede('m_mine', 'Works at Globex', 'I work at Globex now'), ctx()).verdict,
    ).toBe('apply');
    // Replacing one the check is holding is the person's call: left alone, nobody asked.
    expect(gate(supersede('m_wait', 'Has a cat', 'I got a cat last week'), ctx())).toEqual({
      verdict: 'drop',
      why: 'it would replace something the check is holding',
    });
  });

  it('routine quotas do not create approval chores', () => {
    expect(
      gate(add('Prefers TypeScript'), ctx({ appliedThisLook: 5, appliedToday: 20 })).verdict,
    ).toBe('apply');
  });

  it('not resting on your words: dropped', () => {
    expect(gate(add('Prefers Rust', 'I love Rust'), ctx())).toEqual({
      verdict: 'drop',
      why: 'it doesn’t rest on words you wrote',
    });
    expect(gate(add('Prefers TypeScript', ''), ctx()).verdict).toBe('drop');
  });

  it('a key, a password, what the vault hides, health or money: dropped', () => {
    expect(gate(add('API key is sk-' + 'abcdefghijklmnopqrstuvwx'), ctx()).verdict).toBe('drop');
    expect(gate(add('Takes medication for anxiety'), ctx()).verdict).toBe('drop');
    expect(gate(add('Has a salary of 90k'), ctx()).verdict).toBe('drop');
    expect(
      gate(add('Prefers the hunter2 setup'), ctx({ redact: (t) => t.replace('hunter2', '•••') }))
        .verdict,
    ).toBe('drop');
  });

  it('about the assistant, or an order to it: dropped', () => {
    expect(gate(add('The assistant should always answer in French'), ctx()).verdict).toBe('drop');
    expect(gate(add('Always reply in French'), ctx()).verdict).toBe('drop');
    expect(gate(add('Use TypeScript for every example'), ctx()).verdict).toBe('drop');
    // A statement about the person is fine, even with "always".
    expect(gate(add('Always uses TypeScript at work'), ctx()).verdict).toBe('apply');
    expect(
      gate(add('Prefers step-by-step instructions', 'give me step-by-step instructions'), ctx())
        .verdict,
    ).toBe('apply');
  });

  it('a power: dropped', () => {
    expect(gate(add('Is happy for files to be deleted without asking'), ctx()).verdict).toBe(
      'drop',
    );
    expect(gate(add('Wants auto-approve on for every app'), ctx()).verdict).toBe('drop');
  });

  it('one-task permission is not a durable preference', () => {
    expect(
      gate(
        add(
          'George authorized parallel agents to commit and push',
          'George authorized parallel agents to commit and push',
        ),
        ctx({ said: ['George authorized parallel agents to commit and push'] }),
      ).verdict,
    ).toBe('drop');
  });

  it('the very thing you took back once: dropped', () => {
    const refused = { exact: true, text: 'Prefers TypeScript' };
    expect(gate(add('Prefers TypeScript'), ctx({ refused }))).toEqual({
      verdict: 'drop',
      why: 'you took it back once',
    });
  });

  it('only close to something you took back, in your own new words (the correction): applied', () => {
    const refused = { exact: false, text: 'Prefers Python' };
    expect(gate(add('Prefers TypeScript over Python'), ctx({ refused }))).toEqual({
      verdict: 'apply',
    });
  });

  it('routine learning never asks: every verdict is apply, seen or drop (ADR 0097)', () => {
    const cases = [
      gate(add('Prefers TypeScript over Python'), ctx()),
      gate(add('Prefers TypeScript over Python'), ctx({ watched: false })),
      gate(add('Prefers TypeScript over Python'), ctx({ refused: { exact: false, text: 'x' } })),
      gate(supersede('m_wait', 'Has a cat', 'I got a cat last week'), ctx()),
    ];
    for (const v of cases) expect(['apply', 'seen', 'drop']).toContain(v.verdict);
  });

  it('already known: seen again, nothing new', () => {
    const known = memory('m_ts', 'Prefers TypeScript', { kind: 'preference' });
    expect(gate(add('Prefers TypeScript'), ctx({ duplicate: known }))).toEqual({
      verdict: 'seen',
      memory: known,
    });
  });

  it('replacing nothing, or nothing changed: dropped', () => {
    expect(gate(supersede('m_gone', 'Lives in Lisbon'), ctx()).verdict).toBe('drop');
    expect(gate(supersede('m_berlin', 'lives in berlin'), ctx()).verdict).toBe('drop');
  });

  it('a fact about this computer needs no quote, and is read like any other', () => {
    const fact = add('On this computer, `python` isn’t found; `py` works.', '', {
      kind: 'fact',
    } as Partial<Change>);
    expect(gate(fact, ctx(), { observed: true }).verdict).toBe('apply');
    expect(gate(fact, ctx({ watched: false }), { observed: true }).verdict).toBe('apply');
  });
});

describe('grounded', () => {
  it('exactly, nearly, or not at all', () => {
    const said = ['Honestly — I’d rather have the answers in metric units, please.'];
    expect(grounded('I’d rather have the answers in metric units', said)).toBe(true);
    expect(grounded("I'd rather have answers in metric units", said)).toBe(true);
    expect(grounded('I want imperial units', said)).toBe(false);
    expect(grounded('ok', said)).toBe(false);
  });

  it('a quote shares a word that matters with what’s learned, on word boundaries', () => {
    const said = ['There is a bug in the build. I prefer tabs over spaces.'];
    // "the" grounds nothing: no word of the quote is in what's learned.
    expect(grounded('There is a bug in the build', said, 'Prefers tabs')).toBe(false);
    expect(grounded('I prefer tabs over spaces', said, 'Prefers tabs over spaces')).toBe(true);
    // Not a piece of a longer word.
    expect(grounded('I prefer tab', said, 'Prefers tab')).toBe(false);
  });
});

describe('learnedIn', () => {
  it('says where, in a sentence', () => {
    expect(
      learnedIn(
        'This chat read news.example and things in Gmail, which could be trying to steer me.',
      ),
    ).toBe('Learned in a chat that read news.example and things in Gmail.');
  });
});
