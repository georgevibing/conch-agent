import { useId, type CSSProperties } from 'react';

import { cx } from '../../utils/cx';
import type { Condition, SkyTime } from './sky';
import styles from './Weather.module.css';

/*
 * The sky's picture, drawn here, never fetched: a sun whose rays turn
 * slowly, a moon, clouds that drift in layers, rain, snow, a rare flicker of
 * lightning and bands of fog. Only transform and opacity move, and nothing
 * moves under reduced motion. Decorative: the words say what the sky is.
 */

const v = (i: number) => ({ '--i': i }) as CSSProperties;

/** A cloud: a soft base and three rounded tops, with a shade beneath for depth. */
function Cloud({
  x,
  y,
  scale = 1,
  tone = 'front',
  className,
}: {
  x: number;
  y: number;
  scale?: number;
  tone?: 'front' | 'back' | 'dark';
  className?: string;
}) {
  const shape = (
    <>
      <rect x="4" y="22" width="72" height="20" rx="10" />
      <circle cx="24" cy="26" r="13" />
      <circle cx="45" cy="19" r="17" />
      <circle cx="63" cy="29" r="11" />
    </>
  );
  return (
    <g className={cx(styles.cloud, className)} data-tone={tone}>
      <g transform={`translate(${x} ${y}) scale(${scale})`}>
        <g className={styles.cloudShade} transform="translate(0 3)">
          {shape}
        </g>
        <g className={styles.cloudBody}>{shape}</g>
      </g>
    </g>
  );
}

const safeId = (id: string) => id.replace(/[^a-zA-Z0-9-]/g, '');

/** A soft round light: strongest at its heart, gone at its edge. */
function Glow({ id, stop }: { id: string; stop?: string }) {
  return (
    <radialGradient id={id}>
      <stop className={stop} offset="0" stopOpacity="1" />
      <stop className={stop} offset="0.55" stopOpacity="0.45" />
      <stop className={stop} offset="1" stopOpacity="0" />
    </radialGradient>
  );
}

function Sun({ cx: x, cy: y, r = 16 }: { cx: number; cy: number; r?: number }) {
  const origin = { transformOrigin: `${x}px ${y}px` } as CSSProperties;
  const id = `wx-sun-${safeId(useId())}`;
  return (
    <g className={styles.sun}>
      <Glow id={id} stop={styles.glowStop} />
      <circle className={styles.sunGlow} cx={x} cy={y} r={r * 2.4} fill={`url(#${id})`} />
      <g className={styles.rays} style={origin}>
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i * Math.PI) / 4;
          return (
            <line
              key={i}
              x1={x + Math.cos(a) * (r + 6)}
              y1={y + Math.sin(a) * (r + 6)}
              x2={x + Math.cos(a) * (r + 12)}
              y2={y + Math.sin(a) * (r + 12)}
            />
          );
        })}
      </g>
      <circle className={styles.sunDisc} cx={x} cy={y} r={r} />
    </g>
  );
}

function Moon({ cx: x, cy: y, r = 15 }: { cx: number; cy: number; r?: number }) {
  const id = `wx-moon-${safeId(useId())}`;
  return (
    <g className={styles.moon}>
      <Glow id={`${id}-glow`} stop={styles.moonGlowStop} />
      <mask id={id}>
        <rect x="0" y="0" width="160" height="120" fill="white" />
        <circle cx={x + r * 0.55} cy={y - r * 0.45} r={r * 0.92} fill="black" />
      </mask>
      <circle className={styles.moonGlow} cx={x} cy={y} r={r * 2.2} fill={`url(#${id}-glow)`} />
      <circle className={styles.moonDisc} cx={x} cy={y} r={r} mask={`url(#${id})`} />
    </g>
  );
}

const STARS: [number, number, number][] = [
  [20, 18, 1.4],
  [44, 40, 1],
  [66, 14, 1.2],
  [132, 22, 1],
  [146, 58, 1.3],
  [30, 70, 0.9],
  [120, 90, 1],
];

/** Rain: thin streaks falling at a slant, more of them the heavier it is. */
function Rain({ count, short = false }: { count: number; short?: boolean }) {
  return (
    <g className={styles.rain} data-short={short || undefined}>
      {Array.from({ length: count }, (_, i) => {
        const x = 52 + ((i * 37) % 64);
        const y = 78 + ((i * 11) % 8);
        return (
          <line
            key={i}
            className={styles.drop}
            style={v(i)}
            x1={x}
            y1={y}
            x2={x - 3}
            y2={y + (short ? 6 : 11)}
          />
        );
      })}
    </g>
  );
}

