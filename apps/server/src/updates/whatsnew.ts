/**
 * "What's new", from commit subjects: the changes a person would notice, in
 * their words. `feat(web): attach files to a message (#412)` reads as
 * "Attach files to a message"; chores, tests, docs, merges and other
 * housekeeping are left out.
 */

/** Housekeeping nobody using Conch would notice. */
const NOISE = /^(chore|tests?|docs?|style|ci|build|refactor|wip|release|deps?)(\([^)]*\))?!?:/i;
const NOT_A_CHANGE = /^(merge\b|revert "merge|fixup!|squash!|amend!|wip\b|initial commit\b)/i;
const CONVENTIONAL = /^[a-z]+(?:\([^)]*\))?!?:\s*(.+)$/i;

/** One commit subject as a person would say it, or `undefined` when it's housekeeping. */
export function humanise(subject: string): string | undefined {
  const line = subject.trim();
  if (!line || NOISE.test(line) || NOT_A_CHANGE.test(line)) return undefined;
  const text = (CONVENTIONAL.exec(line)?.[1] ?? line)
    // A pull request number or a trailing full stop adds nothing here.
    .replace(/\s*\((?:#|gh-)\d+\)\s*$/i, '')
    .replace(/[.\s]+$/, '')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
  if (text.length < 3) return undefined;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The changes worth telling, newest first and each once, from subjects newest first. */
export function whatsNew(subjects: string[]): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const subject of subjects) {
    const line = humanise(subject);
    if (!line || seen.has(line.toLowerCase())) continue;
    seen.add(line.toLowerCase());
    lines.push(line);
  }
  return lines;
}
