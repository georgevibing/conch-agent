/**
 * The words for thinking effort and permission modes: plain data, so the app
 * and the documentation (`apps/docs/reference`) say exactly the same thing.
 */
import type { EffortChoice } from '@conch/protocol';

/** Plain-language names for effort levels. */
export const effortLabels: Record<EffortChoice, { label: string; description: string }> = {
  auto: { label: 'Auto', description: 'The model decides how long to think' },
  low: { label: 'Low', description: 'Quick answers for simple things' },
  medium: { label: 'Medium', description: 'A balance of speed and care' },
  high: { label: 'High', description: 'Careful thinking for real work' },
  xhigh: { label: 'Extra', description: 'Extra thinking for tricky problems' },
  max: { label: 'Max', description: 'As much thinking as it takes' },
};

/**
 * Permission modes, named for what they mean to a person. One definition in
 * `@conch/protocol` (ADR 0100), shared with the chat apps' `/mode` menu and
 * the documentation; every mode means the same with every provider.
 */
export { MODE_WORDS as modeWords, type ModeWords } from '@conch/protocol';
