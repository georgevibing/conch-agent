/**
 * Never learned again (ADR 0088 § 6): something the person took back once
 * stays out.
 *
 * Only the same thing is dropped: the same words in the same order, once
 * stems and small words are set aside ("Likes the dark mode" is "Likes dark
 * mode"). Anything merely close — "Prefers light mode" after "Prefers dark
 * mode" was undone, "Prefers TypeScript over Python" after its opposite —
 * may well be the correction that came next, so it isn't dropped silently:
 * it waits for the person's OK, saying what it's close to.
 *
 * Close means close in words, or looser words that a model for meaning
 * confirms. Meaning alone is too generous: "Lives in Berlin" and "Lives in
 * Lisbon" sit close for a model.
 */
import type { NeverItem } from '@conch/protocol';

import { cosine, tokens, type Embedder } from '../memory/embed';
import { overlap } from '../memory/tidy';
import { similar } from '../skills/suggest';

/** Words alone: this much of the stems in common is close. */
export const SAME_WORDS = 0.5;
/** With a model for meaning, looser words count as close when meaning is this far above "the same request". */
export const MEANING_MARGIN = 0.2;

export interface NeverMatch {
  item: NeverItem;
  /** The very same thing: dropped. Otherwise only close: it waits for the person. */
  exact: boolean;
}

/** The same thing: the same stems, in the same order. */
function same(a: string, b: string): boolean {
  const x = tokens(a);
  const y = tokens(b);
  return x.length > 0 && x.length === y.length && x.every((t, i) => t === y[i]);
}

/** Whether `text` is something on the list (or close to it), and which. */
export async function neverMatch(
  text: string,
  items: readonly NeverItem[],
  meaning?: Embedder,
): Promise<NeverMatch | undefined> {
  if (!items.length || !text.trim()) return undefined;
  const exact = items.find((i) => same(i.text, text));
  if (exact) return { item: exact, exact: true };
  const close = items.find((i) => overlap(i.text, text) >= SAME_WORDS);
  if (close) return { item: close, exact: false };
  const loose = items.filter((i) => similar(i.text, text));
  if (!loose.length || !meaning) return undefined;
  try {
    const [v, ...vs] = await meaning.embed([text, ...loose.map((i) => i.text)]);
    if (!v) return undefined;
    const bar = Math.min(0.95, meaning.same + MEANING_MARGIN);
    const found = loose.find((_, n) => cosine(v, vs[n] ?? new Float32Array()) >= bar);
    return found && { item: found, exact: false };
  } catch {
    // The model stopped answering: the words already said no.
    return undefined;
  }
}
