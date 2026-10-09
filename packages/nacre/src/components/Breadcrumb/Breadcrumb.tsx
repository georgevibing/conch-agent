import { ChevronRight } from 'lucide-react';
import { Slot } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';

import { cx } from '../../utils/cx';
import styles from './Breadcrumb.module.css';

export interface BreadcrumbProps extends ComponentProps<'nav'> {
  /** `sm` for a toolbar beside other controls; `md` where it is the page's title bar. */
  size?: 'sm' | 'md';
}

/**
 * Where you are, as a trail: each place above this one is a step back to it,
 * the last names the page you're on. One line, always — when there isn't room,
 * the places above give way first (to an ellipsis), the page you're on last.
 */
function BreadcrumbRoot({
  size = 'md',
  'aria-label': label = 'Breadcrumb',
  className,
  children,
  ...props
}: BreadcrumbProps) {
  return (
    <nav aria-label={label} data-size={size} className={cx(styles.root, className)} {...props}>
      <ol className={styles.list}>{children}</ol>
    </nav>
  );
}

export interface BreadcrumbItemProps extends Omit<ComponentProps<'button'>, 'children'> {
  children: ReactNode;
  /** The page you're on: not a link, read as the current page. */
  current?: boolean;
  /** A step that's a link (`<a href>`) rather than a button. */
  href?: string;
  /** Render your own link element (a router's `Link`) as the step. */
  asChild?: boolean;
}

function BreadcrumbItem({
  children,
  current = false,
  href,
  asChild = false,
  id,
  className,
  onClick,
  ...props
}: BreadcrumbItemProps) {
  // The whole name, for a pointer that rests on one that's been cut short.
  const title = typeof children === 'string' ? children : undefined;
  let step: ReactNode;
  if (current) {
    step = (
      <span
        id={id}
        aria-current="page"
        title={title}
        className={cx(styles.current, className)}
        {...(props as ComponentProps<'span'>)}
      >
        {children}
      </span>
    );
  } else if (asChild) {
    step = (
      <Slot.Root
        id={id}
        className={cx(styles.link, className)}
        onClick={onClick}
        {...(props as ComponentProps<'a'>)}
      >
        {children}
      </Slot.Root>
    );
  } else if (href !== undefined) {
    step = (
      <a
        id={id}
        href={href}
        title={title}
        className={cx(styles.link, className)}
        onClick={onClick as ComponentProps<'a'>['onClick']}
        {...(props as ComponentProps<'a'>)}
      >
        {children}
      </a>
    );
  } else {
    step = (
      <button
        type="button"
        id={id}
        title={title}
        className={cx(styles.link, className)}
        onClick={onClick}
        {...props}
      >
        {children}
      </button>
    );
  }
  return (
    <li className={styles.item} data-current={current || undefined}>
      <ChevronRight aria-hidden className={styles.separator} />
      {step}
    </li>
  );
}

/** A trail of places, `Settings › What Conch knows › All memories`. */
export const Breadcrumb = Object.assign(BreadcrumbRoot, { Item: BreadcrumbItem });
