import { Collapsible as CollapsiblePrimitive } from 'radix-ui';
import { ChevronRight } from 'lucide-react';
import { useEffect, useState, type ComponentProps } from 'react';

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
  // Open from the start, it's simply there: only opening it later plays the reveal.
  const [arriving, setArriving] = useState(true);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setArriving(false));
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <CollapsiblePrimitive.Content
      className={cx(styles.content, className)}
      data-arriving={arriving || undefined}
      {...props}
    >
      <div className={styles.inner}>{children}</div>
    </CollapsiblePrimitive.Content>
  );
}

/**
 * Show/hide a single region with a smooth height + fade animation.
 * Use for tool-call details, long outputs and "show more" affordances, and
 * for choices that only mean something while the switch above them is on.
 * Open from the start, it arrives open: the reveal plays only when it opens.
 */
export const Collapsible = Object.assign(CollapsibleRoot, {
  Trigger: CollapsibleTrigger,
  Content: CollapsibleContent,
});
