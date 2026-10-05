/**
 * Never learned again (ADR 0088 § 6): something the person took back once
 * stays out, in these words or close ones.
 *
 * A match must be close in words. Meaning only confirms a looser match,
 * because meaning alone is too generous: "Lives in Berlin" and "Lives in
 * Lisbon" sit close for a model, and blocking the move to Lisbon would be a
 * silent mistake. A thing relearned in new words is visible, and one press
 * puts it back on the list.
 */
import type { NeverItem } from '@conch/protocol';

import { cosine, type Embedder } from '../memory/embed';
import { overlap } from '../memory/tidy';
import { similar } from '../skills/suggest';

/** Words alone: this much of the stems in common is the same thing. */
export const SAME_WORDS = 0.5;
/** With a model for meaning, a looser match in words counts when meaning is this far above "the same request". */
export const MEANING_MARGIN = 0.2;

/** Whether `text` is something on the list, and which. */
export async function neverMatch(
  text: string,
  items: readonly NeverItem[],
  meaning?: Embedder,
): Promise<NeverItem | undefined> {
  if (!items.length || !text.trim()) return undefined;
  const sure = items.find((i) => overlap(i.text, text) >= SAME_WORDS);
  if (sure) return sure;
  const loose = items.filter((i) => similar(i.text, text));
  if (!loose.length || !meaning) return undefined;
  try {
    const [v, ...vs] = await meaning.embed([text, ...loose.map((i) => i.text)]);
    if (!v) return undefined;
    const bar = Math.min(0.95, meaning.same + MEANING_MARGIN);
    return loose.find((_, n) => cosine(v, vs[n] ?? new Float32Array()) >= bar);
  } catch {
    // The model stopped answering: the words already said no.
    return undefined;
  }
}
