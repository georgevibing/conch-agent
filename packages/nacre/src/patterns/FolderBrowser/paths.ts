/**
 * A typed path with its last part (after the last `/` or `\`) swapped for
 * `name`: `~/Pro` and `Projects` make `~/Projects`. By index, where
 * `typed.replace(/[^\\/]*$/, name)` was slow on a long path with no separator
 * (CodeQL js/polynomial-redos), and took a `$&` in a folder's name as a
 * pattern rather than its letters.
 */
export function withLastPart(typed: string, name: string): string {
  const cut = Math.max(typed.lastIndexOf('/'), typed.lastIndexOf('\\')) + 1;
  return typed.slice(0, cut) + name;
}
