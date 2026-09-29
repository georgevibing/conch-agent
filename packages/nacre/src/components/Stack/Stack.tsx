import { Slot } from 'radix-ui';
import type { ComponentProps, CSSProperties, ElementType } from 'react';

import { cx } from '../../utils/cx';
import styles from './Stack.module.css';

type Space = 0 | 0.5 | 1 | 1.5 | 2 | 2.5 | 3 | 4 | 5 | 6 | 8 | 10 | 12 | 16;

export interface StackProps extends ComponentProps<'div'> {
  direction?: 'row' | 'column';
  /** Gap on the 4px spacing scale (`3` → 0.75rem). */
  gap?: Space;
  align?: 'start' | 'center' | 'end' | 'stretch' | 'baseline';
  justify?: 'start' | 'center' | 'end' | 'between' | 'around';
  wrap?: boolean;
  inline?: boolean;
  as?:
    | 'div'
    | 'section'
    | 'ul'
    | 'ol'
    | 'li'
    | 'nav'
    | 'header'
    | 'footer'
    | 'main'
    | 'aside'
    | 'form';
  asChild?: boolean;
}

const justifyMap = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  between: 'space-between',
  around: 'space-around',
};
const alignMap = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
  baseline: 'baseline',
};

/** Flexbox layout primitive. Spacing always comes from the token scale. */
export function Stack({
  direction = 'column',
  gap = 3,
  align,
  justify,
  wrap,
  inline,
  as = 'div',
  asChild,
  className,
  style,
  ...props
}: StackProps) {
  const Comp: ElementType = asChild ? Slot.Root : as;
  return (
    <Comp
      data-inline={inline || undefined}
      className={cx(styles.stack, className)}
      style={
        {
          flexDirection: direction,
          gap: `var(--nc-space-${String(gap).replace('.', '-')})`,
          alignItems: align && alignMap[align],
          justifyContent: justify && justifyMap[justify],
          flexWrap: wrap ? 'wrap' : undefined,
          ...style,
        } as CSSProperties
      }
      {...props}
    />
  );
}
