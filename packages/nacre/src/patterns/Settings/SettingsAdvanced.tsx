import type { ReactNode } from 'react';

import { Collapsible } from '../../components/Collapsible';
import { cx } from '../../utils/cx';
import styles from './SettingsAdvanced.module.css';

export interface SettingsAdvancedProps {
  /** What it's called. “Advanced” unless a page has a better word for it. */
  label?: string;
  /** Open, when the page holds it (⌘K pointing at something inside). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  /** The sections it holds, in the same order they'd have on the page. */
  children: ReactNode;
  className?: string;
}

/**
 * The end of a settings page: what almost nobody needs, one press away.
 *
 * A settings page shows what a person came for and nothing else. Everything
 * else — a sensible default they'll never change, a switch for one person in a
 * thousand — waits here, under a hairline, behind the word **Advanced**. It is
 * never a second page: what's inside is the page's own sections, with the same
 * spacing, so opening it only makes the page longer.
 */
export function SettingsAdvanced({
  label = 'Advanced',
  open,
  onOpenChange,
  defaultOpen,
  children,
  className,
}: SettingsAdvancedProps) {
  return (
    <Collapsible
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      className={cx(styles.advanced, className)}
    >
      <Collapsible.Trigger className={styles.trigger}>{label}</Collapsible.Trigger>
      <Collapsible.Content>
        <div className={styles.body}>{children}</div>
      </Collapsible.Content>
    </Collapsible>
  );
}
