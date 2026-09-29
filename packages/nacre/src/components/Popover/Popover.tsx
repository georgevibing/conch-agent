import { Popover as PopoverPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cx } from '../../utils/cx';
import styles from './Popover.module.css';

export interface PopoverContentProps extends ComponentProps<typeof PopoverPrimitive.Content> {
  /** Inner padding. `none` for menus/lists that manage their own. */
  padding?: 'none' | 'sm' | 'md';
  container?: HTMLElement | null;
}

function PopoverContent({
  padding = 'md',
  side = 'bottom',
  align = 'center',
  sideOffset = 8,
  collisionPadding = 12,
  className,
  container,
  ...props
}: PopoverContentProps) {
  return (
    <PopoverPrimitive.Portal container={container}>
      <PopoverPrimitive.Content
        side={side}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        data-padding={padding}
        data-lustre=""
        className={cx(styles.floating, styles.popover, className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

/**
 * Non-modal floating panel anchored to a trigger, for rich interactive
 * content (pickers, filters, quick settings). Focus moves in on open and
 * returns on close; Escape and outside clicks dismiss.
 */
export const Popover = {
  Root: PopoverPrimitive.Root,
  Trigger: PopoverPrimitive.Trigger,
  Anchor: PopoverPrimitive.Anchor,
  Close: PopoverPrimitive.Close,
  Content: PopoverContent,
};

/** Shared floating-panel class, reused by HoverCard. */
export { styles as floatingStyles };
