import { ArrowUpRight } from 'lucide-react';
import { Slot } from 'radix-ui';
import type { ComponentProps, CSSProperties, ReactNode } from 'react';

import { cx } from '../../utils/cx';
import styles from './LinkCard.module.css';

export interface LinkCardProps extends Omit<ComponentProps<'a'>, 'title'> {
  /** A logo, or an icon (which gets a glazed tile). */
  icon?: ReactNode;
  title: ReactNode;
  /** One or two plain lines. */
  description?: ReactNode;
  /** A quiet fact beside the title: "2 min", "Early support". */
  meta?: ReactNode;
  /** It leads away from these pages: says so with an arrow. */
  external?: boolean;
  /** Position in a grid, to stagger the entrance. */
  index?: number;
  /** Render the child element (e.g. a router `<Link>`) as the link. */
  asChild?: boolean;
}

/**
 * A page you can go to, as a card: what it is in a few words, and the whole
 * card is the link. Used for a page's "where next" and for galleries of
 * things that each have a page (providers, channels, apps).
 */
export function LinkCard({
  icon,
  title,
  description,
  meta,
  external,
  index = 0,
  asChild,
  className,
  style,
  children,
  ...props
}: LinkCardProps) {
  const Comp = asChild ? Slot.Root : 'a';
  return (
    <Comp
      data-lustre=""
      className={cx(styles.card, className)}
      style={{ '--lc-index': index, ...style } as CSSProperties}
      {...props}
    >
      {icon != null && (
        <span className={styles.icon} aria-hidden>
          {icon}
        </span>
      )}
      <span className={styles.words}>
        <span className={styles.head}>
          <span className={styles.title}>{title}</span>
          {meta != null && <span className={styles.meta}>{meta}</span>}
          {external && <ArrowUpRight aria-hidden className={styles.away} />}
        </span>
        {description != null && <span className={styles.description}>{description}</span>}
      </span>
      <Slot.Slottable>{children}</Slot.Slottable>
    </Comp>
  );
}
