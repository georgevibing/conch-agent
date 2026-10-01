import { LayoutGroup, motion } from 'motion/react';
import { useId, type ComponentProps } from 'react';

import { springs } from '../../tokens';
import { cx } from '../../utils/cx';
import styles from './DocsToc.module.css';

export interface DocsTocItem {
  /** The heading's `id`, without the `#`. */
  id: string;
  text: string;
  level: 2 | 3;
}

export interface DocsTocProps extends Omit<ComponentProps<'nav'>, 'children'> {
  items: readonly DocsTocItem[];
  /** The heading being read. */
  activeId?: string;
  /** The list's name, shown above it. */
  label?: string;
}

/**
 * "On this page": the headings of the page being read, on a hairline rail. A
 * short accent bar rides the rail to the heading in view.
 */
export function DocsToc({
  items,
  activeId,
  label = 'On this page',
  className,
  ...props
}: DocsTocProps) {
  const id = useId();
  if (!items.length) return null;
  return (
    <nav aria-labelledby={id} className={cx(styles.toc, className)} {...props}>
      <h2 id={id} className={styles.label}>
        {label}
      </h2>
      <LayoutGroup id={id}>
        <ol className={styles.list}>
          {items.map((item) => {
            const active = item.id === activeId;
            return (
              <li key={item.id} className={styles.item} data-level={item.level}>
                <a
                  href={`#${item.id}`}
                  aria-current={active ? 'location' : undefined}
                  className={styles.link}
                >
                  {active && (
                    <motion.span
                      layoutId="nacre-docs-toc-marker"
                      className={styles.marker}
                      transition={springs.snappy}
                      aria-hidden
                    />
                  )}
                  {item.text}
                </a>
              </li>
            );
          })}
        </ol>
      </LayoutGroup>
    </nav>
  );
}
