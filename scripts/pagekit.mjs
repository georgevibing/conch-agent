#!/usr/bin/env node
/**
 * Builds the Nacre page kit for Conch apps' pages (ADR 0061):
 * packages/nacre/src/styles/tokens.css + packages/nacre/src/pagekit/pagekit.css,
 * comments and spare whitespace taken out, written to
 * apps/server/src/conchapps/pagekit.generated.ts as `PAGE_KIT_CSS`. What
 * only Conch's own screens use is left out (`APP_ONLY`): the terminal's
 * colours, the Lustre and its registered properties, stacking order, the
 * deepest shadows and slowest springs, and NacreProvider's motion switch.
 *
 *   node scripts/pagekit.mjs        (or: pnpm pagekit)
 *
 * The gateway can't import Nacre, so it gets the kit as a string;
 * `pagekit.test.ts` fails when that string no longer matches the sources.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SOURCES = ['packages/nacre/src/styles/tokens.css', 'packages/nacre/src/pagekit/pagekit.css'];
export const OUTPUT = 'apps/server/src/conchapps/pagekit.generated.ts';
/**
 * Tokens and kit together, inlined in every page: they stay small enough to
 * cost nothing beside the page itself. The kit draws every control a page can
 * hold — a select's chevron, a file's button, a colour's swatch, a range's
 * track — so it's bigger than a classless base, and still a few KB.
 */
export const BUDGET = 21 * 1024;
/**
 * Tokens no page needs: Conch's terminal, its Lustre, its stacking order, and
 * the deep shadows and slow springs of its own surfaces.
 */
const APP_ONLY =
  /--nc-(?:(?:term|pearl|z)-[\w-]+|lustre|elevation-[34]|spring-(?:soft|bouncy)(?:-duration)?):[^;{}]*;?/g;
const REGISTERED = /@property\s+--nc-[\w-]+\s*\{[^}]*\}/g;
/** Blocks no page needs, once minified: NacreProvider's motion switch. */
const APP_BLOCKS = [/\[data-nacre-motion='reduced'\]\{[^{}]*\}/g];

/**
 * Takes out what a browser ignores, and nothing it reads: comments, runs of
 * whitespace, spaces beside braces, semicolons, commas, after a colon and
 * inside parentheses, and a number's leading zero. Spaces that mean
 * something (`a b`, `x - y` in calc, `and (`) stay.
 */
export function minify(css) {
  return (
    css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(REGISTERED, '')
      .replace(APP_ONLY, '')
      .replace(/\s+/g, ' ')
      .replace(/\s*([{};,])\s*/g, '$1')
      .replace(/:\s+/g, ':')
      .replace(/\(\s+/g, '(')
      .replace(/\s+\)/g, ')')
      .replace(/;}/g, '}')
      // 0.5 is .5: the leading zero of a number, never of anything else.
      .replace(/(^|[\s(,:/-])0\.(\d)/g, '$1.$2')
      // `a * b` in calc is `a*b` (only + and - need their spaces).
      .replace(/([)\d]) \* (?=[\d.(v])/g, '$1*')
      .trim()
  );
}

/** `minify`, then what no page needs taken out. */
export function forPages(css) {
  return APP_BLOCKS.reduce((out, block) => out.replace(block, ''), minify(css));
}

/**
 * Tokens a page's own CSS may use by name (the maker's guide lists them), and
 * the knobs Conch sets for the person's accent: kept even when the kit itself
 * doesn't use them.
 */
const PUBLIC = [
  '--nc-text',
  '--nc-text-muted',
  '--nc-text-accent',
  '--nc-surface',
  '--nc-canvas',
  '--nc-border',
  '--nc-accent-9',
  '--nc-accent-h',
  '--nc-accent-c',
  '--nc-neutral-h',
  '--nc-neutral-c',
];
const DECLARATION = /(--nc-[\w-]+):([^;{}]*);?/g;
const USES = /var\((--nc-[\w-]+)/g;

/**
 * Only the tokens a page can reach: what the kit uses, what a page may use by
 * name, and what those are made of, followed through every `var()`. A token
 * Conch adds for its own screens never makes every page heavier.
 */
export function usedTokens(tokens, kit) {
  const values = new Map();
  for (const [, name, value] of tokens.matchAll(DECLARATION))
    values.set(name, `${values.get(name) ?? ''} ${value}`);
  const keep = new Set();
  const queue = [...PUBLIC, ...[...kit.matchAll(USES)].map((m) => m[1])];
  while (queue.length) {
    const name = queue.pop();
    if (keep.has(name)) continue;
    keep.add(name);
    for (const [, used] of (values.get(name) ?? '').matchAll(USES)) queue.push(used);
  }
  return tokens
    .replace(DECLARATION, (whole, name) => (keep.has(name) ? whole : ''))
    .replace(/;}/g, '}')
    .replace(/[^{}]+\{\}/g, '');
}

/** The kit itself: only the tokens it reaches, then the kit, ready for a <style>. */
export function pageKitCss(root) {
  const [tokens = '', kit = ''] = SOURCES.map((file) =>
    forPages(readFileSync(join(root, file), 'utf8')),
  );
  const css = `${usedTokens(tokens, kit)}\n${kit}`;
  // It's written into a <style> in every page: nothing in it may end that element.
  if (/<\/|<!--/.test(css)) throw new Error('The page kit must not contain "</" or "<!--".');
  if (Buffer.byteLength(css) > BUDGET)
    throw new Error(`The page kit is ${Buffer.byteLength(css)} bytes; keep it under ${BUDGET}.`);
  return css;
}

/** The generated module, from the sources under `root`. */
export function build(root) {
  return `// Generated by scripts/pagekit.mjs from ${SOURCES.join(' and ')}.
// Don't edit: change the sources, then run \`node scripts/pagekit.mjs\`.

/** Nacre's tokens and page kit, for every page a Conch app ships (ADR 0061). */
export const PAGE_KIT_CSS =
  ${JSON.stringify(pageKitCss(root))};
`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  writeFileSync(join(root, OUTPUT), build(root));
  console.log(`${OUTPUT}: ${Buffer.byteLength(pageKitCss(root))} bytes of CSS`);
}
