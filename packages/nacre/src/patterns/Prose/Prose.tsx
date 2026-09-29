import { Slot } from 'radix-ui';
import type { ComponentProps, ElementType } from 'react';

import { cx } from '../../utils/cx';
import styles from './Prose.module.css';

export interface ProseProps extends ComponentProps<'div'> {
  size?: 'sm' | 'md' | 'lg';
  /** Cap line length at a comfortable reading measure (~68ch). */
  measure?: boolean;
  as?: 'div' | 'article' | 'section';
  asChild?: boolean;
}

/**
 * Typographic styles for rendered Markdown / HTML (agent replies, docs).
 * Style descendants only — pass semantic HTML as children. Embedded
 * components such as CodeBlock keep their own styles.
 */
export function Prose({
  size = 'md',
  measure = false,
  as = 'div',
  asChild,
  className,
  ...props
}: ProseProps) {
  const Comp: ElementType = asChild ? Slot.Root : as;
  return (
    <Comp
      data-size={size}
      data-measure={measure || undefined}
      className={cx(styles.prose, className)}
      {...props}
    />
  );
}
