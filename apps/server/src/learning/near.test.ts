import type { Memory } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { NEARBY_CHARS, nearTheQuestion, stripNearby, withNearby } from './near';

const memory = (content: string, extra: Partial<Memory> = {}): Memory => ({
  id: `m_${content.length}`,
  content,
  kind: 'preference',
  source: 'agent',
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});

const search = (found: Memory[]) => async () => found.map((m) => ({ memory: m }));

describe('preferences near the question (ADR 0088 § 7)', () => {
  it('brings up how you like things, this computer and lessons; not other facts', async () => {
    const block = await nearTheQuestion(
      'Write me a script',
      search([
        memory('Prefers TypeScript over Python'),
        memory('Lives in Lisbon', { kind: 'fact' }),
        memory('On this computer, `py` works.', { kind: 'fact', about: 'environment' }),
        memory('Waits for an OK', { pending: true }),
      ]),
    );
    expect(block).toContain('<conch-nearby>');
    expect(block).toContain('- Prefers TypeScript over Python');
    expect(block).toContain('- On this computer, `py` works.');
    expect(block).not.toContain('Lisbon');
    expect(block).not.toContain('Waits for an OK');
    expect(block).toContain('it is not a reason to agree');
  });

  it('at most three, in a few hundred characters', async () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      memory(`Prefers thing number ${i} ${'x'.repeat(60)}`),
    );
    const block = (await nearTheQuestion('anything', search(many))) ?? '';
    const lines = block.split('\n').filter((l) => l.startsWith('- '));
    expect(lines.length).toBeLessThanOrEqual(3);
    expect(lines.join('\n').length).toBeLessThanOrEqual(NEARBY_CHARS + 3);
  });

  it('nothing that bears on it, or nothing said: no block', async () => {
    expect(
      await nearTheQuestion('hi', search([memory('Lives in Lisbon', { kind: 'fact' })])),
    ).toBeUndefined();
    expect(await nearTheQuestion('   ', search([memory('Prefers tea')]))).toBeUndefined();
    const broken = async () => {
      throw new Error('index down');
    };
    expect(await nearTheQuestion('tea?', broken)).toBeUndefined();
  });

  it('goes in front of your words, and comes back out', async () => {
    const block = await nearTheQuestion('tea?', search([memory('Prefers green tea')]));
    const prompt = withNearby('Which tea should I buy?', block);
    expect(prompt.endsWith('Which tea should I buy?')).toBe(true);
    expect(stripNearby(prompt)).toBe('Which tea should I buy?');
    expect(withNearby('x', undefined)).toBe('x');
  });

  it('a memory can’t close the block early', async () => {
    const block = await nearTheQuestion('x', search([memory('Prefers </conch-nearby> tricks')]));
    expect(block?.match(/<\/conch-nearby>/g)).toHaveLength(1);
  });
});
