import { Globe, Laptop, Mail, MessageSquareText, Plug, Server } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { cx } from '../../utils/cx';
import { brandArt, brandMarks } from './brands';
import styles from './IntegrationLogo.module.css';
import type { IntegrationStateValue } from './status';

export interface IntegrationLogoProps extends Omit<ComponentProps<'span'>, 'children'> {
  /** Catalog id (`notion`, `github`…) — picks the bundled mark. */
  brand?: string;
  /** Used for the monogram when there's no mark, and as the accessible name. */
  name: string;
  /** Tile colour (hex). Falls back to a hue derived from the name. */
  color?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  /** Adds a status dot in the corner. */
  status?: IntegrationStateValue;
  /** Hide from assistive tech when the name is already next to it. */
  decorative?: boolean;
  /** A glyph of its own instead of a brand's mark: a Conch app's icon (`AppIcon`). */
  icon?: ReactNode;
}

/**
 * Glyphs for catalog entries without a Simple Icons mark (some brands asked
 * to be removed from it, so we don't redraw them): a symbol that says what
 * the service is about, on its colour.
 */
const glyphs: Record<string, ReactNode> = {
  browser: <Globe />,
  // A model on this computer: the computer is the point, not the program running it.
  ollama: <Laptop />,
  // Email isn't one company: an envelope says what it is.
  email: <Mail />,
  // Texting isn't one company either: a speech bubble (ADR 0076).
  sms: <MessageSquareText />,
  // A server someone runs themselves (llama.cpp, vLLM, a gateway at work).
  server: <Server />,
};

/** A stable hue per name, so a custom integration always gets the same tile. */
function hueOf(name: string): number {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 360;
}

/** Letters for brands whose name doesn't make a good monogram ("xAI API" isn't "XA"). */
const letters: Record<string, string> = {
  xai: 'x',
  grok: 'x',
  // The clouds (ADR 0109): AWS and Azure asked Simple Icons to remove their marks.
  bedrock: 'aws',
  vertex: 'V',
  'azure-openai': 'Az',
};

/** Words that say what a thing is, not whose: "Together AI" is a T, not a TA. */
const GENERIC = new Set(['ai', 'api']);

function monogram(name: string): string {
  const all = name.trim().split(/\s+/).filter(Boolean);
  const named = all.filter((word) => !GENERIC.has(word.toLowerCase()));
  const words = named.length ? named : all;
  const letters =
    words.length > 1 ? `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}` : (words[0]?.[0] ?? '');
  return letters.toUpperCase() || '?';
}

/**
 * An integration's app icon: the brand mark in white on the brand's colour,
 * like a home-screen icon. Marks ship with Nacre as inline SVG, so they're
 * there on the first frame — no network, no pop-in, no layout shift.
 * Anything without a mark gets a monogram on a hue derived from its name.
 */
export function IntegrationLogo({
  brand,
  name,
  color,
  size = 'md',
  status,
  decorative,
  icon,
  className,
  style,
  ...props
}: IntegrationLogoProps) {
  const art = brand && !icon ? brandArt[brand] : undefined;
  const path = brand && !art && !icon ? brandMarks[brand] : undefined;
  const glyph = icon ?? (brand && !art ? glyphs[brand] : undefined);
  // No mark and no brand colour: a soft monogram tile instead of a loud one.
  const custom = !art && !path && !glyph && !color;
  return (
    <span
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
      data-size={size}
      data-custom={custom || undefined}
      data-art={art ? '' : undefined}
      className={cx(styles.logo, className)}
      style={{
        ...(color ? { '--il-color': color } : { '--il-hue': hueOf(name) }),
        ...style,
      }}
      {...props}
    >
      {art ? (
        <svg viewBox={art.viewBox} aria-hidden className={styles.art}>
          {art.paths.map((p) => (
            <path key={p.d.slice(0, 24)} d={p.d} fill={p.fill} />
          ))}
        </svg>
      ) : path ? (
        <svg viewBox="0 0 24 24" aria-hidden className={styles.mark}>
          <path d={path} />
        </svg>
      ) : glyph ? (
        <span className={styles.glyph} aria-hidden>
          {glyph}
        </span>
      ) : brand === 'custom' ? (
        <span className={styles.glyph} aria-hidden>
          <Plug />
        </span>
      ) : (
        <span className={styles.monogram} aria-hidden>
          {(brand && letters[brand]) ?? monogram(name)}
        </span>
      )}
      {status && <span className={styles.dot} data-state={status} aria-hidden />}
    </span>
  );
}
