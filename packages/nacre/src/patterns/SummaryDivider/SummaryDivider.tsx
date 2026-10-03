import { Collapsible as CollapsiblePrimitive } from 'radix-ui';
import { ChevronRight, History } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { cx } from '../../utils/cx';
import styles from './SummaryDivider.module.css';

export interface SummaryDividerProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** The model that reads the summary, by name: "GPT-5 mini". */
  model?: ReactNode;
  /** What the model keeps of the messages above. Empty: none could be written. */
  summary?: string;
  /** Open to begin with (it starts closed: the line is the news, not the summary). */
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * A quiet line in a long chat where the model's word-for-word memory now
 * starts (ADR 0055). Everything above is still there for the person; the model
 * reads a summary of it instead. The line opens to show that summary, so
 * nothing about what the model knows is hidden — and it's never an alarm.
 */
export function SummaryDivider({
  model,
  summary,
  defaultOpen,
  open,
  onOpenChange,
  className,
  ...props
}: SummaryDividerProps) {
  const who = model ?? 'the model';
  const text = summary?.trim();
  const label = text ? (
    <>Earlier messages are summarised for {who}</>
  ) : (
    <>{model ?? 'The model'} no longer reads the messages above</>
  );
  if (!text)
    return (
      <div role="note" className={cx(styles.root, className)} {...props}>
        <div className={styles.rule}>
          <span className={styles.line} aria-hidden />
          <span className={styles.static}>
            <History aria-hidden className={styles.icon} />
            <span>{label}</span>
          </span>
          <span className={styles.line} aria-hidden />
        </div>
      </div>
    );
  return (
    <CollapsiblePrimitive.Root
      className={cx(styles.root, className)}
      {...(defaultOpen !== undefined && { defaultOpen })}
      {...(open !== undefined && { open })}
      {...(onOpenChange && { onOpenChange })}
      asChild
    >
      <div role="note" {...props}>
        <div className={styles.rule}>
          <span className={styles.line} aria-hidden />
          <CollapsiblePrimitive.Trigger className={styles.trigger}>
            <History aria-hidden className={styles.icon} />
            <span>{label}</span>
            <ChevronRight aria-hidden className={styles.chevron} />
          </CollapsiblePrimitive.Trigger>
          <span className={styles.line} aria-hidden />
        </div>
        <CollapsiblePrimitive.Content className={styles.content}>
          <div className={styles.panel}>
            <p className={styles.heading}>What {who} keeps from above</p>
            <p className={styles.summary}>{text}</p>
            <p className={styles.note}>
              Every message is still here for you. Only what the model reads is shorter.
            </p>
          </div>
        </CollapsiblePrimitive.Content>
      </div>
    </CollapsiblePrimitive.Root>
  );
}
