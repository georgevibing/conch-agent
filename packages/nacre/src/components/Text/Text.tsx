import { Slot } from 'radix-ui';
import type { ComponentProps, ElementType } from 'react';

import { cx } from '../../utils/cx';
import styles from './Text.module.css';

export type TextSize = '2xs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl';
export type TextTone = 'default' | 'muted' | 'subtle' | 'accent' | 'danger' | 'success' | 'inherit';
export type TextWeight = 'regular' | 'medium' | 'semibold' | 'bold';

interface TypographyProps {
  size?: TextSize;
  tone?: TextTone;
  weight?: TextWeight;
  align?: 'start' | 'center' | 'end';
  /** Truncate with an ellipsis after this many lines. */
  truncate?: boolean | number;
  /** Render digits with equal widths (timers, counters, tables). */
  tabular?: boolean;
  /** Merge props onto the single child instead of rendering an element. */
  asChild?: boolean;
}

export interface TextProps extends TypographyProps, Omit<ComponentProps<'p'>, 'color'> {
  as?: 'p' | 'span' | 'div' | 'label' | 'strong' | 'em' | 'small' | 'time' | 'figcaption';
}

function typographyAttrs({ size, tone, weight, align, truncate, tabular }: TypographyProps) {
  return {
    'data-size': size,
    'data-tone': tone,
    'data-weight': weight,
    'data-align': align,
    'data-truncate': truncate === true ? 1 : truncate || undefined,
    'data-tabular': tabular || undefined,
  };
}

export function Text({
  as = 'p',
  size = 'md',
  tone = 'default',
  weight,
  align,
  truncate,
  tabular,
  asChild,
  className,
  style,
  ...props
}: TextProps) {
  const Comp: ElementType = asChild ? Slot.Root : as;
  return (
    <Comp
      {...typographyAttrs({ size, tone, weight, align, truncate, tabular })}
      className={cx(styles.text, className)}
      style={typeof truncate === 'number' ? { ...style, WebkitLineClamp: truncate } : style}
      {...props}
    />
  );
}

export interface HeadingProps extends TypographyProps, Omit<ComponentProps<'h2'>, 'color'> {
  level?: 1 | 2 | 3 | 4 | 5 | 6;
  /** Editorial serif display face for hero moments and empty states. */
  display?: boolean;
}

const headingSize: Record<number, TextSize> = {
  1: '3xl',
  2: '2xl',
  3: 'xl',
  4: 'lg',
  5: 'md',
  6: 'sm',
};

export function Heading({
  level = 2,
  size,
  tone = 'default',
  weight = 'semibold',
  display,
  align,
  truncate,
  tabular,
  asChild,
  className,
  ...props
}: HeadingProps) {
  const Comp: ElementType = asChild ? Slot.Root : `h${level}`;
  return (
    <Comp
      {...typographyAttrs({
        size: size ?? headingSize[level],
        tone,
        weight,
        align,
        truncate,
        tabular,
      })}
      data-display={display || undefined}
      className={cx(styles.text, styles.heading, className)}
      {...props}
    />
  );
}
