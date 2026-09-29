export interface AccentColor {
  /** OKLCH hue, 0–360. */
  hue: number;
  /** OKLCH chroma of the solid step. ~0.02 (muted) to ~0.2 (vivid). */
  chroma: number;
}

/**
 * Curated accents. Each is named after something found in or around a shell;
 * chroma is tuned per hue so every accent feels equally saturated.
 */
export const accents = {
  coral: { hue: 42, chroma: 0.145 },
  amber: { hue: 68, chroma: 0.14 },
  kelp: { hue: 150, chroma: 0.12 },
  lagoon: { hue: 200, chroma: 0.11 },
  tide: { hue: 250, chroma: 0.15 },
  iris: { hue: 285, chroma: 0.16 },
  orchid: { hue: 335, chroma: 0.15 },
  graphite: { hue: 260, chroma: 0.015 },
} as const satisfies Record<string, AccentColor>;

export type AccentName = keyof typeof accents;

export interface NeutralTint {
  hue: number;
  chroma: number;
}

export const neutrals = {
  /** Warm porcelain — the default. */
  porcelain: { hue: 60, chroma: 0.008 },
  /** Cool slate with a blue undertone. */
  slate: { hue: 255, chroma: 0.012 },
  /** Neutral follows the accent hue for a monochrome feel. */
  tinted: { hue: -1, chroma: 0.014 },
  /** Truly achromatic greys. */
  pure: { hue: 0, chroma: 0 },
} as const satisfies Record<string, NeutralTint>;

export type NeutralName = keyof typeof neutrals;

export function resolveAccent(accent: AccentName | AccentColor): AccentColor {
  return typeof accent === 'string' ? accents[accent] : accent;
}

export function resolveNeutral(
  neutral: NeutralName | NeutralTint,
  accent: AccentColor,
): NeutralTint {
  const tint = typeof neutral === 'string' ? neutrals[neutral] : neutral;
  return tint.hue < 0 ? { hue: accent.hue, chroma: tint.chroma } : tint;
}
