/**
 * A cover's own colour, for the light around it: read from the picture
 * itself on a tiny canvas (the cover is Conch's own, so the canvas may read
 * it). Vivid pixels count more than grey ones, so a black sleeve with one red
 * stripe glows red. Nothing is read until the picture has loaded; anything
 * that goes wrong leaves the accent in its place.
 */
import { useEffect, useState } from 'react';

export interface Tint {
  /** The cover's colour, for the glow and the record's label. */
  glow: string;
  /** The same hue, kept to a strength the progress line can carry in either theme. */
  ink: string;
}

const known = new Map<string, Tint | null>();

function hsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

/** The weighted average colour of RGBA pixels, or nothing when they're all see-through. */
export function averageTint(data: Uint8ClampedArray): Tint | null {
  let r = 0;
  let g = 0;
  let b = 0;
  let weight = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    const alpha = (data[i + 3] ?? 0) / 255;
    if (alpha < 0.5) continue;
    const pr = (data[i] ?? 0) / 255;
    const pg = (data[i + 1] ?? 0) / 255;
    const pb = (data[i + 2] ?? 0) / 255;
    const [, s, l] = hsl(pr, pg, pb);
    // Vivid, mid-light pixels say most about a cover; near-black and near-white say little.
    const w = 0.08 + s * (1 - Math.abs(l - 0.5) * 1.6);
    r += pr * w;
    g += pg * w;
    b += pb * w;
    weight += w;
  }
  if (weight <= 0) return null;
  const [h, s, l] = hsl(r / weight, g / weight, b / weight);
  const hue = Math.round(h);
  const glow = `hsl(${hue} ${Math.round(Math.min(0.85, s * 1.15) * 100)}% ${Math.round(Math.min(0.66, Math.max(0.34, l)) * 100)}%)`;
  const ink = `hsl(${hue} ${Math.round(Math.max(0.35, Math.min(0.75, s)) * 100)}% 52%)`;
  return { glow, ink };
}

function read(src: string): Promise<Tint | null> {
  return new Promise((done) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      try {
        const size = 24;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return done(null);
        ctx.drawImage(img, 0, 0, size, size);
        done(averageTint(ctx.getImageData(0, 0, size, size).data));
      } catch {
        done(null);
      }
    };
    img.onerror = () => done(null);
    img.src = src;
  });
}

/** The cover's tint, once it's known; nothing until then (the accent shows). */
export function useArtworkTint(src: string | undefined): Tint | undefined {
  const [found, setFound] = useState<{ src: string; tint: Tint | null }>();
  useEffect(() => {
    if (!src || known.has(src)) return;
    let live = true;
    void read(src).then((tint) => {
      known.set(src, tint);
      if (live) setFound({ src, tint });
    });
    return () => {
      live = false;
    };
  }, [src]);
  if (!src) return undefined;
  return (known.get(src) ?? (found?.src === src ? found.tint : undefined)) || undefined;
}

/** `3:07`, `1:02:45`. */
export function clock(seconds: number | undefined): string {
  const total = Math.max(0, Math.floor(seconds ?? 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** "3 minutes 7 seconds", for screen readers. */
export function spoken(seconds: number | undefined): string {
  const total = Math.max(0, Math.floor(seconds ?? 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const part = (n: number, one: string) => (n ? `${n} ${one}${n === 1 ? '' : 's'}` : '');
  return (
    [part(h, 'hour'), part(m, 'minute'), part(s, 'second')].filter(Boolean).join(' ') || '0 seconds'
  );
}

/** A podcast's or a long song's length in words: "47 min", "1 hr 12 min". */
export function length(seconds: number | undefined): string | undefined {
  if (!seconds) return undefined;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}
