import type { ReactNode } from 'react';

import styles from './AgentAvatar.module.css';

/**
 * The cast (ADR 0101): seventeen small characters for the presets, drawn the
 * same way so they read as one — a porcelain-white figure on a glazed tile of
 * one of the app colours, two dark eyes with a glint, a small smile, a blush.
 *
 * Each is a 64-unit square that fills its tile. Everything that matters stays
 * inside the middle 52 units. The parts marked `detail` fall away at the two
 * smallest sizes, where they'd only be noise.
 *
 * Colours are never written here: the figure (`body`), its shadows (`shade`),
 * its features (`ink`) and its blush (`cheek`) are the tile's colour mixed in
 * CSS, so every face follows light and dark and any of the thirteen colours.
 */

const c = styles;

/** Two eyes with a glint, a smile and a blush, centred on (x, y). */
function Face({
  x = 32,
  y = 32,
  gap = 10,
  eyes = 'open',
  smile = 1,
}: {
  x?: number;
  y?: number;
  gap?: number;
  /** `happy`: closed upward arcs; `sleepy`: closed downward arcs; `wink`: the left one closed. */
  eyes?: 'open' | 'happy' | 'sleepy' | 'wink';
  /** How wide the smile is (1 is the usual). */
  smile?: number;
}) {
  const l = x - gap / 2;
  const r = x + gap / 2;
  const open = (cx: number) => (
    <g key={cx}>
      <ellipse className={c.ink} cx={cx} cy={y} rx={2.15} ry={2.7} />
      <circle className={c.glint} cx={cx + 0.75} cy={y - 0.95} r={0.8} />
    </g>
  );
  const arc = (cx: number, up: boolean) => (
    <path
      key={cx}
      className={c.line}
      d={up ? `M${cx - 2.4} ${y + 0.8} q2.4 -3 4.8 0` : `M${cx - 2.4} ${y - 0.4} q2.4 2.6 4.8 0`}
    />
  );
  const w = 3.6 * smile;
  return (
    <g>
      <ellipse className={`${c.cheek} ${c.detail}`} cx={l - 2.6} cy={y + 4.6} rx={2.5} ry={1.5} />
      <ellipse className={`${c.cheek} ${c.detail}`} cx={r + 2.6} cy={y + 4.6} rx={2.5} ry={1.5} />
      {eyes === 'open' && [open(l), open(r)]}
      {eyes === 'happy' && [arc(l, true), arc(r, true)]}
      {eyes === 'sleepy' && [arc(l, false), arc(r, false)]}
      {eyes === 'wink' && [arc(l, true), open(r)]}
      <path className={c.line} d={`M${x - w} ${y + 4.6} q${w} ${3.4 * smile} ${w * 2} 0`} />
    </g>
  );
}

/** A small four-point twinkle, for the sky around a few of them. */
function Twinkle({ x, y, r = 3 }: { x: number; y: number; r?: number }) {
  const k = r * 0.28;
  return (
    <path
      className={`${c.body} ${c.detail}`}
      d={`M${x} ${y - r} Q${x + k} ${y - k} ${x + r} ${y} Q${x + k} ${y + k} ${x} ${y + r} Q${x - k} ${y + k} ${x - r} ${y} Q${x - k} ${y - k} ${x} ${y - r}Z`}
    />
  );
}

/**
 * Each preset's figure, by id (`shell` is Conch's own mark, so it has none).
 */
