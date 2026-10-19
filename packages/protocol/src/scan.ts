/**
 * Small text scans done by index, for words anyone can write: each looks at a
 * character a fixed number of times, so a long or hostile string costs time in
 * proportion to its length (CodeQL's polynomial-ReDoS findings, October 2026).
 * Each says the regular expression it stands for, and its tests hold it to
 * that expression's answers.
 */

const SPACE = /^\s$/;
const BREAK = /^[\n\r\u2028\u2029]$/;

/** Whether one character is what `\s` matches. */
export const isSpaceChar = (ch: string): boolean => SPACE.test(ch);

/** Whether one character ends a line for `.` (which never matches one). */
const isBreakChar = (ch: string): boolean => BREAK.test(ch);

/**
 * What follows `prefix` and at least one space, to the end, on one line:
 * `/^prefix\s+(.+)$/` (with `i` when `ignoreCase`), its capture or nothing.
 * `prefix` may be several (`Couldn’t`, `Couldn't`); the first that starts
 * the text is used. Prefixes are plain ASCII words, so `ignoreCase` is a
 * lower-case comparison.
 */
export function afterSpace(
  text: string,
  prefix: string | readonly string[],
  ignoreCase = false,
): string | undefined {
  const head = (s: string) => (ignoreCase ? s.toLowerCase() : s);
  const found = (typeof prefix === 'string' ? [prefix] : prefix).find(
    (p) => head(text.slice(0, p.length)) === head(p),
  );
  if (found === undefined) return undefined;
  const rest = text.slice(found.length);
  let spaces = 0;
  while (spaces < rest.length && isSpaceChar(rest.charAt(spaces))) spaces++;
  if (spaces === 0) return undefined;
  if (spaces < rest.length) {
    const words = rest.slice(spaces);
    for (const ch of words) if (isBreakChar(ch)) return undefined;
    return words;
  }
  // Only spaces after the prefix: `\s+` gives its last one back so `.+` has something.
  const last = rest.charAt(rest.length - 1);
  return spaces >= 2 && !isBreakChar(last) ? last : undefined;
}

/** `text` without the run at its end of characters `drop` says to: `/[…]+$/` replaced with nothing. */
export function trimEndWhere(text: string, drop: (ch: string) => boolean): string {
  let end = text.length;
  while (end > 0 && drop(text.charAt(end - 1))) end--;
  return end === text.length ? text : text.slice(0, end);
}
