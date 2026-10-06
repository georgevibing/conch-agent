import { useId, type ComponentProps, type CSSProperties } from 'react';

import { cx } from '../../utils/cx';
import { monotonePath, niceCeiling, runs, type Point } from './curve';
import styles from './LiveChart.module.css';
import { useGlide } from './useGlide';

export interface SparklineProps extends Omit<ComponentProps<'svg'>, 'children' | 'values'> {
  /** Oldest first; `null` is a gap. */
  values: readonly (number | null)[];
  /** The top of the scale (100 for a share). Left out, it fits the values. */
  max?: number;
  /** A colour; the first chart series by default. */
  color?: string;
  /** Height in pixels; it fills the width it's given. Default 28. */
  height?: number;
  /**
   * Words for it (`Processor, last 3 minutes, now 12%`). Without them it's
   * decorative: put the number it stands for beside it.
   */
  label?: string;
  /**
   * When the newest value was read (ms). Given, the line glides left as
   * values arrive instead of jumping; `intervalMs` is how often they do.
   */
  latest?: number;
  intervalMs?: number;
}

const VIEW_W = 100;

/**
 * A trend in the space of a word: a smooth 2 px line over a faint wash, the
 * newest value at the right edge with a small ringed dot. No axes, no
 * numbers: it says "rising" or "steady" next to the number that matters.
 */
export function Sparkline({
  values,
  max,
  color = 'var(--nc-chart-1)',
  height = 28,
  label,
  latest,
  intervalMs = 2000,
  className,
  style,
  ...props
}: SparklineProps) {
  const id = useId();
  const n = Math.max(values.length, 2);
  const step = VIEW_W / (n - 1);
  const top = max ?? niceCeiling(Math.max(0, ...values.map((v) => v ?? 0)) * 1.1);
  const pad = 3;
  const x = (i: number) => VIEW_W - (values.length - 1 - i) * step;
  const y = (v: number) => pad + (height - pad * 2) * (1 - Math.min(Math.max(v, 0), top) / top);
  const pieces = runs(values.map((v, i) => (v == null ? null : ([x(i), y(v)] as Point))));
  const lines = pieces.map((piece) => monotonePath(piece.items));
  const lastIndex = values.findLastIndex((v) => v != null);
  const glide = useGlide<SVGGElement>(latest, () => step, intervalMs, VIEW_W / 3);

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${height}`}
      preserveAspectRatio="none"
      height={height}
      className={cx(styles.spark, className)}
      style={{ '--lc-spark': color, ...style } as CSSProperties}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      {...props}
    >
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.16} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
        <clipPath id={`${id}-clip`}>
          <rect x={0} y={0} width={VIEW_W} height={height} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id}-clip)`}>
        <g ref={glide} className={styles.glide}>
          {pieces.map((piece, i) => {
            const firstX = piece.items[0]?.[0] ?? 0;
            const lastX = piece.items.at(-1)?.[0] ?? 0;
            return (
              <path
                key={`a${i}`}
                d={`${lines[i]}L${lastX},${height}L${firstX},${height}Z`}
                fill={`url(#${id})`}
              />
            );
          })}
          {lines.map((d, i) => (
            <path key={`l${i}`} d={d} className={styles.sparkLine} />
          ))}
        </g>
      </g>
      {lastIndex >= 0 && (
        // A dot as a round cap on a stroke that doesn't stretch with the
        // width, so it stays a circle: a ring of the surface, then the colour.
        <g className={styles.sparkEnd}>
          <path d={`M${x(lastIndex)},${y(values[lastIndex] ?? 0)}h0`} data-ring="" />
          <path d={`M${x(lastIndex)},${y(values[lastIndex] ?? 0)}h0`} />
        </g>
      )}
    </svg>
  );
}
