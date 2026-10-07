import { Collapsible as CollapsiblePrimitive } from 'radix-ui';
import { ChevronRight } from 'lucide-react';
import { useState, type ComponentProps, type ReactNode } from 'react';

import { cx } from '../../utils/cx';
import styles from './LineGroup.module.css';

export interface LineGroupProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** Shown once, before the summary: what kind of lines these are. */
  icon?: ReactNode;
  /** The one line said in place of them all: "Read 7 sites and 2 of your chats." */
  summary: ReactNode;
  /** Each line, shown when opened. */
  items: ReactNode[];
  /** What the list is, for screen readers: "What it read". */
  label: string;
  /** Said under the lines when opened: what they mean. */
  footnote?: ReactNode;
  /** Open to begin with. */
  defaultOpen?: boolean;
}

/**
 * Many lines of the same kind, said as one: a quiet summary that opens to the
 * lines themselves. For what a chat read, what a task did, anything that would
 * otherwise stack up as a wall of near-identical rows.
 */
export function LineGroup({
  icon,
  summary,
  items,
  label,
  footnote,
  defaultOpen = false,
  className,
  ...props
}: LineGroupProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <CollapsiblePrimitive.Root open={open} onOpenChange={setOpen} asChild>
      <div className={cx(styles.group, className)} data-bare={icon ? undefined : ''} {...props}>
        <CollapsiblePrimitive.Trigger className={styles.trigger}>
          {icon && <span className={styles.icon}>{icon}</span>}
          <span className={styles.summary}>{summary}</span>
          <ChevronRight className={styles.chevron} aria-hidden />
        </CollapsiblePrimitive.Trigger>
        <CollapsiblePrimitive.Content className={styles.content}>
          <div className={styles.inner}>
            <ul className={styles.items} aria-label={label}>
              {items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
            {footnote && <p className={styles.footnote}>{footnote}</p>}
          </div>
        </CollapsiblePrimitive.Content>
      </div>
    </CollapsiblePrimitive.Root>
  );
}
