import { describe, expect, it, vi } from 'vitest';

import type { Engine } from '../engines/types';
import { MockEngine } from '../engines/mock/engine';
import { ProfileUnavailable, readFacts, understandProfile } from './understand';

describe('reading what you wrote into cards', () => {
  it('keeps the facts in the shape asked for, cleaned, once each', () => {
    const facts = readFacts(
      'Sure! {"facts":[{"kind":"Work","text":"  SDM at   Amazon "},{"kind":"person","text":"Lina","detail":"daughter · born 8 June 2025"},{"kind":"work","text":"SDM at Amazon"},{"kind":"pets","text":"A cat"},{"kind":"home","text":""}]} Hope that helps',
    );
    expect(facts.map(({ id: _id, ...f }) => f)).toEqual([
      { kind: 'work', text: 'SDM at Amazon' },
      { kind: 'person', text: 'Lina', detail: 'daughter · born 8 June 2025' },
    ]);
    expect(new Set(facts.map((f) => f.id)).size).toBe(2);
  });

  it('says nothing for an answer that isn’t the shape', () => {
    expect(readFacts('I can’t do that.')).toEqual([]);
    expect(readFacts('{"facts": "lots"}')).toEqual([]);
    expect(readFacts('{not json}')).toEqual([]);
  });

  it('asks the default provider, and says plainly when it can’t', async () => {
    const mock = new MockEngine({ speed: 0 });
    const facts = await understandProfile(
      mock,
      'I design boardgames at a small studio. I live in Lisbon.',
      new AbortController().signal,
    );
    expect(facts.map((f) => f.kind)).toEqual(['work', 'home']);

    const cannot = { label: 'Scripted', capabilities: vi.fn() } as unknown as Engine;
    await expect(
      understandProfile(cannot, 'Anything', new AbortController().signal),
    ).rejects.toBeInstanceOf(ProfileUnavailable);
  });
});