export const FIGURES = {
  pearl: () => (
    <>
      <path
        className={`${c.shade} ${c.detail}`}
        d="M12 31 C13.5 17 21.5 9.5 32 9.5 C42.5 9.5 50.5 17 52 31 C46 27.5 39.5 26 32 26 C24.5 26 18 27.5 12 31Z"
      />
      <circle className={c.body} cx={32} cy={33} r={13.5} />
      <ellipse className={c.glint} cx={26.4} cy={26.6} rx={3.4} ry={2.2} opacity={0.9} />
      <Face y={32} gap={9} />
      <path
        className={c.shade}
        d="M8 41 C10.5 52.5 20 58 32 58 C44 58 53.5 52.5 56 41 C49 44 41 45.5 32 45.5 C23 45.5 15 44 8 41Z"
      />
      <g className={`${c.ridge} ${c.detail}`}>
        <path d="M20 47.5 L22 54" />
        <path d="M32 49 V56.5" />
        <path d="M44 47.5 L42 54" />
      </g>
    </>
  ),
  wave: () => (
    <>
      <path
        className={c.body}
        d="M8 48 V41 C8 26.5 19 16 33 16 C46 16 56 25.5 56 37 V48 C52 51.4 48 51.4 44 48 C40 51.4 36 51.4 32 48 C28 51.4 24 51.4 20 48 C16 51.4 12 51.4 8 48Z"
      />
      <path
        className={c.curl}
        d="M51 39 C54 32.5 50.5 24 42.5 24 C36.5 24 33.4 29 35.2 33 C36.8 36.4 41.4 35.8 41.6 32.4"
      />
      <circle className={`${c.shade} ${c.detail}`} cx={14} cy={23} r={2.2} />
      <circle className={`${c.shade} ${c.detail}`} cx={20.5} cy={17.5} r={1.5} />
      <Face x={22} y={36} gap={9} />
    </>
  ),
  coral: () => (
    <>
      <g className={c.branch}>
        <path d="M32 44 V15" />
        <path d="M32 38 C23 38 18.5 33 18.5 23" />
        <path d="M32 34 C41 34 45.5 29 45.5 19" />
        <path d="M18.5 29 C14.5 28 12.5 25.5 12.5 21.5" />
        <path d="M45.5 26 C49.5 25 51.5 22.5 51.5 18.5" />
      </g>
      <g className={c.detail}>
        <circle className={c.shade} cx={32} cy={21} r={1.3} />
        <circle className={c.shade} cx={19.5} cy={27} r={1.1} />
        <circle className={c.shade} cx={45} cy={24} r={1.1} />
      </g>
      <path
        className={c.body}
        d="M17 46 C17 39.5 23.5 35.5 32 35.5 C40.5 35.5 47 39.5 47 46 C47 52 40.5 55 32 55 C23.5 55 17 52 17 46Z"
      />
      <Face y={44} gap={9} smile={0.9} />
    </>
  ),
  spark: () => (
    <>
      <path
        className={c.body}
        d="M32 7 Q38.5 23.5 55 30 Q38.5 36.5 32 53 Q25.5 36.5 9 30 Q25.5 23.5 32 7Z"
      />
      <Twinkle x={50} y={48} r={4} />
      <Twinkle x={14} y={13} r={3} />
      <Face y={29} gap={9} eyes="wink" smile={0.9} />
    </>
  ),
  leaf: () => (
    <>
      <path className={c.stem} d="M9 55 L17 47" />
      <path className={c.body} d="M13 51 C13 29 27 14 52 12 C51 37 36 51 13 51Z" />
      <g className={`${c.ridge} ${c.detail}`}>
        <path d="M38 27 L47.5 17.5" />
        <path d="M42 24.2 L41.4 18.6" />
        <path d="M44 22.2 L49 21.8" />
      </g>
      <Face x={29} y={34} gap={9} />
    </>
  ),
  moon: () => (
    <>
      <path
        className={c.body}
        d="M32.75 12.19 A20 20 0 1 0 49.35 37.07 A15 15 0 0 1 32.75 12.19Z"
      />
      <Twinkle x={48} y={14} r={3.4} />
      <Twinkle x={55} y={26} r={2.2} />
      <Face x={22} y={34} gap={8.5} eyes="sleepy" smile={0.85} />
    </>
  ),
  sun: () => (
    <>
      <g className={c.ray}>
        {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
          <path key={angle} d="M32 13.5 V8" transform={`rotate(${angle} 32 32)`} />
        ))}
      </g>
      <circle className={c.body} cx={32} cy={32} r={14} />
      <Face y={31} gap={9.5} eyes="happy" />
    </>
  ),
  star: () => (
    <>
      <path
        className={c.rounded}
        d="M32 12 L38.17 25.51 L52.92 27.2 L41.99 37.24 L44.93 51.8 L32 44.5 L19.07 51.8 L22.01 37.24 L11.08 27.2 L25.83 25.51Z"
      />
      <Twinkle x={52} y={12} r={3} />
      <Face y={32} gap={9} />
    </>
  ),
  cloud: () => (
    <>
      <path
        className={c.body}
        d="M19.5 47 C13 47 8.5 42.5 8.5 37 C8.5 31 13.5 26.5 19.5 27.5 C20.5 20 26.5 15 33.5 15 C41.5 15 47.5 21 47.5 28.5 C52.5 28.5 56 32.5 56 37.5 C56 43 52 47 46.5 47Z"
      />
      <g className={c.detail}>
        <path className={c.drop} d="M22 52 q1.6 2.6 0 4 q-1.6 -1.4 0 -4Z" />
        <path className={c.drop} d="M33 53 q1.6 2.6 0 4 q-1.6 -1.4 0 -4Z" />
        <path className={c.drop} d="M44 52 q1.6 2.6 0 4 q-1.6 -1.4 0 -4Z" />
      </g>
      <Face x={32} y={34} gap={10} />
    </>
  ),
  flame: () => (
    <>
      <path
        className={c.body}
        d="M32 7.5 C35.5 16.5 46.5 23.5 47.5 37 C48.4 48.5 41 56 32 56 C23 56 15.6 49 16.6 39 C17.4 31 22.6 27 25 20.5 C28 24.5 29.4 27.6 31.2 28.6 C31 22 30 14.5 32 7.5Z"
      />
      <Face y={41} gap={9} />
    </>
  ),
  feather: () => (
    <>
      <path className={c.stem} d="M20 48 L11 57" />
      <path
        className={c.body}
        d="M51 9 C37 10 22.5 20 18.4 36.5 C17.2 41.6 17.8 45.6 20 48 C24.4 49.2 30.4 48.2 35 45 C47 37 53.2 23.6 51 9Z"
      />
      <g className={`${c.ridge} ${c.detail}`}>
        <path d="M36.5 29 C41 23.5 45.5 17.5 49.5 11" />
        <path d="M45.2 30.4 L41 27.6" />
        <path d="M36 14.6 L39.4 19.4" />
      </g>
      <Face x={28} y={35} gap={8.5} smile={0.9} />
    </>
  ),
  compass: () => (
    <>
      <circle className={c.shade} cx={32} cy={33} r={21} />
      <circle className={c.body} cx={32} cy={33} r={16.5} />
      <path className={c.needle} d="M32 7.5 L36 15.5 H28Z" />
      <g className={`${c.tick} ${c.detail}`}>
        <path d="M32 18.6 V21" />
        <path d="M32 45 V47.4" />
        <path d="M17.6 33 H20" />
        <path d="M44 33 H46.4" />
      </g>
      <Face y={32} gap={9.5} />
    </>
  ),
  orbit: () => (
    <>
      <g transform="rotate(-16 32 32)">
        <path className={c.ring} d="M7 32 A25 7.5 0 0 1 57 32" />
      </g>
      <circle className={c.body} cx={32} cy={32} r={14.5} />
      <Face y={29} gap={9} />
      <g transform="rotate(-16 32 32)">
        <path className={c.ring} d="M57 32 A25 7.5 0 0 1 7 32" />
      </g>
      <circle className={`${c.body} ${c.detail}`} cx={52} cy={14} r={2.6} />
    </>
  ),
  owl: () => (
    <>
      <path className={c.body} d="M17.5 19 L19.5 8.5 L27 15Z" />
      <path className={c.body} d="M46.5 19 L44.5 8.5 L37 15Z" />
      <path
        className={c.body}
        d="M32 12.5 C44 12.5 50.5 22 50.5 34 C50.5 46.5 42.5 54.5 32 54.5 C21.5 54.5 13.5 46.5 13.5 34 C13.5 22 20 12.5 32 12.5Z"
      />
      <circle className={c.shade} cx={24.6} cy={30} r={7.2} />
      <circle className={c.shade} cx={39.4} cy={30} r={7.2} />
      <circle className={c.ink} cx={24.6} cy={30} r={3.3} />
      <circle className={c.ink} cx={39.4} cy={30} r={3.3} />
      <circle className={c.glint} cx={25.8} cy={28.7} r={1.1} />
      <circle className={c.glint} cx={40.6} cy={28.7} r={1.1} />
      <path className={c.ink} d="M32 35.5 L29.2 39.4 L32 42.8 L34.8 39.4Z" />
      <g className={`${c.ridge} ${c.detail}`}>
        <path d="M25.6 46.4 q2.2 2.2 4.4 0" />
        <path d="M34 46.4 q2.2 2.2 4.4 0" />
        <path d="M29.8 50 q2.2 2.2 4.4 0" />
      </g>
    </>
  ),
  fox: () => (
    <>
      <path
        className={c.shade}
        d="M32 54 C23.5 52.6 13.4 43.6 12.4 32.6 L10.6 11.6 L23.4 20.6 C26.2 19.4 29 18.8 32 18.8 C35 18.8 37.8 19.4 40.6 20.6 L53.4 11.6 L51.6 32.6 C50.6 43.6 40.5 52.6 32 54Z"
      />
      <path className={c.body} d="M14.2 17 L21.4 22.2 L15.4 28Z" />
      <path className={c.body} d="M49.8 17 L42.6 22.2 L48.6 28Z" />
      <path
        className={c.body}
        d="M32 54 C24.6 52.8 16 46 13.4 36.4 C19.6 35.8 26 38.4 32 43.6 C38 38.4 44.4 35.8 50.6 36.4 C48 46 39.4 52.8 32 54Z"
      />
      <ellipse className={c.ink} cx={24.8} cy={32.4} rx={2.15} ry={2.7} />
      <ellipse className={c.ink} cx={39.2} cy={32.4} rx={2.15} ry={2.7} />
      <circle className={c.glint} cx={25.55} cy={31.45} r={0.8} />
      <circle className={c.glint} cx={39.95} cy={31.45} r={0.8} />
      <ellipse className={c.ink} cx={32} cy={44.4} rx={2.9} ry={2} />
      <path className={c.line} d="M29 48.2 q3 2.4 6 0" />
      <ellipse className={`${c.cheek} ${c.detail}`} cx={21} cy={41.6} rx={2.4} ry={1.4} />
      <ellipse className={`${c.cheek} ${c.detail}`} cx={43} cy={41.6} rx={2.4} ry={1.4} />
    </>
  ),
  cat: () => (
    <>
      <path
        className={c.body}
        d="M13.5 31 C13.5 21 17.5 14.5 19.6 9.6 L27.2 17.8 C28.8 17.4 30.4 17.2 32 17.2 C33.6 17.2 35.2 17.4 36.8 17.8 L44.4 9.6 C46.5 14.5 50.5 21 50.5 31 C50.5 44.5 42.5 53 32 53 C21.5 53 13.5 44.5 13.5 31Z"
      />
      <path className={c.shade} d="M20.4 14.4 L25 19.4 L18.8 22Z" />
      <path className={c.shade} d="M43.6 14.4 L39 19.4 L45.2 22Z" />
      <ellipse className={c.ink} cx={25} cy={32} rx={2.3} ry={3} />
      <ellipse className={c.ink} cx={39} cy={32} rx={2.3} ry={3} />
      <circle className={c.glint} cx={25.8} cy={30.9} r={0.85} />
      <circle className={c.glint} cx={39.8} cy={30.9} r={0.85} />
      <path className={c.ink} d="M29.8 38 H34.2 L32 40.6Z" />
      <path className={c.line} d="M32 40.6 q-1.6 3.2 -4.4 1.6 M32 40.6 q1.6 3.2 4.4 1.6" />
      <g className={`${c.whisker} ${c.detail}`}>
        <path d="M9.5 37 L19.5 38.4" />
        <path d="M10 42.6 L19.6 41.4" />
        <path d="M54.5 37 L44.5 38.4" />
        <path d="M54 42.6 L44.4 41.4" />
      </g>
      <ellipse className={`${c.cheek} ${c.detail}`} cx={21} cy={39} rx={2.4} ry={1.5} />
      <ellipse className={`${c.cheek} ${c.detail}`} cx={43} cy={39} rx={2.4} ry={1.5} />
    </>
  ),
  bot: () => (
    <>
      <path className={c.stem} d="M32 16 V10.5" />
      <circle className={c.cheek} cx={32} cy={8.6} r={3.2} />
      <rect className={c.shade} x={8.6} y={26} width={6} height={13} rx={2.4} />
      <rect className={c.shade} x={49.4} y={26} width={6} height={13} rx={2.4} />
      <rect className={c.body} x={12.5} y={15.5} width={39} height={34} rx={11} />
      <rect className={c.screen} x={18} y={22} width={28} height={21} rx={7} />
      <rect className={c.lamp} x={22.6} y={27.4} width={5} height={6.4} rx={2.5} />
      <rect className={c.lamp} x={36.4} y={27.4} width={5} height={6.4} rx={2.5} />
      <path className={c.lampLine} d="M28 37.4 q4 3 8 0" />
      <g className={c.detail}>
        <circle className={c.shade} cx={24} cy={54} r={1.4} />
        <circle className={c.shade} cx={32} cy={54} r={1.4} />
        <circle className={c.shade} cx={40} cy={54} r={1.4} />
      </g>
    </>
  ),
} satisfies Record<string, () => ReactNode>;
