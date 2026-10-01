import { LayoutGroup, motion } from 'motion/react';
import { Slot } from 'radix-ui';
import { useId, type ComponentProps, type ReactNode } from 'react';

import { springs } from '../../tokens';
import { cx } from '../../utils/cx';
import styles from './DocsNav.module.css';

export interface DocsNavProps extends ComponentProps<'nav'> {
  /** What the list is, read out with it ("Documentation"). */
  label: string;
}

/**
 * The contents of a set of pages: short titled groups of links, with one quiet
 * marker that glides to wherever you are. Nothing else in it moves.
 */
function DocsNavRoot({ label, className, children, ...props }: DocsNavProps) {
  const id = useId();
  return (
    <nav aria-label={label} className={cx(styles.nav, className)} {...props}>
      <LayoutGroup id={id}>{children}</LayoutGroup>
    </nav>
  );
}

export interface DocsNavSectionProps extends Omit<ComponentProps<'section'>, 'title'> {
  title: ReactNode;
}

function DocsNavSection({ title, className, children, ...props }: DocsNavSectionProps) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cx(styles.section, className)} {...props}>
      <h2 id={id} className={styles.title}>
        {title}
      </h2>
      <ul className={styles.list}>{children}</ul>
    </section>
  );
}

export interface DocsNavLinkProps extends ComponentProps<'a'> {
  /** This is the page being read. */
  active?: boolean;
  /** Render the child element (e.g. a router `<Link>`) as the link. */
  asChild?: boolean;
}

function DocsNavLink({ active, asChild, className, children, ...props }: DocsNavLinkProps) {
  const Comp = asChild ? Slot.Root : 'a';
  return (
    <li className={styles.item}>
      <Comp
        aria-current={active ? 'page' : undefined}
        className={cx(styles.link, className)}
        {...props}
      >
        {active && (
          <motion.span
            layoutId="nacre-docs-nav-marker"
            className={styles.marker}
            transition={springs.snappy}
            aria-hidden
          />
        )}
        <Slot.Slottable>{children}</Slot.Slottable>
      </Comp>
    </li>
  );
}

export const DocsNav = Object.assign(DocsNavRoot, {
  Section: DocsNavSection,
  Link: DocsNavLink,
});
