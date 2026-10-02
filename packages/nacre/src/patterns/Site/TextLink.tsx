import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cx } from '../../utils/cx';
import styles from './TextLink.module.css';

export interface TextLinkProps extends ComponentProps<'a'> {
  /**
   * An arrow after the words: `forward` for "read more about this", `away`
   * for a link that leaves the site.
   */
  arrow?: 'forward' | 'away';
  /** Render the child element (e.g. a router `<Link>`) as the link. */
  asChild?: boolean;
}

/**
 * A link in running text, outside `Prose`: the accent, a hairline underline
 * that firms up under the pointer. With an arrow it stands on its own line as
 * the way onward from a paragraph.
 */
export function TextLink({ arrow, asChild, className, children, ...props }: TextLinkProps) {
  const Comp = asChild ? Slot.Root : 'a';
  const Arrow = arrow === 'away' ? ArrowUpRight : ArrowRight;
  return (
    <Comp data-arrow={arrow} className={cx(styles.link, className)} {...props}>
      <Slot.Slottable>{children}</Slot.Slottable>
      {arrow && <Arrow aria-hidden className={styles.arrow} />}
    </Comp>
  );
}
