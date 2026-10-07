import { useEffect, useState } from 'react';

/**
 * How long something took, said for a glance: "0.4s", "4.2s", "38s",
 * "3m 12s", "1h 04m". Never milliseconds: that's for the raw call.
 */
export function storyDuration(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  if (s < 10) return `${Math.max(0.1, Math.round(s * 10) / 10).toFixed(1)}s`;
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(Math.round(s % 60)).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** "1 step", "3 steps". */
export function stepsLabel(n: number): string {
  return `${n} ${n === 1 ? 'step' : 'steps'}`;
}

/** The clock, once a second, while `enabled`. */
export function useNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [enabled]);
  return now;
}

const IRREGULAR = new Set(['sent', 'made', 'bought', 'put', 'set', 'ran', 'wrote', 'paid', 'took']);

/**
 * A phrase said after a " · ": "Committed" → "committed". Only a verb in the
 * past tense drops its capital; a name ("Ana", "PR") keeps it.
 */
export function continuing(text: string): string {
  const word = text.split(/\s/, 1)[0] ?? '';
  if (!/^[A-Z][a-z]+$/.test(word)) return text;
  const lower = word.toLowerCase();
  if (!lower.endsWith('ed') && !IRREGULAR.has(lower)) return text;
  return lower + text.slice(word.length);
}
