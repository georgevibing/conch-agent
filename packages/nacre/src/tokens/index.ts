/**
 * JS mirror of the motion tokens for use with the `motion` library, so springs
 * driven from JS feel identical to the CSS `linear()` springs in tokens.css.
 */
export const springs = {
  snappy: { type: 'spring', stiffness: 400, damping: 30, mass: 1 },
  soft: { type: 'spring', stiffness: 170, damping: 20, mass: 1 },
  bouncy: { type: 'spring', stiffness: 260, damping: 16, mass: 1 },
  gentle: { type: 'spring', stiffness: 120, damping: 20, mass: 1 },
} as const;

export const durations = {
  instant: 0.09,
  fast: 0.16,
  base: 0.24,
  slow: 0.38,
  slower: 0.56,
} as const;

export const easings = {
  out: [0.22, 1, 0.36, 1],
  in: [0.55, 0, 0.75, 0.2],
  inOut: [0.65, 0, 0.35, 1],
  standard: [0.2, 0, 0, 1],
} as const;
