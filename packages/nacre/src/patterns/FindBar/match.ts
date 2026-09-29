/**
 * Case- and accent-insensitive text matching for find-in-page. Folding keeps
 * the string length, so offsets in folded text are offsets in the original.
 * (Mirrors `foldText` in @conch/protocol; Nacre stays dependency-free.)
 */
const MARKS = /\p{M}/gu;
const cache = new Map<string, string>();

export function fold(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 128) {
      out += code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : text[i];
      continue;
    }
    const unit = text[i] as string;
    let f = cache.get(unit);
    if (f === undefined) {
      const lower = unit.toLowerCase();
      const bare = lower.normalize('NFD').replace(MARKS, '');
      f = bare.length === 1 ? bare : lower.length === 1 ? lower : unit;
      cache.set(unit, f);
    }
    out += f;
  }
  return out;
}

/** A global regex for `query` over folded text; any whitespace run matches any other. */
export function matcher(query: string): RegExp | null {
  const words = fold(query).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(escaped.join('\\s+'), 'g');
}

/** `[start, end)` of every match, up to `max`. */
export function findAll(folded: string, query: string, max = 2000): [number, number][] {
  const re = matcher(query);
  if (!re) return [];
  const out: [number, number][] = [];
  for (const m of folded.matchAll(re)) {
    if (!m[0].length) break;
    out.push([m.index, m.index + m[0].length]);
    if (out.length >= max) break;
  }
  return out;
}
