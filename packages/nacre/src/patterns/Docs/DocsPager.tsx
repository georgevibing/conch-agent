import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Slot } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';

import { cx } from '../../utils/cx';
import styles from './DocsPager.module.css';

export interface DocsPagerProps extends ComponentProps<'nav'> {
  /** What the links are, read out with them. */
  label?: string;
}

/** The page before and the page after, at the foot of the one being read. */
function DocsPagerRoot({ label = 'More pages', className, ...props }: DocsPagerProps) {
  return <nav aria-label={label} className={cx(styles.pager, className)} {...props} />;
}

export interface DocsPagerLinkProps extends Omit<ComponentProps<'a'>, 'title'> {
  direction: 'previous' | 'next';
  /** The page's title. */
  title: ReactNode;
  /** The small word above the title. Defaults to "Previous" / "Next". */
  kicker?: ReactNode;
  /** Render the child element (e.g. a router `<Link>`) as the link. */
  asChild?: boolean;
}

function DocsPagerLink({
  direction,
  title,
  kicker,
  asChild,
  className,
  children,
  ...props
}: DocsPagerLinkProps) {
  const Comp = asChild ? Slot.Root : 'a';
  const Arrow = direction === 'next' ? ArrowRight : ArrowLeft;
  return (
    <Comp
      data-direction={direction}
      data-lustre=""
      className={cx(styles.link, className)}
      {...props}
    >
      <Arrow aria-hidden className={styles.arrow} />
      <span className={styles.words}>
        <span className={styles.kicker}>
          {kicker ?? (direction === 'next' ? 'Next' : 'Previous')}
          <span className="nc-visually-hidden">: </span>
        </span>
        <span className={styles.title}>{title}</span>
      </span>
      <Slot.Slottable>{children}</Slot.Slottable>
    </Comp>
  );
}

export const DocsPager = Object.assign(DocsPagerRoot, { Link: DocsPagerLink });
