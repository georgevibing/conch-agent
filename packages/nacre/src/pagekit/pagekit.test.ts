/**
 * The page kit is the whole of a Conch app page's look (ADR 0061): a page
 * ships no CSS of its own, so anything the kit leaves out is a control drawn
 * by the system — a grey "Choose File" button, an arrow against the edge —
 * in the middle of a page that otherwise looks like Conch.
 *
 * So this is the kit's lint: every element a page can hold is dressed, with
 * tokens and nothing else. It fails with what to add.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/** The kit as it ships, its comments taken out: `scripts/pagekit.mjs` reads it the same way. */
const kit = readFileSync(join(import.meta.dirname, 'pagekit.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

/** The whole declaration block of every rule whose selector matches. */
function rules(pattern: RegExp): string[] {
  const found: string[] = [];
  for (const rule of kit.matchAll(/([^{}]+)\{([^{}]*)\}/g))
    if (pattern.test(rule[1] ?? '')) found.push(rule[2] ?? '');
  return found;
}

const dressed = (selector: RegExp) => rules(selector).join('\n');

describe('the page kit', () => {
  /**
   * Every control a page can hold. A model writes plain HTML; the kit is the
   * only thing between that and the system's own chrome.
   */
  it.each([
    ['a button', /(?:^|,)\s*button(?![\w-])/],
    ['a text field', /(?:^|,)\s*input:not\(/],
    ['a textarea', /(?:^|,)\s*textarea(?![\w-])/],
    ['a select', /(?:^|,)\s*select(?![\w-[])/],
    ['a checkbox and a radio', /input\[type='checkbox'\]/],
    ['a slider', /input\[type='range'\]/],
    ['a colour', /input\[type='color'\]/],
    ['a file', /input\[type='file'\]/],
    ['the button inside a file', /::file-selector-button/],
    ['a date’s picker button', /calendar-picker-indicator/],
    ['progress', /(?:^|,)\s*progress(?![\w-])/],
    ['a meter', /(?:^|,)\s*meter(?![\w-])/],
    ['a fieldset and its legend', /(?:^|,)\s*legend(?![\w-])/],
    ['a label', /(?:^|,)\s*label(?![\w-])/],
    ['a table’s cells', /(?:^|,)\s*th(?![\w-])/],
    ['a table’s caption', /(?:^|,)\s*caption(?![\w-])/],
    ['details and its summary', /(?:^|,)\s*summary(?![\w-])/],
    ['a quote', /(?:^|,)\s*blockquote(?![\w-])/],
    ['a description list', /(?:^|,)\s*dt(?![\w-])/],
    ['highlighted words', /(?:^|,)\s*mark(?![\w-])/],
    ['the headings, h4 included', /(?:^|,)\s*h4(?![\w-])/],
  ])('draws %s', (_what, selector) => {
    expect(dressed(selector), 'The page kit leaves this to the system to draw.').not.toBe('');
  });

  it('takes the system’s chrome off a select and leaves room for its own chevron', () => {
    const select = dressed(/(?:^|,)\s*select(?![\w-[])/);
    expect(select).toMatch(/appearance:\s*none/);
    // The chevron is drawn by the kit, and the words stop before it.
    expect(select).toMatch(/padding-inline-end:\s*var\(--nc-space-8\)/);
    expect(select).toMatch(/background-position:[\s\S]*right var\(--nc-space-3\)/);
    expect(select).toMatch(/var\(--nc-text-subtle\)/);
  });

  it('lines a page’s head up: an icon that keeps its shape, a title on its middle', () => {
    expect(dressed(/\.nc-page-head\s*$/)).toMatch(/align-items:\s*center/);
    const icon = dressed(/\.nc-page-head > :is\(img, svg/);
    expect(icon).toMatch(/flex:\s*none/);
    expect(icon).toMatch(/block-size:\s*var\(--nc-page-icon/);
    // Whatever wraps the title inside a row carries no stacking margin of its own.
    expect(kit).toMatch(/\.nc-page-head[\s\S]*?margin-block:\s*0/);
  });

  it('writes no colour of its own: light, dark and the accent come from the tokens', () => {
    const body = kit.slice(kit.indexOf('@layer nacre.pagekit'));
    expect(body).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(body).not.toMatch(/\b(?:rgba?|hsla?)\(/);
  });
});
