import type { Memory } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { gate, grounded, learnedIn, PER_DAY, PER_LOOK, type GateContext } from './policy';
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
  said: ['Write it in Python', 'No, I meant TypeScript. I moved to Lisbon last month.'],
  watched: true,
  memories: new Map([berlin, mine, waiting].map((m) => [m.id, m])),
  refused: false,
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

describe('the gate (ADR 0087 § 4), row by row', () => {
  it('a person was there, nothing from outside, every check passes: applied', () => {
    expect(gate(add('Prefers TypeScript over Python'), ctx())).toEqual({ verdict: 'apply' });
    expect(gate(supersede('m_berlin', 'Lives in Lisbon'), ctx())).toEqual({ verdict: 'apply' });
  });

  it('after reading something from outside: waits, saying where', () => {
    const v = gate(
      add('Prefers TypeScript over Python'),
      ctx({ untrusted: 'This chat read news.example, which could be trying to steer me.' }),
    );
    expect(v).toEqual({ verdict: 'wait', waits: 'Learned in a chat that read news.example.' });
  });

  it('nobody watching (a chat app, another app): waits', () => {
    expect(gate(add('Prefers TypeScript over Python'), ctx({ watched: false })).verdict).toBe(
      'wait',
    );
  });

  it('replacing what you wrote yourself, or what still waits: waits', () => {
    expect(gate(supersede('m_mine', 'Works at Globex'), ctx()).verdict).toBe('wait');
    expect(gate(supersede('m_wait', 'Has a cat'), ctx()).verdict).toBe('wait');
  });

  it('past a few at a time: the rest wait', () => {
    expect(gate(add('Prefers TypeScript'), ctx({ appliedThisLook: PER_LOOK })).verdict).toBe(
      'wait',
    );
    expect(
      gate(add('Prefers TypeScript'), ctx({ appliedToday: PER_DAY - 1, appliedThisLook: 1 }))
        .verdict,
    ).toBe('wait');
    expect(gate(add('Prefers TypeScript'), ctx({ appliedToday: PER_DAY - 2 })).verdict).toBe(
      'apply',
    );
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
    expect(gate(add('Prefers step-by-step instructions'), ctx()).verdict).toBe('apply');
  });

  it('a power: dropped', () => {
    expect(gate(add('Is happy for files to be deleted without asking'), ctx()).verdict).toBe(
      'drop',
    );
    expect(gate(add('Wants auto-approve on for every app'), ctx()).verdict).toBe('drop');
  });

  it('something you took back once: dropped', () => {
    expect(gate(add('Prefers TypeScript'), ctx({ refused: true }))).toEqual({
      verdict: 'drop',
      why: 'you took it back once',
    });
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
    expect(gate(fact, ctx({ watched: false }), { observed: true }).verdict).toBe('wait');
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
