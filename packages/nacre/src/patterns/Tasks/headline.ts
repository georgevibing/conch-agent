/**
 * A task's result, in one line a person reads at a glance: the first sentence
 * or two of what it said, without the machine's bookkeeping — no ids or
 * hashes, no "Version: 1", no "Error: none.", no markdown marks.
 */

// "Artifact ID: a_a460…", "Version: 1", "Error: none." — lines that only keep books.
const BOOKKEEPING =
  /^\s*(?:[\w ]*\b(?:id|ids|hash|version|revision|rev)\b\s*:.*|errors?\s*:\s*(?:none|no(?:ne)?|n\/a|-)\.?)\s*$/i;
// a_a460ef7a…, 3f2e…(24+ hex), UUIDs: names for machines, not people.
const IDS =
  /\b(?:[a-z]{1,4}_[a-z0-9]{16,}|[a-f0-9]{24,}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\b/gi;
const MAX = 200;

export function taskHeadline(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const lines = text
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)/, '')
        .replace(/\*\*|__|`/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'),
    )
    .filter((line) => !BOOKKEEPING.test(line));
  const prose = lines
    .join(' ')
    .replace(IDS, '')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/(?:^|\s)[:,;]\s*(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!prose) return undefined;
  // Sentences end at punctuation followed by a capital, so "notes.txt" stays whole.
  const sentences = prose.split(/(?<=[.!?…])\s+(?=[A-Z“"‘(])/);
  let line = sentences[0] ?? prose;
  // "Diagnostic passed." says little alone: take the next one too.
  if (line.length < 40 && sentences[1]) line = `${line} ${sentences[1]}`;
  return line.length > MAX ? `${line.slice(0, MAX - 1).trimEnd()}…` : line;
}
