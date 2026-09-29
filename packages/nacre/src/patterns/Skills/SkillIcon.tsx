import type { ComponentProps, CSSProperties } from 'react';

import { cx } from '../../utils/cx';
import styles from './Skills.module.css';

export interface SkillIconProps extends Omit<ComponentProps<'span'>, 'children'> {
  /** The skill's name; its hue comes from it, so a skill keeps its colour everywhere. */
  name: string;
  /** Its title; the tile shows the first letter. */
  title: string;
  /** `xs` fits an icon slot (a button's leading icon). */
  size?: 'xs' | 'sm' | 'md' | 'lg';
  /** Greyed, for a skill that's off. */
  muted?: boolean;
}

/** A stable hue for a name: the same skill is always the same colour. */
export function skillHue(name: string): number {
  let hash = 2166136261;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  // Steps of 24° keep neighbours distinct; the offset keeps clear of muddy yellows first.
  return ((hash >>> 0) % 15) * 24 + 12;
}

/**
 * A skill's tile: its initial on a tint of its own, like an app icon, so a
 * list of skills is recognisable at a glance rather than a column of text.
 */
export function SkillIcon({
  name,
  title,
  size = 'md',
  muted,
  className,
  style,
  ...props
}: SkillIconProps) {
  const letter = [...title.trim()][0]?.toLocaleUpperCase() ?? '•';
  return (
    <span
      aria-hidden
      data-size={size}
      data-muted={muted || undefined}
      className={cx(styles.icon, className)}
      style={{ '--skill-h': skillHue(name), ...style } as CSSProperties}
      {...props}
    >
      {letter}
    </span>
  );
}
