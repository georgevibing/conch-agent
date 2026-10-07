import { afterEach, describe, expect, it, vi } from 'vitest';

import { cleanNarration, NARRATION_MAX, NarrationPacer, type NarrationLine } from './narration';

describe('a provider’s notes in plain words (ADR 0103)', () => {
  it('takes markdown, links and list marks away, on one line', () => {
    expect(cleanNarration('## **Reading** the `config`\n- then [the docs](https://x.test)')).toBe(
      'Reading the config then the docs',
    );
    expect(cleanNarration('> _Checking_ <b>tests</b>')).toBe('Checking tests');
    expect(cleanNarration('   \n ')).toBe('');
  });

  it('keeps it to 240 characters, at a word where it can', () => {
    const said = cleanNarration(`${'word '.repeat(100)}end`);
    expect(said.length).toBeLessThanOrEqual(NARRATION_MAX);
    expect(said.endsWith('…')).toBe(true);
    expect(said).not.toMatch(/wor…$/);
  });
});

describe('pacing a turn’s notes', () => {
  afterEach(() => vi.useRealTimers());

  function pacer() {
    vi.useFakeTimers();
    const said: NarrationLine[] = [];
    const pace = new NarrationPacer(
      (line) => said.push(line),
      () => Date.now(),
    );
    return { said, pace };
  }

  it('says the first at once, and the same words never twice in a row', () => {
    const { said, pace } = pacer();
    pace.say('Reading the config', 't1');
    pace.say('Reading the config', 't2');
    vi.advanceTimersByTime(2_000);
    pace.say('**Reading** the config');
    expect(said).toEqual([{ text: 'Reading the config', toolUseId: 't1' }]);
  });

  it('says only the latest of a burst, half a second after the last', () => {
    const { said, pace } = pacer();
    pace.say('One');
    pace.say('Two');
    pace.say('Three');
    expect(said.map((l) => l.text)).toEqual(['One']);
    vi.advanceTimersByTime(499);
    expect(said.map((l) => l.text)).toEqual(['One']);
    vi.advanceTimersByTime(1);
    expect(said.map((l) => l.text)).toEqual(['One', 'Three']);
    vi.advanceTimersByTime(600);
    pace.say('Four');
    expect(said.map((l) => l.text)).toEqual(['One', 'Three', 'Four']);
  });

  it('drops what waits when the turn ends, and survives a line that can’t be kept', () => {
    vi.useFakeTimers();
    const said: string[] = [];
    const pace = new NarrationPacer((line) => {
      if (line.text === 'Broken') throw new Error('disk full');
      said.push(line.text);
    });
    pace.say('Broken');
    pace.say('Later');
    pace.close();
    vi.advanceTimersByTime(1_000);
    expect(said).toEqual([]);
  });
});
