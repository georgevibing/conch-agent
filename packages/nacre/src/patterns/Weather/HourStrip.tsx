import { Slider as SliderPrimitive } from 'radix-ui';
import { useEffect, useId, useMemo, useRef, type CSSProperties, type PointerEvent } from 'react';

import { hourLabel, smoothPath, tempHue, toCelsius, type Clock } from './sky';
import type { WeatherHour } from './types';
import styles from './Weather.module.css';

/** The curve's box, in its own units: the SVG stretches to the strip. */
const W = 1000;
const H = 100;
/** Room above and below the curve, as a share of its height. */
const PAD_TOP = 0.3;
const PAD_BOTTOM = 0.12;

export interface HourStripProps extends Clock {
  hours: WeatherHour[];
  imperial: boolean;
  /** The hour shown, 0 being now. */
  index: number;
  onIndex: (index: number) => void;
  /** Back to now, softly. */
  onReturn: () => void;
  /** Words for the hour at `i`, for screen readers. */
  describe: (i: number) => string;
}

/**
 * The next day, hour by hour: a smooth line of temperatures over bars of the
 * chance of rain. It's a slider: drag, hover or use the arrow keys to read
 * an hour in the headline; let go and it springs back to now.
 */
export function HourStrip({
  hours,
  imperial,
  index,
  onIndex,
  onReturn,
  describe,
  locale,
}: HourStripProps) {
  const n = hours.length;
  const geometry = useMemo(() => {
    const temps = hours.map((h) => h.temp);
    const lo = Math.min(...temps);
    const hi = Math.max(...temps);
    const span = Math.max(hi - lo, imperial ? 6 : 3);
    const mid = (hi + lo) / 2;
    const inner = 1 - PAD_TOP - PAD_BOTTOM;
    const yOf = (t: number) => (PAD_TOP + (0.5 - (t - mid) / span) * inner) * H;
    const xOf = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * W);
    const points = hours.map((h, i) => [xOf(i), yOf(h.temp)] as const);
    const line = smoothPath(points);
    const area = n > 1 ? `${line}L${W},${H}L0,${H}Z` : '';
    return { points, line, area, xOf, yOf };
  }, [hours, imperial, n]);

  const id = `wx-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`;
  const pressing = useRef(false);
  const returning = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(returning.current), []);

  const indexAt = (event: PointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (!box.width || n < 2) return 0;
    const f = (event.clientX - box.left) / box.width;
    return Math.min(n - 1, Math.max(0, Math.round(f * (n - 1))));
  };

  const at = hours[index];
  const pct = (i: number) => `${(n <= 1 ? 0.5 : i / (n - 1)) * 100}%`;
  const y = at ? geometry.yOf(at.temp) / H : 0.5;

  return (
    <div className={styles.strip} data-hours={n}>
      <svg
        className={styles.curve}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        aria-hidden
        focusable="false"
      >
        <defs>
          <linearGradient id={`${id}-line`} x1="0" x2="1" y1="0" y2="0">
            {hours.map((h, i) => (
              <stop
                key={h.time}
                className={styles.stop}
                offset={n <= 1 ? 0 : i / (n - 1)}
                style={{ '--h': tempHue(toCelsius(h.temp, imperial)) } as CSSProperties}
              />
            ))}
          </linearGradient>
          <linearGradient id={`${id}-fill`} x1="0" x2="0" y1="0" y2="1">
            <stop className={styles.fillTop} offset="0" />
            <stop className={styles.fillBottom} offset="1" />
          </linearGradient>
        </defs>
        {geometry.area && (
          <path className={styles.area} d={geometry.area} fill={`url(#${id}-fill)`} />
        )}
        <path
          className={styles.line}
          d={geometry.line}
          stroke={`url(#${id}-line)`}
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      {/* The chance of rain, as bars under the line. */}
      <div className={styles.bars} aria-hidden>
        {hours.map((h, i) =>
          (h.precipProb ?? 0) < 5 ? null : (
            <span
              key={h.time}
              className={styles.bar}
              data-on={i === index || undefined}
              style={
                {
                  '--x': pct(i),
                  '--p': Math.max(0, Math.min(100, h.precipProb ?? 0)) / 100,
                } as CSSProperties
              }
            />
          ),
        )}
      </div>

      {/* Every third hour's temperature over the line, and its time under the bars. */}
      <div className={styles.marks} aria-hidden>
        {hours.map((h, i) =>
          i % 3 === 0 ? (
            <span
              key={h.time}
              className={styles.mark}
              data-sixth={i % 6 === 0 || undefined}
              style={
                {
                  '--x': pct(i),
                  '--y': geometry.yOf(h.temp) / H,
                } as CSSProperties
              }
            >
              <span className={styles.markTemp}>{Math.round(h.temp)}°</span>
              <span className={styles.markTime}>
                {i === 0 ? 'Now' : hourLabel(h.time, { locale })}
              </span>
            </span>
          ) : null,
        )}
      </div>

      <SliderPrimitive.Root
        className={styles.scrub}
        min={0}
        max={Math.max(0, n - 1)}
        step={1}
        value={[index]}
        data-away={index !== 0 || undefined}
        onValueChange={([next = 0]) => {
          clearTimeout(returning.current);
          onIndex(next);
        }}
        onPointerDown={() => {
          pressing.current = true;
          clearTimeout(returning.current);
        }}
        onPointerMove={(event) => {
          // A mouse reads an hour by passing over it; a finger has to press.
          if (event.pointerType !== 'mouse' || event.buttons !== 0) return;
          clearTimeout(returning.current);
          const next = indexAt(event);
          if (next !== index) onIndex(next);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse' && event.buttons === 0) onReturn();
        }}
        onPointerUp={(event) => {
          if (!pressing.current) return;
          pressing.current = false;
          if (event.pointerType === 'mouse') return;
          clearTimeout(returning.current);
          returning.current = setTimeout(onReturn, 500);
        }}
      >
        <SliderPrimitive.Track className={styles.scrubTrack} />
        <SliderPrimitive.Thumb
          className={styles.thumb}
          aria-label="Hour by hour"
          aria-valuetext={describe(index)}
          style={{ '--y': y } as CSSProperties}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && index !== 0) {
              event.stopPropagation();
              onReturn();
            }
          }}
          onBlur={() => {
            if (!pressing.current) onReturn();
          }}
        >
          <span className={styles.thumbDot} />
        </SliderPrimitive.Thumb>
      </SliderPrimitive.Root>
    </div>
  );
}
