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
      data-chevron={(!asChild && chevron) || undefined}
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

export interface CollapsibleContentProps extends ComponentProps<
  typeof CollapsiblePrimitive.Content
> {
  /**
   * Line what opens up with the trigger's words, past its chevron (default),
   * so a list under "What's new" nests under it. Only a chevroned
   * `Collapsible.Trigger` beside it has words to line up with; `false` lets a
   * full-width panel (a code block, a sunken box) span the whole fold.
   */
  inset?: boolean;
}

function CollapsibleContent({
  inset = true,
  className,
  children,
  ...props
}: CollapsibleContentProps) {
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
      data-inset={inset || undefined}
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
 *
 * What opens lines up with the trigger's words, past the chevron: a list's
 * bullets sit at the words' start, never out under the chevron. A pattern
 * that moves the trigger says so with the knobs on the root, never with its
 * own margins and paddings, so the two stay in line:
 * `--cl-bleed` (how far the trigger hangs out past the edge, so its chevron
 * sits on it) and `--cl-gap` (chevron to words).
 */
export const Collapsible = Object.assign(CollapsibleRoot, {
  Trigger: CollapsibleTrigger,
  Content: CollapsibleContent,
});