function Snow({ count }: { count: number }) {
  return (
    <g className={styles.snow}>
      {Array.from({ length: count }, (_, i) => (
        <circle
          key={i}
          className={styles.flake}
          style={v(i)}
          cx={50 + ((i * 29) % 66)}
          cy={74 + ((i * 13) % 10)}
          r={i % 3 === 0 ? 2.6 : 2}
        />
      ))}
    </g>
  );
}

function Fog() {
  return (
    <g className={styles.fog}>
      {[
        [30, 54, 96],
        [46, 68, 84],
        [24, 82, 104],
        [52, 96, 72],
      ].map(([x, y, w], i) => (
        <rect
          key={i}
          className={styles.band}
          style={v(i)}
          x={x}
          y={y}
          width={w}
          height="6"
          rx="3"
        />
      ))}
    </g>
  );
}

export interface WeatherArtProps {
  condition: Condition;
  time: SkyTime;
  /** 1–3: how much rain or snow. */
  intensity?: 1 | 2 | 3;
  /** Draw only the middle, for a small glyph. */
  crop?: boolean;
  className?: string;
}

/** The sky's condition, drawn: decorative, so hidden from screen readers. */
export function WeatherArt({
  condition,
  time,
  intensity = 1,
  crop = false,
  className,
}: WeatherArtProps) {
  const night = time === 'night';
  const light = night ? <Moon cx={104} cy={40} /> : <Sun cx={104} cy={42} />;
  const wet = ['drizzle', 'rain', 'sleet', 'snow', 'storm'].includes(condition);
  const drops = [4, 7, 10][intensity - 1] ?? 4;
  return (
    <svg
      className={cx(styles.art, className)}
      data-condition={condition}
      viewBox={crop ? '24 8 116 100' : '0 0 160 120'}
      aria-hidden
      focusable="false"
    >
      {night && (condition === 'clear' || condition === 'partly') && (
        <g className={styles.stars}>
          {STARS.map(([x, y, r], i) => (
            <circle key={i} className={styles.star} style={v(i)} cx={x} cy={y} r={r} />
          ))}
        </g>
      )}
      {condition === 'clear' &&
        (night ? <Moon cx={96} cy={52} r={19} /> : <Sun cx={92} cy={56} r={20} />)}
      {condition === 'partly' && (
        <>
          {light}
          <Cloud x={34} y={50} scale={1.05} className={styles.drift} />
        </>
      )}
      {condition === 'cloudy' && (
        <>
          {light}
          <Cloud x={70} y={22} scale={0.8} tone="back" className={styles.driftSlow} />
          <Cloud x={30} y={46} scale={1.1} className={styles.drift} />
        </>
      )}
      {condition === 'overcast' && (
        <>
          <Cloud x={66} y={18} scale={0.95} tone="back" className={styles.driftSlow} />
          <Cloud x={22} y={44} scale={1.2} className={styles.drift} />
        </>
      )}
      {condition === 'fog' && (
        <>
          <Cloud x={50} y={18} scale={0.9} tone="back" className={styles.driftSlow} />
          <Fog />
        </>
      )}
      {wet && (
        <>
          <Cloud
            x={66}
            y={8}
            scale={0.8}
            tone={condition === 'storm' ? 'dark' : 'back'}
            className={styles.driftSlow}
          />
          {condition === 'storm' && (
            <polygon
              className={styles.bolt}
              points="92,60 80,86 91,86 84,108 104,78 93,78 100,60"
            />
          )}
          {(condition === 'rain' || condition === 'storm' || condition === 'sleet') && (
            <Rain count={condition === 'sleet' ? 4 : drops} />
          )}
          {condition === 'drizzle' && <Rain count={drops} short />}
          {(condition === 'snow' || condition === 'sleet') && (
            <Snow count={condition === 'sleet' ? 3 : drops - 1} />
          )}
          <Cloud
            x={28}
            y={28}
            scale={1.15}
            tone={condition === 'storm' ? 'dark' : 'front'}
            className={styles.drift}
          />
        </>
      )}
    </svg>
  );
}

/** A small, still glyph of a condition, for a day's row. */
export function ConditionGlyph({
  condition,
  night = false,
  className,
}: {
  condition: Condition;
  night?: boolean;
  className?: string;
}) {
  return (
    <WeatherArt
      condition={condition}
      time={night ? 'night' : 'day'}
      crop
      className={cx(styles.glyph, className)}
    />
  );
}
