import type { ComponentProps, ReactNode } from 'react';

import { cx } from '../../utils/cx';
import styles from './FamilyGlyph.module.css';
import type { StoryFamily } from './types';

export interface FamilyGlyphProps extends Omit<ComponentProps<'svg'>, 'children'> {
  family: StoryFamily;
  /**
   * The work is happening now: one part of the glyph moves, quietly — the
   * lens scans, the pen writes, the cursor blinks, the globe turns. Still
   * under reduced motion.
   */
  active?: boolean;
}

/**
 * Drawn on lucide's grid (24 units, 2-unit round strokes) so they sit beside
 * every other icon in Nacre. Each glyph has one `live` part: the bit that
 * moves while the work runs.
 */
const GLYPHS: Record<StoryFamily, ReactNode> = {
  // A page, and a lens that scans it.
  explore: (
    <>
      <path d="M13 21H6.5A2.5 2.5 0 0 1 4 18.5v-13A2.5 2.5 0 0 1 6.5 3H13l5 5v1.5" />
      <path d="M8 8.5h4M8 12.5h2.5" />
      <g data-part="lens">
        <circle cx="16" cy="16" r="3.25" />
        <path d="m18.5 18.5 2.5 2.5" />
      </g>
    </>
  ),
  // A pen that writes its line.
  edit: (
    <>
      <path
        data-part="pen"
        d="M16.6 3.6a2.05 2.05 0 0 1 2.9 2.9L8.3 17.7a2 2 0 0 1-.9.52l-3.1.86.86-3.1a2 2 0 0 1 .52-.9z"
      />
      <path data-part="ink" d="M13 21h7" pathLength={1} />
    </>
  ),
  // A prompt and its blinking cursor.
  run: (
    <>
      <path d="m4.5 17 5.5-5-5.5-5" />
      <path data-part="cursor" d="M13 18.5h6.5" />
    </>
  ),
  // A shield whose tick draws itself.
  verify: (
    <>
      <path d="M20 12.8c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.3 4 17.8 4 12.8V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path data-part="tick" d="m8.75 12.25 2.25 2.25 4.25-4.5" pathLength={1} />
    </>
  ),
  // An arrow lifting out of its tray.
  ship: (
    <>
      <path d="M4 15v3.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V15" />
      <g data-part="lift">
        <path d="M12 15V3.5" />
        <path d="m7.5 8 4.5-4.5L16.5 8" />
      </g>
    </>
  ),
  // The world, turning.
  research: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path data-part="meridian" d="M12 3a13.5 13.5 0 0 1 0 18a13.5 13.5 0 0 1 0-18" />
    </>
  ),
  // A pointer that taps.
  browse: (
    <>
      <path
        data-part="tap"
        d="M4.6 4.1a.6.6 0 0 1 .8-.8l13.9 5.7a.6.6 0 0 1-.08 1.14l-5.3 1.37a2 2 0 0 0-1.43 1.43l-1.37 5.3a.6.6 0 0 1-1.14.08z"
      />
      <path data-part="ripple" d="M15.5 15.5 20 20" />
    </>
  ),
  // Apps: three tiles and one that breathes.
  connect: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
      <circle data-part="tile" cx="17" cy="17" r="3.5" />
    </>
  ),
  // Something made: a spark and its small twin, which twinkles.
  make: (
    <>
      <path d="M10 3c.55 3.4 2.6 5.45 6 6-3.4.55-5.45 2.6-6 6-.55-3.4-2.6-5.45-6-6 3.4-.55 5.45-2.6 6-6z" />
      <path
        data-part="twinkle"
        d="M18 14.5c.3 1.6 1.15 2.45 2.75 2.75-1.6.3-2.45 1.15-2.75 2.75-.3-1.6-1.15-2.45-2.75-2.75 1.6-.3 2.45-1.15 2.75-2.75z"
      />
    </>
  ),
  // A list, its first line ticked as you watch.
  plan: (
    <>
      <path d="M11 6.5h9M11 12h9M11 17.5h9" />
      <path data-part="tick" d="m3.75 6.5 1.5 1.5 2.75-3" pathLength={1} />
      <path d="M5.5 12h.01M5.5 17.5h.01" />
    </>
  ),
  // A paper plane, sent on its way.
  delegate: (
    <g data-part="fly">
      <path d="M14.54 20.69a.5.5 0 0 0 .94-.03l5.5-16.1a.5.5 0 0 0-.64-.64l-16.1 5.5a.5.5 0 0 0-.03.94l6.73 2.7a2 2 0 0 1 1.11 1.11z" />
      <path d="m20.85 4.15-9.9 9.9" />
    </g>
  ),
  // A bookmark: kept for later.
  remember: (
    <>
      <path d="M18.5 20.5 12 16.75 5.5 20.5V5.5A2.5 2.5 0 0 1 8 3h8a2.5 2.5 0 0 1 2.5 2.5z" />
      <path data-part="keep" d="M9.5 8.5h5" pathLength={1} />
    </>
  ),
  // Anything else: three dots, in turn.
  other: (
    <>
      <circle data-part="dot" cx="5.5" cy="12" r="1.25" />
      <circle data-part="dot" cx="12" cy="12" r="1.25" />
      <circle data-part="dot" cx="18.5" cy="12" r="1.25" />
    </>
  ),
};

/**
 * One glyph per kind of work (ADR 0103), a set drawn to belong together:
 * reading, changing, running, checking, shipping, the web, the browser, apps,
 * making, planning, helpers, memory and the rest. Decorative: the words
 * beside it say what happened.
 */
export function FamilyGlyph({ family, active = false, className, ...props }: FamilyGlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable={false}
      data-family={family}
      data-active={active || undefined}
      className={cx(styles.glyph, className)}
      {...props}
    >
      {GLYPHS[family]}
    </svg>
  );
}
