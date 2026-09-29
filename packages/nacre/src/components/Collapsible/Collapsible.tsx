import { Collapsible as CollapsiblePrimitive } from 'radix-ui';
import { ChevronRight } from 'lucide-react';
import type { ComponentProps } from 'react';

import { cx } from '../../utils/cx';
import styles from './Collapsible.module.css';

export type CollapsibleProps = ComponentProps<typeof CollapsiblePrimitive.Root>;

function CollapsibleRoot({ className, ...props }: CollapsibleProps) {
  return <CollapsiblePrimitive.Root className={cx(styles.root, className)} {...props} />;
}

export interface CollapsibleTriggerProps extends ComponentProps<
  typeof CollapsiblePrimitive.Trigger
> {
  /** Show the rotating chevron (ignored with `asChild`). */
  chevron?: boolean;
}

function CollapsibleTrigger({
  chevron = true,
  asChild,
  className,
  children,
  ...props
}: CollapsibleTriggerProps) {
  return (
    <CollapsiblePrimitive.Trigger
      asChild={asChild}
      className={cx(!asChild && styles.trigger, className)}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {chevron && <ChevronRight className={styles.chevron} aria-hidden />}
          {children}
        </>
      )}
    </CollapsiblePrimitive.Trigger>
  );
}

function CollapsibleContent({
  className,
  children,
  ...props
}: ComponentProps<typeof CollapsiblePrimitive.Content>) {
  return (
    <CollapsiblePrimitive.Content className={cx(styles.content, className)} {...props}>
      <div className={styles.inner}>{children}</div>
    </CollapsiblePrimitive.Content>
  );
}

/**
 * Show/hide a single region with a smooth height + fade animation.
 * Use for tool-call details, long outputs and "show more" affordances.
 */
export const Collapsible = Object.assign(CollapsibleRoot, {
  Trigger: CollapsibleTrigger,
  Content: CollapsibleContent,
});
