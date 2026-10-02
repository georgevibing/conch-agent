import { describe, expect, it } from 'vitest';

import { archiveText, attributedText } from './typedstream';

describe('attributedText — the words of a newer iMessage', () => {
  it('reads what Messages archives, short and long', () => {
    for (const text of ['hi', 'é 🎉 “quotes”', 'x'.repeat(200), 'y'.repeat(70_000)])
      expect(attributedText(archiveText(text))).toBe(text);
  });

  it('finds the words in an NSMutableString too, and skips a false start', () => {
    const archive = archiveText('the real words');
    const mutable = Buffer.from(
      archive.toString('latin1').replace('NSString', 'NSMutableString'),
      'latin1',
    );
    expect(attributedText(mutable)).toBe('the real words');
  });

  it('gives up on anything that isn’t an archive, instead of misreading it', () => {
    expect(attributedText(undefined)).toBeUndefined();
    expect(attributedText(Buffer.from('just some bytes, not an archive'))).toBeUndefined();
    const whole = archiveText('a long enough message');
    const truncated = whole.subarray(0, whole.indexOf('a long') + 5);
    expect(attributedText(truncated)).toBeUndefined();
    // A length that runs past the end.
    const broken = Buffer.from(archiveText('hello'));
    broken[broken.indexOf(0x2b, broken.indexOf('NSString')) + 1] = 0x7f;
    expect(attributedText(broken)).toBeUndefined();
  });
});
