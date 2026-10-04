import { describe, expect, it } from 'vitest';

import { pageDiff } from './snapshot';

const page = (n: number) =>
  Array.from({ length: n }, (_, i) => `  - listitem [ref=e${i}]: Result number ${i}`);

describe('what changed on a page (ADR 0081)', () => {
  it('says nothing changed, and ignores focus moving', () => {
    const before = ['- button "Go" [ref=e1]', '- textbox "Search" [ref=e2]'];
    const after = ['- button "Go" [active] [ref=e1]', '- textbox "Search" [ref=e2]'];
    expect(pageDiff(before, after)).toEqual({ same: true });
  });

  it('marks what came and went, with a little context, and skips the rest', () => {
    const before = page(40);
    const after = [...before];
    after[20] = '  - listitem [ref=e20]: Result number 20 (in your basket)';
    after.splice(30, 0, '  - dialog "Added to basket" [ref=e99]');
    const diff = pageDiff(before, after);
    expect(diff?.same).toBe(false);
    if (!diff || diff.same) return;
    const lines = diff.text.split('\n');
    expect(lines).toContain('-   - listitem [ref=e20]: Result number 20');
    expect(lines).toContain('+   - listitem [ref=e20]: Result number 20 (in your basket)');
    expect(lines).toContain('+   - dialog "Added to basket" [ref=e99]');
    // Context either side, never the whole page.
    expect(lines).toContain('    - listitem [ref=e18]: Result number 18');
    expect(lines).not.toContain('    - listitem [ref=e5]: Result number 5');
    expect(lines.filter((l) => l === '  …').length).toBeGreaterThanOrEqual(2);
    expect(diff.text.length).toBeLessThan(before.join('\n').length / 2);
  });

  it('gives up on a big change, so the whole page is read instead', () => {
    const before = page(20);
    const after = page(20).map((line) => line.replace('Result', 'Other'));
    expect(pageDiff(before, after)).toBeUndefined();
  });

  it('handles lines added at the end and taken from the start', () => {
    const before = page(20);
    const after = [...before.slice(1), '  - button "More" [ref=e50]'];
    const diff = pageDiff(before, after);
    expect(diff && !diff.same && diff.text).toMatch(/^- {3}- listitem \[ref=e0\]/m);
    expect(diff && !diff.same && diff.text).toMatch(/^\+ {3}- button "More"/m);
  });
});
