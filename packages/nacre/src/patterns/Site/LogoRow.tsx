import { useLayoutEffect, useRef, useState, type ComponentProps } from 'react';

import { Text } from '../../components/Text';
import { cx } from '../../utils/cx';
import { IntegrationLogo } from '../Integrations/IntegrationLogo';
import styles from './LogoRow.module.css';

export interface LogoRowProps extends Omit<ComponentProps<'span'>, 'children'> {
  items: readonly { id: string; name: string; color?: string }[];
  decorative?: boolean;
}

/** One row of catalog marks, with the ones that don't fit counted as “+N more”. */
export function LogoRow({ items, decorative, className, ...props }: LogoRowProps) {
  const row = useRef<HTMLSpanElement>(null);
  const measure = useRef<HTMLSpanElement>(null);
  // Prerender a bounded count until the browser can measure the available room.
  const [visible, setVisible] = useState(0);
  const count = items.length;

  useLayoutEffect(() => {
    const root = row.current;
    const probe = measure.current;
    if (!root || !probe || !count) return;

    function fit() {
      if (!root || !probe) return;
      const width = root.getBoundingClientRect().width;
      const logo = probe.firstElementChild?.getBoundingClientRect().width ?? 0;
      const more = probe.lastElementChild?.getBoundingClientRect().width ?? 0;
      const gap = parseFloat(getComputedStyle(root).columnGap) || 0;
      if (!logo) return;
      setVisible(
        count * logo + (count - 1) * gap <= width
          ? count
          : Math.max(0, Math.min(count - 1, Math.floor((width - more) / (logo + gap)))),
      );
    }

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(root);
    // Font loading and text zoom can change how much room the count needs.
    observer.observe(probe);
    return () => observer.disconnect();
  }, [count]);

  if (!count) return null;
  const shown = Math.min(visible, count);
  const first = items[0];
  return (
    <span
      ref={row}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : items.map((item) => item.name).join(', ')}
      aria-hidden={decorative || undefined}
      className={cx(styles.row, className)}
      {...props}
    >
      {items.slice(0, shown).map((item) => (
        <IntegrationLogo
          key={item.id}
          brand={item.id}
          name={item.name}
          color={item.color}
          size="xs"
          decorative
        />
      ))}
      {shown < count && (
        <Text as="span" size="sm" tone="muted" tabular className={styles.more} aria-hidden>
          +{count - shown} more
        </Text>
      )}
      <span ref={measure} className={styles.measure} aria-hidden inert>
        <IntegrationLogo name={first?.name ?? ''} size="xs" decorative />
        <Text as="span" size="sm" tone="muted" tabular className={styles.more}>
          +{count} more
        </Text>
      </span>
    </span>
  );
}
