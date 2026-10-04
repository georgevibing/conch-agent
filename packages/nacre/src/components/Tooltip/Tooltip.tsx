import { Tooltip as TooltipPrimitive } from 'radix-ui';
import type { ComponentProps, ReactElement, ReactNode } from 'react';

import { cx } from '../../utils/cx';
import { TOUCH_ONLY, useMediaQuery } from '../../utils/useMediaQuery';
import { Kbd } from '../Kbd';
import styles from './Tooltip.module.css';

export interface TooltipProps extends Omit<
  ComponentProps<typeof TooltipPrimitive.Content>,
  'content' | 'children'
> {
  /** The element that triggers the tooltip. Must accept a ref and DOM props. */
  children: ReactElement;
  content: ReactNode;
  /** Keyboard shortcut rendered after the content, e.g. `"mod+k"`. */
  shortcut?: string | string[];
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  delayDuration?: number;
  /** Disable without unmounting the trigger. */
  disabled?: boolean;
}

/**
 * Short, non-essential hint for an element. Never put interactive content in
 * a tooltip — use a Popover. Requires `NacreProvider` (which supplies the
 * shared delay group so moving between tooltips feels instant).
 */
export function Tooltip({
  children,
  content,
  shortcut,
  open,
  defaultOpen,
  onOpenChange,
  delayDuration,
  disabled,
  side = 'top',
  sideOffset = 6,
  collisionPadding = 8,
  className,
  ...props
}: TooltipProps) {
  // A touch screen has no hover, so a hint there only ever shows by accident: when
  // a drawer or dialog moves focus onto its trigger. One the caller opens still shows.
  const touchOnly = useMediaQuery(TOUCH_ONLY);
  if (disabled || content == null || content === '') return children;
  if (touchOnly && open === undefined) return children;
  return (
    <TooltipPrimitive.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      delayDuration={delayDuration}
    >
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={sideOffset}
          collisionPadding={collisionPadding}
          className={cx(styles.content, className)}
          {...props}
        >
          <span>{content}</span>
          {shortcut && <Kbd keys={shortcut} size="sm" inverse />}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
