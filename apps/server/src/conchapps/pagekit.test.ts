import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { PAGE_KIT_CSS } from './pagekit.generated';

const root = fileURLToPath(new URL('../../../../', import.meta.url));

interface PageKitScript {
  build: (root: string) => string;
  minify: (css: string) => string;
  OUTPUT: string;
  BUDGET: number;
}

const script = async () =>
  (await import(pathToFileURL(join(root, 'scripts/pagekit.mjs')).href)) as PageKitScript;

describe('the page kit for Conch apps’ pages (ADR 0061)', () => {
  it('is what Nacre’s sources build today', async () => {
    const { build, OUTPUT } = await script();
    const written = readFileSync(join(root, OUTPUT), 'utf8').replaceAll('\r\n', '\n');
    expect(
      written === build(root),
      'The page kit is out of date with Nacre’s tokens.css or pagekit.css: run node scripts/pagekit.mjs',
    ).toBe(true);
  });

  it('stays small, layered, and safe inside a <style>', async () => {
    const { BUDGET } = await script();
    expect(Buffer.byteLength(PAGE_KIT_CSS)).toBeLessThanOrEqual(BUDGET);
    expect(BUDGET).toBeLessThan(24 * 1024);
    expect(PAGE_KIT_CSS).toContain('@layer nacre.tokens,nacre.pagekit;');
    expect(PAGE_KIT_CSS).not.toMatch(/<\/|<!--/);
    expect(PAGE_KIT_CSS).not.toMatch(/\/\*/);
  });

  it('defines every token the kit uses', () => {
    const used = new Set([...PAGE_KIT_CSS.matchAll(/var\((--nc-[\w-]+)/g)].map((m) => m[1]));
    const missing = [...used].filter((name) => !PAGE_KIT_CSS.includes(`${name}:`));
    expect(
      missing,
      'Tokens the kit uses but leaves out: see APP_ONLY in scripts/pagekit.mjs',
    ).toEqual([]);
  });

  it('follows light, dark and the accent, with no colour of its own in the kit', () => {
    const kit = PAGE_KIT_CSS.slice(PAGE_KIT_CSS.indexOf('@layer nacre.pagekit{'));
    expect(PAGE_KIT_CSS).toContain('color-scheme:light dark');
    expect(PAGE_KIT_CSS).toContain('--nc-accent-h:');
    expect(kit).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it('takes out only what a browser ignores', async () => {
    const { minify } = await script();
    expect(
      minify(`/* note */
      @media screen and (max-width: 30rem) {
        .a > .b ,  .c {
          margin: calc(var(--x) - 0.5rem)  0 ;
          padding: calc(var(--y) * 0.4);
          font: 15px / 1.5 'Geist Variable', ui-sans-serif;
        }
      }`),
    ).toBe(
      "@media screen and (max-width:30rem){.a > .b,.c{margin:calc(var(--x) - .5rem) 0;padding:calc(var(--y)*.4);font:15px / 1.5 'Geist Variable',ui-sans-serif}}",
    );
  });
});
