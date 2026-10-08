/**
 * The plot's colours, in a form a saved picture keeps.
 *
 * The marks wear `--ch-*` custom properties, which the stylesheet points at
 * the real tokens (`--nc-chart-1…8`, `--nc-surface`, the text greys). Those
 * tokens are written `light-dark(light, dark)` — one definition per value —
 * which the page resolves against its `color-scheme`, but a serialised
 * `<svg>` on its own would fall back to the light side. So after each render
 * the live values are read, resolved for the mode actually on screen, and
 * stamped onto the `<svg>`'s own `style` attribute. Serialise that element
 * and the picture carries its whole palette with it, the right way round,
 * with no stylesheet to go looking for. Nothing goes into React state, so a
 * hover never re-reads the cascade.
 */
import { useLayoutEffect, type RefObject } from 'react';

import { useNacreTheme } from '../../theme';

/** Every colour the plot paints with, and the token behind it. */
export const CHART_VARS: Readonly<Record<string, string>> = {
  '--ch-surface': '--nc-surface',
  '--ch-ink': '--nc-text',
  '--ch-soft': '--nc-text-muted',
  '--ch-subtle': '--nc-text-subtle',
  '--ch-grid': '--nc-gray-4',
  '--ch-axis': '--nc-gray-6',
  '--ch-cross': '--nc-gray-8',
  '--ch-goal': '--nc-gray-9',
  '--ch-1': '--nc-chart-1',
  '--ch-2': '--nc-chart-2',
  '--ch-3': '--nc-chart-3',
  '--ch-4': '--nc-chart-4',
  '--ch-5': '--nc-chart-5',
  '--ch-6': '--nc-chart-6',
  '--ch-7': '--nc-chart-7',
  '--ch-8': '--nc-chart-8',
};

/** The top-level pieces of a comma-separated list, leaving nested calls whole. */
function commas(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) {
      out.push(text.slice(from, i));
      from = i + 1;
    }
  }
  out.push(text.slice(from));
  return out.map((p) => p.trim());
}

/**
 * One side of a `light-dark(…)` pair, for the mode on screen. A plain colour
 * comes back as it is. (A custom property keeps the function unevaluated, so
 * a picture taken of the card would otherwise come out light whatever the
 * screen was.)
 */
export function forMode(value: string, dark: boolean): string {
  const text = value.trim();
  const inside = /^light-dark\(([\s\S]*)\)$/i.exec(text);
  if (!inside?.[1]) return text;
  const sides = commas(inside[1]);
  return (dark ? sides[1] : sides[0]) ?? text;
}

/**
 * Freeze the palette onto the plot itself, so the `<svg>` stands alone. Runs
 * again when the theme's knobs change, since every token is computed from them.
 */
export function useExportablePaints(card: RefObject<HTMLElement | null>) {
  const { resolvedMode, accent, neutral } = useNacreTheme();
  const key = `${resolvedMode}|${JSON.stringify(accent)}|${JSON.stringify(neutral)}`;
  useLayoutEffect(() => {
    const el = card.current?.querySelector<SVGSVGElement>('[data-nacre-chart-svg]');
    if (!el || typeof getComputedStyle !== 'function') return;
    const dark = resolvedMode === 'dark';
    // Read from the card, not the plot: the plot's own inline stamp from the
    // last run would otherwise be what we read back.
    const style = getComputedStyle(card.current as HTMLElement);
    for (const [local, name] of Object.entries(CHART_VARS)) {
      const raw = style.getPropertyValue(name).trim();
      if (raw) el.style.setProperty(local, forMode(raw, dark));
    }
    const font = style.fontFamily;
    if (font) el.setAttribute('font-family', font);
    // The theme is what every token above is computed from.
  }, [card, key, resolvedMode]);
}

/** The paint for series slot `k`, in the plot's own frame. */
export const paint = (k: number) => `var(--ch-${(k % 8) + 1})`;

/** The paint for series slot `k` outside the plot (the legend, the read-out). */
export const token = (k: number) => `var(--nc-chart-${(k % 8) + 1})`;

export const INK = 'var(--ch-ink)';
export const SOFT = 'var(--ch-soft)';
export const SUBTLE = 'var(--ch-subtle)';
export const GRID = 'var(--ch-grid)';
export const AXIS = 'var(--ch-axis)';
export const CROSS = 'var(--ch-cross)';
export const GOAL = 'var(--ch-goal)';
export const SURFACE = 'var(--ch-surface)';
