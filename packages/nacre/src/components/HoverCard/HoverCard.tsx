import { HoverCard as HoverCardPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cx } from '../../utils/cx';
import { floatingStyles } from '../Popover/Popover';
import styles from './HoverCard.module.css';

export interface HoverCardContentProps extends ComponentProps<typeof HoverCardPrimitive.Content> {
  container?: HTMLElement | null;
}

function HoverCardContent({
  side = 'bottom',
  sideOffset = 8,
  collisionPadding = 12,
  className,
  container,
  ...props
}: HoverCardContentProps) {
  return (
    <HoverCardPrimitive.Portal container={container}>
      <HoverCardPrimitive.Content
        side={side}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        data-lustre=""
        className={cx(floatingStyles.floating, styles.content, className)}
        {...props}
      />
    </HoverCardPrimitive.Portal>
  );
}

function HoverCardRoot({
  openDelay = 500,
  closeDelay = 180,
  ...props
}: ComponentProps<typeof HoverCardPrimitive.Root>) {
  return <HoverCardPrimitive.Root openDelay={openDelay} closeDelay={closeDelay} {...props} />;
}

/**
 * Preview content for sighted pointer users (e.g. a file path or session
 * link). It is supplementary: keyboard and screen-reader users must be able to
 * reach the same information elsewhere.
 */
export const HoverCard = {
  Root: HoverCardRoot,
  Trigger: HoverCardPrimitive.Trigger,
  Content: HoverCardContent,
};
